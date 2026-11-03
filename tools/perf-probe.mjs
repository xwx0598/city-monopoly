#!/usr/bin/env node
// 性能探针：跑一局全玩法 AI 对局，统计渲染函数调用次数与耗时
// 用法：node tools/perf-probe.mjs [--url=完整URL覆盖默认]
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
const PORT = 8810;
const CDP = 9330;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const httpGet = url => new Promise((resolve, reject) => {
  http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); }).on('error', reject);
});

class WS {
  constructor(sock){ this.sock = sock; this.acc = Buffer.alloc(0); this.pending = new Map(); this.id = 0;
    sock.on('data', d => {
      this.acc = Buffer.concat([this.acc, d]);
      while (this.acc.length >= 2){
        const b1 = this.acc[0], b2 = this.acc[1]; let len = b2 & 0x7f, off = 2;
        if (len === 126){ if (this.acc.length < 4) return; len = this.acc.readUInt16BE(2); off = 4; }
        else if (len === 127){ if (this.acc.length < 10) return; len = Number(this.acc.readBigUInt64BE(2)); off = 10; }
        if (this.acc.length < off + len) return;
        const payload = this.acc.subarray(off, off + len).toString('utf8'); this.acc = this.acc.subarray(off + len);
        try { const m = JSON.parse(payload);
          if (m.id && this.pending.has(m.id)){ this.pending.get(m.id)(m.result || m.error); this.pending.delete(m.id); }
        } catch {}
      }
    }); }
  send(obj){ const data = Buffer.from(JSON.stringify(obj), 'utf8'); const mask = crypto.randomBytes(4);
    let head; if (data.length < 126) head = Buffer.from([0x81, 0x80 | data.length]);
    else { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(data.length, 2); }
    const masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
    this.sock.write(Buffer.concat([head, mask, masked])); }
  call(method, params = {}){ return new Promise(res => { const id = ++this.id; this.pending.set(id, res); this.send({ id, method, params }); }); }
  close(){ try { this.sock.destroy(); } catch {} }
}
const connectCdp = (port, wsPath) => new Promise((resolve, reject) => {
  const sock = net.connect(port, '127.0.0.1'); const key = crypto.randomBytes(16).toString('base64');
  sock.once('error', reject);
  sock.once('connect', () => {
    sock.write(`GET ${wsPath} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    let head = Buffer.alloc(0);
    const onData = d => { head = Buffer.concat([head, d]); const i = head.indexOf('\r\n\r\n'); if (i < 0) return;
      sock.off('data', onData);
      if (!/101/.test(head.subarray(0, i).toString())) { reject(new Error('握手失败')); return; }
      const ws = new WS(sock); const rest = head.subarray(i + 4);
      if (rest.length){ ws.acc = Buffer.concat([ws.acc, rest]); }
      resolve(ws); };
    sock.on('data', onData); });
});

const BROWSER = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(existsSync)[0];

const server = spawn('python', ['deploy/server.py', '--no-open', '--port', String(PORT)], { cwd: ROOT });
let up = false;
for (let i = 0; i < 40 && !up; i++){
  await sleep(150);
  up = await new Promise(res => { const s = net.connect(PORT, '127.0.0.1'); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); });
}
if (!up){ console.error('服务器没起来'); process.exit(2); }

const profile = mkdtempSync(path.join(tmpdir(), 'cm-perf-'));
const proc = spawn(BROWSER, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
  `--remote-debugging-port=${CDP}`, '--user-data-dir=' + profile, '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });
let pageWs = null;
for (let i = 0; i < 50 && !pageWs; i++){
  await sleep(200);
  try {
    const list = JSON.parse(await httpGet(`http://127.0.0.1:${CDP}/json/list`));
    const page = list.find(t => t.type === 'page');
    if (page) pageWs = page.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, '');
  } catch {}
}
if (!pageWs){ console.error('DevTools 没起来'); process.exit(2); }
const cdp = await connectCdp(CDP, pageWs);
const evalJs = async expr => {
  const r = await cdp.call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r && r.result ? r.result.value : undefined;
};

// 注入探针：等核心脚本就绪后包裹渲染函数，统计调用次数/累计耗时/最长单次
await cdp.call('Page.enable');
await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: `
window.__PERF = { fns: {}, longtask: 0 };
(function(){
  function wrap(name){
    const orig = window[name];
    if (typeof orig !== 'function' || orig.__wrapped) return;
    const s = window.__PERF.fns[name] = { n: 0, t: 0, max: 0 };
    const w = function(){
      const t0 = performance.now();
      const r = orig.apply(this, arguments);
      const dt = performance.now() - t0;
      s.n++; s.t += dt; if (dt > s.max) s.max = dt;
      return r;
    };
    w.__wrapped = true;
    window[name] = w;
  }
  function wrapAll(){
    ['renderPlayers','positionTokens','refreshTile','log','updateBuildBtn'].forEach(wrap);
    if (window.Game && !window.Game.__perfMark){
      window.Game.__perfMark = 1;
      const names = Object.keys(Game.afterRender || {});
      void names;
    }
  }
  if (document.readyState === 'complete') wrapAll();
  else addEventListener('load', () => setTimeout(wrapAll, 0));
  try {
    new PerformanceObserver(list => { for (const e of list.getEntries()) window.__PERF.longtask += e.duration; })
      .observe({ entryTypes: ['longtask'] });
  } catch {}
})();
` });

const mods = 'synergy,weather,items,quests,stocks,visit,vote';
const url = `http://127.0.0.1:${PORT}/game/html/game.html?mode=ai&ai=3&map=classic&mods=${mods}&seed=404&fast=1&selftest=1&new=1`;
await cdp.call('Page.navigate', { url });

// 等对局结束（selftest 报告出现在 DOM 里）
const LIMIT = 240000;
const t0 = Date.now();
let report = false;
while (Date.now() - t0 < LIMIT){
  await sleep(1000);
  const m = await evalJs(`(document.body.textContent.match(/SELFTESTBASE64:([A-Za-z0-9+\\/=]+)/) || [])[1] || ''`);
  if (m){ report = true; break; }
}
const wall = ((Date.now() - t0) / 1000).toFixed(1);
if (!report){
  // 超时时打印进度，区分「慢」与「卡死」
  const prog = await evalJs(`(function(){
    try {
      const t = document.querySelector('#turnInfo')?.textContent || '';
      const r = (document.querySelector('#roundInfo')?.textContent || '');
      const logLen = document.querySelectorAll('#log > div').length;
      return t + ' | ' + r + ' | 日志 ' + logLen + ' 条';
    } catch(e){ return '进度未知: ' + e.message; }
  })()`);
  console.log(`⚠ ${LIMIT / 1000}s 内没等到对局结束，当前进度: ${prog}`);
} else console.log(`对局完成，墙钟 ${wall}s（含探针启动）`);

const perf = await evalJs(`JSON.stringify(window.__PERF)`);
const data = JSON.parse(perf);
let renderSum = 0, renderN = 0;
console.log('\n函数             调用次数   累计ms   最长单次ms');
for (const [name, s] of Object.entries(data.fns)){
  console.log(`${name.padEnd(16)} ${String(s.n).padStart(6)}   ${s.t.toFixed(1).padStart(7)}   ${s.max.toFixed(2).padStart(8)}`);
  if (name === 'renderPlayers'){ renderSum = s.t; renderN = s.n; }
}
console.log(`\nlongtask 累计: ${data.longtask.toFixed(0)}ms`);
if (renderN) console.log(`renderPlayers 平均 ${(renderSum / renderN).toFixed(2)}ms/次`);

proc.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch {}
server.kill();
process.exit(0);
