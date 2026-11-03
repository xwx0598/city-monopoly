// 临时验证脚本：真实的鼠标移动事件下，地块悬停卡片是否在离开地块后立即收起。
// 用法：node tools/hover-test.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BROWSER = ['C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => existsSync(p));
const GAME = path.resolve('game/html/game.html');
const PORT = 9333;
const url = `${pathToFileURL(GAME).href}?mode=ai&ai=2&map=classic&mods=synergy&seed=7&new=1`;

const profile = mkdtempSync(path.join(tmpdir(), 'cm-hover-'));
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
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
}
async function move(x, y){
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0, clickCount: 0 });
  await sleep(120);
}

// 等棋盘就绪
for (let k = 0; k < 80; k++){
  const ok = await evalJs(`!!document.getElementById('tile0')`).catch(() => false);
  if (ok) break;
  await sleep(250);
}
// 关掉可能出现的弹窗
await evalJs(`(() => { const m = document.getElementById('resumeNo'); if (m) m.click();
  document.querySelectorAll('.overlay:not(.hidden)').forEach(o => o.classList.add('hidden')); return 1; })()`);
await sleep(400);

const rect = sel => evalJs(`(() => { const el = document.querySelector('${sel}');
  if (!el) return null; const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`);

// 找一个「点击中心确实命中该地块」的地块（3D 透视下包围盒中心不一定是地块本体）
async function pickTile(){
  const n = await evalJs(`document.querySelectorAll('.tile[id^="tile"]').length`);
  for (let i = 0; i < n; i++){
    const r = await rect('#tile' + i);
    if (!r || r.w < 10) continue;
    const hit = await evalJs(`(() => { const el = document.elementFromPoint(${r.x}, ${r.y});
      const t = el && el.closest ? el.closest('.tile') : null; return t ? t.id : null; })()`);
    if (hit === 'tile' + i) return { i, ...r };
  }
  return null;
}

const tipState = () => evalJs(`(() => { const t = document.getElementById('synTip');
  return { hidden: t.classList.contains('hidden'), text: (t.textContent || '').trim().slice(0, 40) }; })()`);

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails++; };

const a = await pickTile();
check(!!a, '找到可命中的地块');
if (!a) process.exit(1);

await move(a.x, a.y);
let s = await tipState();
check(!s.hidden && s.text.length > 0, `悬停在地块 #${a.i} 上应显示卡片（当前：${s.hidden ? '隐藏' : '显示'} ${s.text}）`);

// 1) 移到棋盘中央（骰子区）——这里仍在 #board 内部，旧代码不会收到 mouseleave
const c = await rect('#center');
await move(c.x, c.y - 40);
s = await tipState();
const inBoard = await evalJs(`(() => { const el = document.elementFromPoint(${c.x}, ${c.y - 40});
  return el ? (el.closest('#board') ? 'board' : el.tagName) : 'none'; })()`);
check(s.hidden, `移到棋盘中央（命中=${inBoard}）后卡片应消失（当前：${s.hidden ? '隐藏' : '显示'}）`);

// 2) 再回到同一块地，应重新显示
await move(a.x, a.y);
s = await tipState();
check(!s.hidden, `重新悬停回地块 #${a.i} 应再次显示`);

// 3) 移到另一块地，内容应换成新的
const n = await evalJs(`document.querySelectorAll('.tile[id^="tile"]').length`);
let other = null;
for (let i = 0; i < n && !other; i++){
  if (i === a.i) continue;
  const r = await rect('#tile' + i);
  if (!r || r.w < 10) continue;
  const hit = await evalJs(`(() => { const el = document.elementFromPoint(${r.x}, ${r.y});
    const t = el && el.closest ? el.closest('.tile') : null; return t ? t.id : null; })()`);
  if (hit === 'tile' + i) other = { i, ...r };
}
if (other){
  await move(other.x, other.y);
  const s2 = await tipState();
  check(!s2.hidden && s2.text !== s.text, `移到地块 #${other.i} 卡片内容应更新（${s.text} → ${s2.text}）`);
}

// 4) 移出棋盘（顶部标题栏）
await move(10, 10);
s = await tipState();
check(s.hidden, '移出棋盘后卡片应消失');
const peer = await evalJs(`document.querySelectorAll('.tile.syn-peer').length`);
check(peer === 0, `同组高亮应一并清除（残留 ${peer} 个）`);

console.log(fails ? `\n✗ ${fails} 项不合预期` : '\n✓ 全部通过');
ws.close();
child.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch(e){}
process.exit(fails ? 1 : 0);
