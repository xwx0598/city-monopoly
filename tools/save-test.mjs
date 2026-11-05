#!/usr/bin/env node
// ================================================================
// 城市大富翁 · 大厅存档显示专项（tools/save-test.mjs）
//
// 回归背景：readSlot 曾用 d.ai 校验 AI 局人数，但存档从未写入 ai 字段
// → AI×2 / AI×3 的档在大厅一律不显示（只有 AI×1 碰巧能显示）。
//
// 用法：node tools/save-test.mjs
// ================================================================
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = 'D:/code/city-monopoly';
const PORT = 8831, CDP = 9371;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = m => { pass++; console.log('  ✓ ' + m); };
const bad = m => { fail++; console.error('  ✗ ' + m); };

const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore' });
await sleep(1200);
const profile = mkdtempSync(path.join(tmpdir(), 'cm-save-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--window-size=1280,860', 'about:blank',
], { stdio: 'ignore' });

try {
  let ws;
  for (let k = 0; k < 40 && !ws; k++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch {}
    if (!ws) await sleep(250);
  }
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const w = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } };
  const cdp = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise(r => w.set(id, r)); };
  const ev = async expr => {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  const LOBBY = `http://127.0.0.1:${PORT}/lobby/html/index.html`;

  const seed = async (obj) => {
    await cdp('Page.navigate', { url: LOBBY });
    // 必须等大厅真正加载完：在 about:blank 上访问 localStorage 会抛 SecurityError，写入直接失败
    for (let k = 0; k < 40; k++) {
      if (await ev(`!!document.getElementById('goAi')`).catch(() => false)) break;
      await sleep(250);
    }
    await ev(`(() => { localStorage.clear();
      const P = n => Array.from({ length: n }, () => ({ money:1500, pos:0, props:[], bankrupt:false }));
      ${obj}
       return 1; })()`);
    await cdp('Page.reload');
    await sleep(1200);
    return ev(`[...document.querySelectorAll('.save-row')].map(e => ({
      title: e.querySelector('b').textContent, href: e.getAttribute('href') }))`);
  };

  console.log('\n[旧存档兼容：无 ai 字段的 AI×2 档]');
  let rows = await seed(`localStorage.setItem('monopoly_save_v3_ai', JSON.stringify({ v:2, mode:'ai',
      round:8, savedAt: Date.now()-120e3, players: P(3), mods:{} }));`);
  rows.length === 1 ? ok('旧格式存档能显示') : bad(`旧格式存档未显示（${rows.length} 条）`);
  const legacy = rows[0] || {};
  /2 位 AI/.test(legacy.title || '') ? ok(`标题人数正确（${legacy.title}）`) : bad('标题人数错误: ' + legacy.title);
  /ai=2/.test(legacy.href || '') ? ok('续档链接带 ai=2（否则会落到 AI×1 的档上）') : bad('续档链接缺 ai: ' + legacy.href);

  console.log('\n[新存档：AI×3 + 可玩模块]');
  rows = await seed(`localStorage.setItem('monopoly_save_v3_ai', JSON.stringify({ v:2, mode:'ai', ai:3,
      round:15, savedAt: Date.now()-30e3, players: P(4), opt:'synergy,items', mods:{} }));`);
  const n3 = rows[0] || {};
  rows.length === 1 && /3 位 AI/.test(n3.title || '') ? ok(`AI×3 存档显示（${n3.title}）`) : bad('AI×3 存档显示异常: ' + JSON.stringify(rows));
  (/mods=synergy,items/.test(n3.href || '') || /mods=synergy%2Citems/.test(n3.href || ''))
    ? ok('续档链接带回可玩模块') : bad('续档链接缺 mods: ' + n3.href);

  console.log('\n[同屏档 + 脏档过滤]');
  rows = await seed(`localStorage.setItem('monopoly_save_v3_hotseat3', JSON.stringify({ v:2, mode:'hotseat', n:3, round:6,
        savedAt: Date.now()-60e3, players: P(3), mods:{} }));
      localStorage.setItem('monopoly_save_v3_ai', JSON.stringify({ v:2, mode:'ai', ai:1, round:3,
        savedAt: Date.now(), players: P(4), mods:{} }));`);
  const hs = rows.find(r => /hotseat/.test(r.href || ''));
  hs && rows.length === 1 ? ok(`同屏档显示、脏档被过滤（共 ${rows.length} 条）`) : bad('同屏档/脏档处理异常: ' + JSON.stringify(rows));

  console.log('\n[模式卡存档小圆点]');
  const dotAi = await ev(`document.getElementById('goAi').classList.contains('has-save')`);
  const dotHs = await ev(`document.getElementById('goHotseat').classList.contains('has-save')`);
  (!dotAi && dotHs) ? ok('圆点只挂在有存档的模式上（同屏有 / AI 无）') : bad(`圆点状态异常（ai=${dotAi} hotseat=${dotHs}）`);

  ws.close();
} catch (e) {
  bad('异常: ' + e.message);
} finally {
  try { chrome.kill(); } catch {}
  try { server.kill(); } catch {}
  try { execFileSync('taskkill', ['/IM', 'chrome.exe', '/F'], { stdio: 'ignore' }); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(`\n${fail === 0 ? '✓' : '✗'} 大厅存档测试：${pass} 过 / ${fail} 败`);
process.exit(fail === 0 ? 0 : 1);
