#!/usr/bin/env node
// ================================================================
// 城市大富翁 · 联机 E2E（tools/mp-e2e.mjs）
//
// 真实链路：node 建房开局 → 两个无头浏览器（各自跑 _selftest 驱动自己那一位玩家）
// → 状态经 deploy/mp.py 的 WebSocket 房间同步 → 真实时间打完整局。
// 浏览器用 CDP（--remote-debugging-port）驱动，node 轮询页面直到出 SELFTEST 报告。
// 用法：node tools/mp-e2e.mjs [--timeout=240000]
// ================================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = 8806;
const CDP_BASE = 9310;

let pass = 0, fail = 0;
const ok = (c, label) => { if (c){ pass++; console.log('  ✓ ' + label); } else { fail++; console.log('  ✗ ' + label); } };

// ---- 最小 WebSocket 客户端（房间协议测试同款） ----
class WS {
  constructor(sock){ this.sock = sock; this.buf = Buffer.alloc(0); this.queue = []; this.waiters = [];
    sock.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this._parse(); });
    sock.on('close', () => { this.waiters.forEach(w => w(null)); this.waiters = []; }); }
  _parse(){ while (this.buf.length >= 2){
    const b1 = this.buf[0], b2 = this.buf[1]; let len = b2 & 0x7f, off = 2;
    if (len === 126){ if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
    else if (len === 127){ if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
    if (this.buf.length < off + len) return;
    const payload = this.buf.subarray(off, off + len); this.buf = this.buf.subarray(off + len);
    if ((b1 & 0x0f) === 0x1){ let m = null; try { m = JSON.parse(payload.toString('utf8')); } catch {}
      if (m) this._deliver(m); } } }
  _deliver(m){ const w = this.waiters.shift(); if (w) w(m); else this.queue.push(m); }
  send(obj){ const data = Buffer.from(JSON.stringify(obj), 'utf8'); const mask = crypto.randomBytes(4);
    let head; if (data.length < 126) head = Buffer.from([0x81, 0x80 | data.length]);
    else if (data.length < 65536){ head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(data.length, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
    const masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
    this.sock.write(Buffer.concat([head, mask, masked])); }
  next(t = 3000){ if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise(res => { const timer = setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) this.waiters.splice(i, 1); res(null); }, t);
      const w = m => { clearTimeout(timer); res(m); }; this.waiters.push(w); }); }
  wait(t, timeout = 4000){ const started = Date.now();
    return (async () => { while (Date.now() - started < timeout){ const m = await this.next(timeout); if (!m) return null; if (m.t === t) return m; } return null; })(); }
  close(){ try { this.sock.destroy(); } catch {} }
}
const connectWs = (port, wsPath = '/ws', host = 'x') => new Promise((resolve, reject) => {
  const sock = net.connect(port, '127.0.0.1'); const key = crypto.randomBytes(16).toString('base64');
  sock.once('error', reject);
  sock.once('connect', () => {
    sock.write(`GET ${wsPath} HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    let head = Buffer.alloc(0);
    const onData = d => { head = Buffer.concat([head, d]); const i = head.indexOf('\r\n\r\n'); if (i < 0) return;
      sock.off('data', onData);
      if (!/101/.test(head.subarray(0, i).toString())) { reject(new Error('握手失败')); return; }
      const ws = new WS(sock); const rest = head.subarray(i + 4);
      if (rest.length){ ws.buf = Buffer.concat([ws.buf, rest]); ws._parse(); }
      resolve(ws); };
    sock.on('data', onData); });
});

const httpGet = url => new Promise((resolve, reject) => {
  http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); }).on('error', reject);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findBrowser(){
  return [
    process.env.SELFTEST_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].filter(existsSync)[0] || null;
}
const BROWSER = findBrowser();
if (!BROWSER){ console.error('✗ 找不到 Edge/Chrome'); process.exit(2); }

// ---- CDP 浏览器控制 ----
async function launchBrowser(basePort, url){
  const profile = mkdtempSync(path.join(tmpdir(), 'cm-mpe2e-'));
  const proc = spawn(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    `--remote-debugging-port=${basePort}`, '--user-data-dir=' + profile, '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' });
  let pageWs = null;
  for (let i = 0; i < 50 && !pageWs; i++){
    await sleep(200);
    try {
      const list = JSON.parse(await httpGet(`http://127.0.0.1:${basePort}/json/list`));
      const page = list.find(t => t.type === 'page');
      if (page) pageWs = page.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, '');
    } catch {}
  }
  if (!pageWs) throw new Error('DevTools 没起来');
  const ws = await connectWs(basePort, pageWs, `127.0.0.1:${basePort}`);
  let id = 0;
  const calls = new Map();
  const roomy = ws._deliver.bind(ws);
  ws._deliver = m => { if (m.id && calls.has(m.id)){ calls.get(m.id)(m); calls.delete(m.id); return; } roomy(m); };
  const call = (method, params = {}) => new Promise(res => {
    const mid = ++id;
    calls.set(mid, m => res(m.result || m.error));
    ws.send({ id: mid, method, params });
  });
  await call('Page.enable');
  await call('Page.navigate', { url });
  return { proc, profile, call };
}

// ---- 1. 起服务器 ----
const server = spawn('python', ['deploy/server.py', '--no-open', '--port', String(PORT)], { cwd: ROOT });
server.stderr.on('data', d => { const t = String(d); if (t.includes('[mp]')) process.stdout.write('[srv] ' + t); });
let up = false;
for (let i = 0; i < 40 && !up; i++){
  await sleep(150);
  up = await new Promise(res => { const s = net.connect(PORT, '127.0.0.1'); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); });
}
if (!up){ console.error('✗ 服务器没有起来'); process.exit(2); }

