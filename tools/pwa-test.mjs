#!/usr/bin/env node
// ================================================================
// PWA 验证（tools/pwa-test.mjs）
//
// 起本地服务（localhost = 安全上下文，SW 可注册），用 CDP 断言：
//   ① manifest 可拉取且字段齐全（图标 192/512、start_url、standalone）
//   ② Service Worker 注册成功并激活
//   ③ 页面受 SW 控制
//   ④ 【核心】断网后：大厅仍能打开、对局页棋盘仍能渲染（缓存命中，
//      含 ?v= 版本参数的资产靠 ignoreSearch 命中）
//   ⑤ 全程无运行时异常 / console 错误 / 资源加载失败
//
// 用法：node tools/pwa-test.mjs
// 退出码 0 = 全部通过。
// ================================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = 8823;
const CDP = 9352;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BROWSER = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);

const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore' });
await sleep(1200);

const profile = mkdtempSync(path.join(tmpdir(), 'cm-pwa-'));
const child = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile,
  '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

let ws = null;
for (let k = 0; k < 60 && !ws; k++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
    const page = list.find(t => t.type === 'page');
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch (e) { }
  if (!ws) await sleep(250);
}
if (!ws) { console.error('✗ 浏览器没起来'); process.exit(2); }
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0; const waiters = new Map();
const problems = [];
const NOISE = /favicon\.ico/;
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    problems.push('异常: ' + (d.exception?.description || d.text || '').split('\n')[0]);
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error'
    && !NOISE.test(m.params.entry.text + (m.params.entry.url || ''))) {
    problems.push('[error] ' + m.params.entry.text);
  } else if (m.method === 'Network.responseReceived') {
    const r = m.params.response;
    if (r.status >= 400 && !NOISE.test(r.url)) problems.push(`HTTP ${r.status} ${r.url}`);
  }
};
const cdp = (method, params = {}) => {
  const id = ++seq; ws.send(JSON.stringify({ id, method, params }));
  return new Promise(res => waiters.set(id, res));
};
const evalJs = async expr => {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.text };
  return r.result?.result?.value;
};

await cdp('Runtime.enable'); await cdp('Log.enable');
await cdp('Page.enable'); await cdp('Network.enable');

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
};

// ---------- ① 打开大厅，注册 SW ----------
await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/lobby/html/index.html` });
await sleep(2500);

const mf = await evalJs(`fetch('/manifest.webmanifest').then(r => r.json()).then(m => ({
  name: m.name, display: m.display, start: m.start_url,
  icons: (m.icons || []).map(i => i.sizes).join(','),
}))`);
ok(mf && mf.name === '城市大富翁', `manifest 字段（name=${mf?.name}）`);
ok(mf && mf.display === 'standalone', 'display: standalone');
ok(mf && /192x192/.test(mf.icons) && /512x512/.test(mf.icons), `图标尺寸（${mf?.icons}）`);

const swActive = await evalJs(
  `navigator.serviceWorker.ready.then(r => !!r.active).catch(() => false)`);
ok(swActive === true, 'Service Worker 注册并激活');

// ---------- ② 刷新一次，确认页面受 SW 控制 ----------
await cdp('Page.reload');
await sleep(2000);
const controlled = await evalJs(`!!navigator.serviceWorker.controller`);
ok(controlled === true, '页面受 SW 控制（可接管离线请求）');

// ---------- ③ 核心断言：断网仍可玩 ----------
await cdp('Network.emulateNetworkConditions',
  { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await cdp('Page.reload');
await sleep(1800);
const lobbyOffline = await evalJs(
  `!!document.querySelector('#goAi') && !!document.querySelector('#goOnline')`);
ok(lobbyOffline === true, '断网后大厅仍能打开（缓存命中）');

await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/game/html/game.html?mode=ai&ai=2&map=classic&fast=1&new=1` });
await sleep(3000);
const gameOffline = await evalJs(
  `document.querySelectorAll('#board .tile').length + '/' + (document.querySelector('#log')?.children.length || 0)`);
ok(/^2[0-9]\/[1-9]/.test(gameOffline), `断网后对局页棋盘照常渲染（棋盘/日志 = ${gameOffline}）`);
ok(gameOffline.startsWith('24'), '带 ?v= 的资产靠 ignoreSearch 正常命中（24 格 = 经典图）');

// ---------- ④ 恢复在线收尾 ----------
await cdp('Network.emulateNetworkConditions',
  { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

console.log('');
const errCount = problems.length;
if (errCount) { fail += errCount; problems.slice(0, 10).forEach(p => console.log('  ✗ ' + p)); }

console.log(`\n${fail === 0 ? '✓ PWA 验证全部通过' : '✗ ' + fail + ' 项未通过'}　通过 ${pass} / 失败 ${fail}`);
ws.close(); child.kill(); server.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(fail === 0 ? 0 : 1);
