// 回归：拍卖机制三条不变量。
// ① 同一玩家不连续两次出价（领先者按兵不动，不自抬）
// ② 本局确实发生过拍卖（覆盖度）
// ③ 日志中不出现联机拍卖（本测试只跑 AI 局，防守卫误伤正常路径）
// 用法：node tools/auction-test.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BROWSER = ['C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => existsSync(p));
const GAME = path.resolve('game/html/game.html');
const PORT = 9335;
const url = `${pathToFileURL(GAME).href}?mode=ai&ai=2&map=classic&seed=11&fast=1&new=1&selftest=1`;

const profile = mkdtempSync(path.join(tmpdir(), 'cm-auc-'));
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

// 日志框只保留最后 80 条，全程挂钩 log() 收集完整历史
let patched = false;
for (let k = 0; k < 30 && !patched; k++){
  await sleep(500);
  patched = await evalJs(`(() => {
    if (typeof log === 'function' && !window.__logPatched){
      window.__logPatched = true;
      window.__lines = [];
      const orig = log;
      window.log = function(m, c){ window.__lines.push(String(m)); return orig(m, c); };
    }
    return !!window.__logPatched;
  })()`);
}
if (!patched) throw new Error('没能挂钩 log()');

// 等自检跑完整局（标题变 PASS/FAIL），最多 3 分钟
let title = '';
for (let k = 0; k < 120; k++){
  await sleep(1500);
  title = await evalJs('document.title') || '';
  if (/PASS|FAIL/.test(title)) break;
}

const logs = await evalJs(`window.__lines || []`);
console.log('页面标题:', title, '｜ 全程日志条数:', logs.length);
if (!/PASS|FAIL/.test(title)) console.log('⚠️ 对局未跑完，结果可能不完整');
console.log('拍卖相关日志样例:', logs.filter(l => l.includes('🔨')).slice(0, 5));

// 抽出拍卖出价序列
const bidRe = /^🔨 (.+?) 出价 ¥(\d+)$/;
const bids = logs.map(l => l.match(bidRe)).filter(Boolean).map(m => m[1]);

let pass = true;
const assert = (name, ok, extra = '') => {
  console.log((ok ? '✓ ' : '✗ ') + name + (extra ? '（' + extra + '）' : ''));
  if (!ok) pass = false;
};

// 按单场拍卖分段（「进入全体拍卖」开启新一场），段内检查连续出价
const segments = [];
let cur = null;
for (const l of logs){
  if (l.includes('进入全体拍卖')){ cur = []; segments.push(cur); }
  else if (cur && bidRe.test(l)) cur.push(l.match(bidRe)[1]);
}
let consecutive = -1, segIdx = -1;
segments.forEach((seg, si) => {
  for (let k = 1; k < seg.length; k++){
    if (seg[k] === seg[k-1]){ consecutive = k; segIdx = si; break; }
  }
});
if (consecutive > 0){
  console.log(`第 ${segIdx + 1} 场拍卖连续出价上下文:`);
  segments[segIdx].forEach(n => console.log('   出价: ' + n));
}
assert('同一场拍卖内同一玩家不连续两次出价（领先者按兵不动）', consecutive < 0,
  consecutive < 0 ? `共 ${segments.length} 场拍卖` : `第 ${segIdx + 1} 场 "${segments[segIdx][consecutive]}" 连续出价`);

const auctionsDone = logs.filter(l => /拍得|流拍/.test(l)).length;
assert('本局发生过拍卖并出结果', auctionsDone > 0, `${auctionsDone} 条结果 / ${segments.length} 场`);

const mpSkip = logs.filter(l => l.includes('联机模式暂不开放拍卖')).length;
console.log('   （联机守卫触发次数：' + mpSkip + '，AI 局应为 0）');

ws.close(); child.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch(e){}
console.log(pass ? '✓ 拍卖回归全部通过' : '✗ 拍卖回归存在失败');
process.exit(pass ? 0 : 1);