console.log(`联机 E2E  |  端口 ${PORT}  |  真实时间模式\n`);

// ---- 2. node 客户端建房并开局（占位客户端凑满人数，随后被浏览器接管） ----
const host = await connectWs(PORT);
await host.wait('hello');
host.send({ t: 'hi', name: '房间协调员' });
await host.wait('hello');
host.send({ t: 'create', name: 'E2E 房间', max: 2, opts: { map: 'mini' } });
const joined = await host.wait('joined');
if (!joined){ console.error('✗ 建房失败'); server.kill(); process.exit(2); }
const ROOM = joined.room.id;
const placeholder = await connectWs(PORT);
await placeholder.wait('hello');
placeholder.send({ t: 'hi', name: '占位' });
await placeholder.wait('hello');
placeholder.send({ t: 'join', id: ROOM });
await placeholder.wait('joined');
placeholder.send({ t: 'ready', v: true });
await placeholder.wait('room');
host.send({ t: 'start' });
const started = await host.wait('start');
if (!started){ console.error('✗ 开局失败'); server.kill(); process.exit(2); }
console.log(`房间 ${ROOM} 已开局（2 位座位）\n`);

// ---- 3. 两个浏览器进场（?fast=1 加速动画，selftest 驱动各自玩家） ----
const timeoutMs = parseInt((process.argv.find(a => a.startsWith('--timeout=')) || '').split('=')[1], 10) || 240000;
const pages = [];
for (let seat = 0; seat < 2; seat++){
  const q = `mode=mp&room=${ROOM}&seat=${seat}&seats=0,1&names=${encodeURIComponent('甲|乙')}&map=mini&fast=1&selftest=1`;
  const url = `http://127.0.0.1:${PORT}/game/html/game.html?${q}`;
  pages.push({ seat, url, ...(await launchBrowser(CDP_BASE + seat, url)) });
}
console.log('两位玩家已进场，开始对局…\n');

// ---- 4. 轮询等待两份自检报告 ----
const POLL = `(function(){
  var m = document.body.textContent.match(/SELFTESTBASE64:([A-Za-z0-9+\\/=]+)/);
  return m ? m[1] : null;
})()`;

async function waitReport(page, deadline){
  while (Date.now() < deadline){
    const r = await page.call('Runtime.evaluate', { expression: POLL, returnByValue: true });
    if (r && r.result && r.result.value){
      try { return JSON.parse(Buffer.from(r.result.value, 'base64').toString('utf8')); } catch {}
    }
    await sleep(1500);
  }
  return null;
}

const deadline = Date.now() + timeoutMs;
const reports = await Promise.all(pages.map(p => waitReport(p, deadline)));

for (let i = 0; i < pages.length; i++){
  const rep = reports[i];
  const name = `座位 ${pages[i].seat}`;
  if (!rep){
    fail++;
    console.log(`✗ ${name}  ${timeoutMs / 1000}s 内没有打完（可能同步卡住）`);
    const probe = await pages[i].call('Runtime.evaluate', {
      expression: `JSON.stringify({turn:(typeof turn!=='undefined'?turn:-1),ti:(document.getElementById('turnInfo')||{}).textContent,log:(function(){var b=document.getElementById('log');return b?[...b.children].slice(-4).map(function(d){return d.textContent}):[]})()})`,
      returnByValue: true });
    if (probe && probe.result) console.log('    现场：' + probe.result.value);
    continue;
  }
  ok(rep.ok, `${name} 自检通过（回合 ${rep.round}，点击 ${rep.stats.clicks} 次，结束：${rep.endReason || '?'}）`);
  ok(rep.finished, `${name} 对局自然结束`);
  if (!rep.ok || !rep.finished){
    (rep.violations || []).slice(0, 6).forEach(v => console.log(`    ✗ [${v.code}] ${v.msg}`));
    (rep.errors || []).slice(0, 6).forEach(e => console.log(`    ! ${e}`));
    if (rep.stall) console.log(`    卡在：${JSON.stringify(rep.stall).slice(0, 400)}`);
  }
}

// ---- 4.5 未打完时探针两端连接状态 ----
for (let i = 0; i < pages.length; i++){
  const probe = await pages[i].call('Runtime.evaluate', {
    expression: `JSON.stringify({sent: window.MPNet && MPNet.sent, dropped: window.MPNet && MPNet.dropped, applying: window.Game && Game._applying, over: window.Game && gameOver})`,
    returnByValue: true });
  console.log(`    座位${pages[i].seat} 探针：${probe && probe.result ? probe.result.value : '?'}  报告=${reports[i] ? (reports[i].endReason + '/' + reports[i].finished) : '无'}`);
}

// ---- 5. 收尾 ----
for (const p of pages){
  try { p.proc.kill(); } catch {}
  try { rmSync(p.profile, { recursive: true, force: true }); } catch {}
}
host.close(); placeholder.close();
server.kill();

console.log(fail ? `\n✗ ${fail} 项未通过` : '\n✓ 联机 E2E 全部通过');
process.exit(fail ? 1 : 0);
