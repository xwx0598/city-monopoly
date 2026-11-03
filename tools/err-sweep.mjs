// 体检：跑一整局 AI 对局（selftest 驱动），收集运行时异常 / console 错误 / 资源加载失败。
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BROWSER = ['C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => existsSync(p));
const GAME = path.resolve('game/html/game.html');
const PORT = 9338;
const url = `${pathToFileURL(GAME).href}?mode=ai&ai=2&map=classic&seed=11&fast=1&new=1&selftest=1`;

const profile = mkdtempSync(path.join(tmpdir(), 'cm-errsweep-'));
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
let seq = 0; const waiters = new Map();
const problems = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && waiters.has(m.id)){ waiters.get(m.id)(m); waiters.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown'){
    const d = m.params.exceptionDetails;
    problems.push('异常: ' + (d.exception?.description || d.text) + (d.url ? ` @${d.url.split('/').pop()}:${d.lineNumber}` : ''));
  } else if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level)){
    problems.push(`[${m.params.entry.level}] ${m.params.entry.text} ${m.params.entry.url || ''}`);
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error'){
    problems.push('console.error: ' + (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' '));
  }
};
function cdp(method, params = {}){
  const id = ++seq; ws.send(JSON.stringify({ id, method, params }));
  return new Promise(res => waiters.set(id, res));
}
await cdp('Runtime.enable');
await cdp('Log.enable');
await cdp('Page.enable');
await cdp('Network.enable');

// 等自检整局跑完
let title = '';
for (let k = 0; k < 150; k++){
  await sleep(1500);
  const r = await cdp('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
  title = r.result?.result?.value || '';
  if (/PASS|FAIL/.test(title)) break;
}
console.log('对局状态:', title);

console.log(problems.length ? '发现 ' + problems.length + ' 个问题:' : '✓ 整局无运行时异常 / console 错误 / 资源加载失败');
problems.slice(0, 20).forEach(p => console.log('  ' + p));
ws.close(); child.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch(e){}
process.exit(0);
