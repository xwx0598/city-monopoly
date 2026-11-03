#!/usr/bin/env node
// ================================================================
// 页面级冒烟（tools/page-smoke.mjs）
//
// 起一个静态服务，用 CDP 依次打开四个入口，检查：
//   ① 加载期无运行时异常 / console 错误 / 资源 404
//   ② 关键 DOM 真的渲染出来了（棋盘格、日志、大厅按钮、编辑器预览）
// 顺便给每页存一张截图到 .shots/。
// 用法：node tools/page-smoke.mjs
// ================================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = 8822;
const CDP = 9350;
const BROWSER = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = path.join(ROOT, '.shots');
mkdirSync(SHOTS, { recursive: true });

const PAGES = [
  { name: '入口重定向', url: `http://127.0.0.1:${PORT}/index.html`, wait: 1200,
    check: `({ ok: location.pathname.includes('/lobby/html/index.html'), info: location.pathname })` },
  { name: '大厅首页', url: `http://127.0.0.1:${PORT}/lobby/html/index.html`, wait: 1500,
    check: `({ ok: !!document.querySelector('#goAi') && !!document.querySelector('#goOnline') &&
              [...document.querySelectorAll('button')].length >= 3,
              info: document.querySelectorAll('button').length + ' 个按钮' })` },
  { name: '地图编辑器', url: `http://127.0.0.1:${PORT}/lobby/html/editor.html`, wait: 2000,
    check: `({ ok: (document.querySelector('#edBoard')?.children.length||0) >= 12 &&
              (document.querySelector('#tileList')?.children.length||0) >= 12,
              info: '预览 ' + (document.querySelector('#edBoard')?.children.length||0) + ' 格 / 列表 ' +
                    (document.querySelector('#tileList')?.children.length||0) + ' 项' })` },
  { name: '对局页·全玩法', url: `http://127.0.0.1:${PORT}/game/html/game.html?mode=ai&ai=3&map=classic&fast=1&new=1`, wait: 2500,
    check: `({ ok: document.querySelectorAll('#board .tile').length >= 20 &&
              (document.querySelector('#log')?.children.length||0) > 0,
              info: '棋盘 ' + document.querySelectorAll('#board .tile').length + ' 格 / 日志 ' +
                    (document.querySelector('#log')?.children.length||0) + ' 条' })` },
];

// ---------- 静态服务 ----------
const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore' });
await sleep(1200);

// ---------- 浏览器 ----------
const profile = mkdtempSync(path.join(tmpdir(), 'cm-smoke-'));
const child = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile,
  '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

let ws;
for (let k = 0; k < 60 && !ws; k++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
    const page = list.find(t => t.type === 'page');
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch (e) { }
  if (!ws) await sleep(250);
}
if (!ws) { console.log('✗ 浏览器没起来'); process.exit(1); }
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0; const waiters = new Map();
let problems = [];
const NOISE = /favicon\.ico/;   // 没放站点图标，404 无害，不计入
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    problems.push('异常: ' + (d.exception?.description || d.text || '').split('\n')[0]);
  } else if (m.method === 'Log.entryAdded') {
    const e = m.params.entry;
    if (e.level === 'error' && !NOISE.test(e.text + (e.url || ''))) problems.push(`[error] ${e.text} ${(e.url || '').split('/').pop()}`);
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    problems.push('console.error: ' + (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' '));
  } else if (m.method === 'Network.responseReceived') {
    const r = m.params.response;
    if (r.status >= 400 && !r.url.startsWith('data:') && !NOISE.test(r.url)) problems.push(`HTTP ${r.status} ${r.url}`);
  }
};
const cdp = (method, params = {}) => {
  const id = ++seq; ws.send(JSON.stringify({ id, method, params }));
  return new Promise(res => waiters.set(id, res));
};
await cdp('Runtime.enable'); await cdp('Log.enable');
await cdp('Page.enable'); await cdp('Network.enable');

let pass = 0, fail = 0;
for (const p of PAGES) {
  problems = [];
  await cdp('Page.navigate', { url: p.url });
  await sleep(p.wait);
  const r = await cdp('Runtime.evaluate', { expression: p.check, returnByValue: true });
  const v = r.result?.result?.value || {};
  const okDom = !!v.ok;
  const okErr = problems.length === 0;
  if (okDom && okErr) { pass++; console.log(`  ✓ ${p.name}　${v.info || ''}`); }
  else {
    fail++;
    console.log(`  ✗ ${p.name}　DOM=${okDom ? 'ok' : 'FAIL(' + (v.info || '') + ')'} 异常=${problems.length}`);
    problems.slice(0, 8).forEach(x => console.log('      ' + x));
  }
  const shot = await cdp('Page.captureScreenshot', { format: 'png' });
  if (shot.result?.data) {
    writeFileSync(path.join(SHOTS, `smoke-${PAGES.indexOf(p)}.png`), Buffer.from(shot.result.data, 'base64'));
  }
}

console.log(`\n${fail === 0 ? '✓ 页面冒烟全部通过' : '✗ ' + fail + ' 个页面有问题'}　通过 ${pass} / 失败 ${fail}`);
ws.close(); child.kill(); server.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(fail === 0 ? 0 : 1);
