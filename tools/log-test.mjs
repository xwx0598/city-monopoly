// 回归：行动日志是有限高度的框，超出部分框内滚动，且不把整页撑长。
// 用法：node tools/_log-test.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BROWSER = ['C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => existsSync(p));
const GAME = path.resolve('game/html/game.html');
const PORT = 9334;
const url = `${pathToFileURL(GAME).href}?mode=ai&ai=2&map=classic&mods=synergy&seed=7&fast=1&new=1&selftest=1`;

const profile = mkdtempSync(path.join(tmpdir(), 'cm-log-'));
const child = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1440,900', url], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function targetWs(){
  for (let k = 0; k < 60; k++){
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes('game.html'));
      if (page) return page.webSocketDebuggerUrl;
    } catch(e){}
    await sleep(250);
  }
  throw new Error('浏览器没起来');
}

const ws = new WebSocket(await targetWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const waiters = new Map();
ws.onmessage = ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && waiters.has(msg.id)){ waiters.get(msg.id)(msg); waiters.delete(msg.id); }
};
function cdp(method, params = {}){
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise(res => waiters.set(id, res));
}
async function evalJs(expr){
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result?.result?.value;
}

// 等 AI 对局跑出足够多的日志（fast=1 下每回合很快）
let lines = 0;
for (let k = 0; k < 40; k++){
  await sleep(1500);
  lines = await evalJs(`document.querySelectorAll('#log > div').length`);
  if (lines >= 60) break;
}

const m = await evalJs(`(() => {
  const log = document.querySelector('#log');
  return {
    lines: log.children.length,
    clientH: log.clientHeight,
    scrollH: log.scrollHeight,
    scrollable: log.scrollHeight > log.clientHeight + 4,
    atBottom: Math.abs(log.scrollTop + log.clientHeight - log.scrollHeight) < 8,
    scrollTop: Math.round(log.scrollTop),
    pageOverflow: document.documentElement.scrollHeight - window.innerHeight,
    sidebarH: document.querySelector('.sidebar').offsetHeight,
    stageH: document.querySelector('.stage').offsetHeight,
  };
})()`);

// 基线：清空日志内容后的页面溢出（棋盘 3D 倾斜投影等既有因素），与日志条数无关
const baseline = await evalJs(`(() => {
  const log = document.querySelector('#log');
  const h = log.clientHeight;
  log.innerHTML = '';
  const ov = document.documentElement.scrollHeight - window.innerHeight;
  log.style.minHeight = h + 'px';  // 撑回原高度，排除清空本身的影响
  return ov;
})()`);

console.log('日志条数:', m.lines);
console.log('日志框高度:', m.clientH + 'px（内容高 ' + m.scrollH + 'px）');
console.log('框内可滚动:', m.scrollable ? '是 ✓' : '否 ✗');
console.log('自动滚到底:', m.atBottom ? '是 ✓' : '否 ✗（scrollTop=' + m.scrollTop + '）');
console.log('页面纵向溢出: 满日志 ' + m.pageOverflow + 'px / 清空基线 ' + baseline + 'px' +
  (m.pageOverflow <= baseline + 2 ? ' ✓ 未被日志撑长' : ' ✗ 被日志撑长了'));
console.log('侧栏高:', m.sidebarH + 'px / 棋盘区高:', m.stageH + 'px');

let pass = true;
const assert = (name, ok) => { if (!ok){ pass = false; console.log('✗ ' + name); } };
assert('日志条数足够多（>=60）', m.lines >= 60);
assert('日志框高度有限（<= 420px）', m.clientH > 0 && m.clientH <= 420);
assert('框内可滚动', m.scrollable);
assert('自动滚到底', m.atBottom);
assert('页面高度不随日志增长（满日志溢出 <= 基线 + 2px）', m.pageOverflow <= baseline + 2);
assert('侧栏不超过棋盘区高度', m.sidebarH <= m.stageH);

ws.close(); child.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch(e){}
console.log(pass ? '✓ 日志框行为验证全部通过' : '✗ 存在失败断言');
process.exit(pass ? 0 : 1);
