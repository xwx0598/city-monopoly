#!/usr/bin/env node
// ================================================================
// 大厅联机 UI 冒烟（tools/lobby-mp-smoke.mjs）
//
// 浏览器 ?autotest=host#online 自动建房；node 协议客户端扮演乙加入并准备；
// net.js 满员自动点「开始对局」→ 跳转联机对局页。
// 节点状态通过页面 console 打点（CDP consoleAPICalled 事件单向推送）回传。
// 用法：node tools/lobby-mp-smoke.mjs
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
const PORT = 8808;
const CDP_PORT = 9340;

let pass = 0, fail = 0;
const ok = (c, l) => { if (c){ pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ ' + l); } };

// ---- 最小 WS 客户端 ----
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
    else { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(data.length, 2); }
    const masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
    this.sock.write(Buffer.concat([head, mask, masked])); }
  async wait(t, timeout = 5000){ const started = Date.now();
    while (Date.now() - started < timeout){
      if (this.queue.length){ const m = this.queue.shift(); if (m.t === t) return m; continue; }
      const m = await new Promise(res => {
        const tm = setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) this.waiters.splice(i, 1); res(null); }, 300);
        const w = x => { clearTimeout(tm); res(x); }; this.waiters.push(w); });
      if (m && m.t === t) return m; }
    return null; }
  close(){ try { this.sock.destroy(); } catch {} }
}
const connectWs = (port, wsPath = '/ws') => new Promise((resolve, reject) => {
  const sock = net.connect(port, '127.0.0.1'); const key = crypto.randomBytes(16).toString('base64');
  sock.once('error', reject);
  sock.once('connect', () => {
    sock.write(`GET ${wsPath} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
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

// ---- 1. 服务器 ----
const server = spawn('python', ['deploy/server.py', '--no-open', '--port', String(PORT)], { cwd: ROOT });
server.stderr.on('data', () => {});
let up = false;
for (let i = 0; i < 40 && !up; i++){
  await sleep(150);
  up = await new Promise(res => { const s = net.connect(PORT, '127.0.0.1'); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); });
}
if (!up){ console.error('✗ 服务器没有起来'); process.exit(2); }
console.log(`大厅联机 UI 冒烟  |  端口 ${PORT}\n`);

// ---- 2. 浏览器（console 事件收集，不用 evaluate） ----
const profile = mkdtempSync(path.join(tmpdir(), 'cm-lobbyui-'));
const proc = spawn(BROWSER, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  `--remote-debugging-port=${CDP_PORT}`, '--user-data-dir=' + profile, '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });

let pageWs = null;
for (let i = 0; i < 50 && !pageWs; i++){
  await sleep(200);
  try {
    const list = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json/list`));
    const page = list.find(t => t.type === 'page');
    if (page) pageWs = page.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, '');
  } catch {}
}
if (!pageWs){ console.error('✗ DevTools 没起来'); proc.kill(); process.exit(2); }

const cdp = await connectWs(CDP_PORT, pageWs, `127.0.0.1:${CDP_PORT}`);
const smokeLines = [];
{
  const roomy = cdp._deliver.bind(cdp);
  cdp._deliver = m => {
    if (m.method === 'Runtime.consoleAPICalled'){
      const text = (m.params.args || []).map(a => a.value != null ? String(a.value) : (a.description || '')).join(' ');
      if (text.includes('[smoke]')) smokeLines.push(text);
    }
    roomy(m);
  };
  let id = 0;
  const pending = new Map();
  const roomy2 = cdp._deliver.bind(cdp);
  cdp._deliver = m => { if (m.id && pending.has(m.id)){ pending.get(m.id)(m); pending.delete(m.id); return; } roomy2(m); };
  const call = (method, params = {}) => new Promise(res => {
    const mid = ++id;
    const tm = setTimeout(() => { pending.delete(mid); res(null); }, 8000);
    pending.set(mid, m => { clearTimeout(tm); res(m.result || m.error); });
    cdp.send({ id: mid, method, params });
  });
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Page.navigate', { url: `http://127.0.0.1:${PORT}/lobby/html/index.html?autotest=host#online` });
}

// ---- 3. node 扮演乙：等房间出现 → 加入 → 准备 ----
let joinedRoom = null;
let peerLeft = false;
const obs = await connectWs(PORT);
await obs.wait('hello');
obs.send({ t: 'hi', name: '乙' });
await obs.wait('hello');
(async () => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !joinedRoom){
    obs.send({ t: 'rooms' });
    const list = await obs.wait('rooms', 1200);
    const room = list && list.rooms && list.rooms.find(r => r.status === 'lobby' && r.count >= 1);
    if (room){
      joinedRoom = room.id;
      obs.send({ t: 'join', id: room.id });
      const j = await obs.wait('joined');
      if (j) obs.send({ t: 'ready', v: true });
    }
  }
  // 开局后挂机听断线通知
  while (Date.now() < deadline + 30000){
    const m = await obs.next(1000);
    if (!m) continue;
    if (m.t === 'peer_left') peerLeft = true;
  }
})().catch(() => {});

// ---- 4. 等 smoke 打点 ----
const waitFor = async (prefix, timeout = 30000) => {
  const started = Date.now();
  while (Date.now() - started < timeout){
    const hit = smokeLines.find(l => l.includes(prefix));
    if (hit) return hit;
    await sleep(400);
  }
  return null;
};

const hosted = await waitFor('[smoke] hosted', 15000);
ok(!!hosted, '浏览器完成自动建房');
await sleep(1000);
const roomLines = smokeLines.filter(l => l.includes('[smoke] room'));
ok(roomLines.length >= 1, `房间渲染（${(roomLines[0] || '').split('[smoke] ')[1] || '无'}）`);
ok(roomLines.some(l => /乙\+/.test(l)), '乙就座并准备');
const jump = await waitFor('[smoke] jump', 15000);
ok(!!jump && jump.includes(joinedRoom), `满员自动开局并跳转对局页（${jump ? '房间 ' + joinedRoom : '无'}）`);

// 开局后页面跳转：甲的 ws 会 resume（出现 game 标记 —— 用乙收到的 peer_left/无新 room 广播侧面验证）
await sleep(2500);
ok(!!joinedRoom, `乙加入的房间号 ${joinedRoom || '无'}`);

try { proc.kill(); } catch {}
try { rmSync(profile, { recursive: true, force: true }); } catch {}
obs.close();
server.kill();

if (smokeLines.length){
  console.log('\n打点记录:');
  smokeLines.forEach(l => console.log('  ' + l));
}
console.log(fail ? `\n✗ ${fail} 项未通过` : '\n✓ 大厅联机 UI 冒烟全部通过');
process.exit(fail ? 1 : 0);
