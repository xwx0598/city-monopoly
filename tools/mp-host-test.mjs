#!/usr/bin/env node
// ================================================================
// 断线托管 E2E（tools/mp-host-test.mjs）
//
// 浏览器 ?autotest=host#online 自动建房（甲，座位 0）；node 客户端扮演乙（座位 1）
// 加入并准备 → 满员自动开局。乙保持 WS 在线，甲的回合由 CDP 自动点击推进；
// 几轮后乙掉线 → 断言甲页面出现「AI 代打」且乙的回合被 AI 接管（日志继续推进）。
// 用法：node tools/mp-host-test.mjs
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
const PORT = 8814;
const CDP_PORT = 9344;

let pass = 0, fail = 0;
const ok = (c, l) => { if (c){ pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ ' + l); } };

// ---- 最小 WS 客户端（与 lobby-mp-smoke 相同） ----
class WS {
  constructor(sock){ this.sock = sock; this.buf = Buffer.alloc(0); this.queue = []; this.waiters = [];
    sock.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this._parse(); }); }
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
console.log(`断线托管 E2E  |  端口 ${PORT}\n`);

// ---- 2. 浏览器 + CDP ----
const profile = mkdtempSync(path.join(tmpdir(), 'cm-hosttest-'));
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

const cdp = await connectWs(CDP_PORT, pageWs);
let id = 0;
const pending = new Map();
cdp._deliver = m => { if (m.id && pending.has(m.id)){ pending.get(m.id)(m); pending.delete(m.id); } };
const call = (method, params = {}) => new Promise(res => {
  const mid = ++id;
  const tm = setTimeout(() => { pending.delete(mid); res(null); }, 6000);
  pending.set(mid, m => { clearTimeout(tm); res(m.result || m.error); });
  cdp.send({ id: mid, method, params });
});
// 带重试的 evaluate（headless 偶发不响应）
const evalJs = async (expr, tries = 3) => {
  for (let k = 0; k < tries; k++){
    const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.result && 'value' in r.result) return r.result.value;
    await sleep(300);
  }
  return undefined;
};
await call('Page.enable');
await call('Runtime.enable');
await call('Page.navigate', { url: `http://127.0.0.1:${PORT}/lobby/html/index.html?autotest=host#online` });

// ---- 3. 乙加入并准备 ----
const obs = await connectWs(PORT);
await obs.wait('hello');
obs.send({ t: 'hi', name: '乙' });
await obs.wait('hello');
let joinedRoom = null;
{
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
}
ok(!!joinedRoom, '乙加入房间 ' + (joinedRoom || '（无）'));

// ---- 4. 等对局页就绪 ----
const waitGameReady = async (timeout = 30000) => {
  const started = Date.now();
  while (Date.now() - started < timeout){
    const url = await evalJs('location.pathname + location.search', 1);
    if (url && url.includes('mode=mp')) return url;
    await sleep(500);
  }
  return null;
};
const gameUrl = await waitGameReady();
ok(!!gameUrl, '自动开局并跳转对局页');

// ---- 5. 自动点击器：甲的回合推进（掷骰 / 确认弹窗） ----
const CLICKER = `(() => {
  const g = id => document.getElementById(id);
  const vis = el => el && !el.classList.contains('hidden');
  for (const [mid, btn] of [['buyModal','buyYes'],['cardModal','cardOk'],['noticeModal','noticeOk'],['jailModal','jailBail']]){
    if (vis(g(mid))){ const b = g(btn); if (b && !b.disabled){ b.click(); return 'click:' + btn; } }
  }
  const roll = g('rollBtn');
  if (roll && !roll.disabled){ roll.click(); return 'roll'; }
  return 'idle';
})()`;
let clicks = 0;
const clickerTimer = setInterval(async () => {
  const r = await evalJs(CLICKER, 1);
  if (r && r !== 'idle') clicks++;
}, 900);

// 等甲至少行动过一次（日志出现「甲 掷出」）
const logText = () => evalJs(`(document.getElementById('log') || {innerText:''}).innerText`, 2);
const waitLog = async (re, timeout = 30000) => {
  const started = Date.now();
  while (Date.now() - started < timeout){
    const txt = await logText();
    if (txt && re.test(txt)) return true;
    await sleep(600);
  }
  return false;
};
const actedA = await waitLog(/甲 掷出|甲 蹲监狱|甲 获得|甲 在|甲 支付/);
ok(actedA, `甲的回合已推进（自动点击 ${clicks} 次）`);

// ---- 6. 乙掉线 → 托管 ----
obs.close();
await sleep(500);

const hostedMsg = await waitLog(/AI 代打/, 12000);
ok(hostedMsg, '甲页面出现「AI 代打」提示');

// 托管后乙（AI 代打）继续行动：日志出现「乙 掷出」
const botActing = await waitLog(/乙 掷出/, 30000);
ok(botActing, '掉线玩家的回合由 AI 接管（乙 掷出）');

// 对局整体仍在推进：等待期间日志持续增长
const len1 = ((await logText()) || '').length;
await sleep(6000);
const len2 = ((await logText()) || '').length;
ok(len2 > len1, `对局未停摆（日志 ${len1} → ${len2} 字符）`);

const turnInfo = await evalJs(`(document.getElementById('turnInfo') || {textContent:''}).textContent`, 2);
console.log('  [状态] turnInfo = ' + turnInfo);

clearInterval(clickerTimer);
try { proc.kill(); } catch {}
try { rmSync(profile, { recursive: true, force: true }); } catch {}
server.kill();
console.log(fail ? `\n✗ ${fail} 项未通过` : '\n✓ 断线托管 E2E 全部通过');
process.exit(fail ? 1 : 0);
