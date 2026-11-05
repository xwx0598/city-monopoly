#!/usr/bin/env node
// ================================================================
// 城市大富翁 · 桌面版专项验证（tools/desktop-test.mjs）
//
// 验证对象是壳的资源链路：起 Neutralino 内部服务器 → 无头浏览器
// 以相同 origin 访问 → 断言开始菜单交互与对局页启动。
// （窗口本身是否正常显示由用户肉眼确认，沙箱里无法截图 WebView2。）
//
// 用法：node tools/desktop-test.mjs
// 退出码 0=全部通过。
// ================================================================
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(HERE, '..');
const DESKTOP = path.join(ROOT, 'desktop');
const EXE = path.join(DESKTOP, 'bin/neutralino-win_x64.exe');
const PORT = 8899, CDP = 9361;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, failCount = 0;
const ok = m => { pass++; console.log('  ✓ ' + m); };
const bad = m => { failCount++; console.error('  ✗ ' + m); };

// ---------- 1. 起 Neutralino（内部静态服务器）----------
const neu = spawn(EXE, ['--load-dir-res', `--path=${DESKTOP}`, `--port=${PORT}`],
  { cwd: DESKTOP, stdio: 'ignore' });
await sleep(2500);
if (neu.pid === undefined) { console.error('✗ Neutralino 启动失败'); process.exit(1); }

let chrome;
try {
  // ---------- 2. 起 CDP 浏览器 ----------
  const profile = mkdtempSync(path.join(tmpdir(), 'cm-dt-'));
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--disable-extensions', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', `--remote-debugging-port=${CDP}`,
    `--user-data-dir=${profile}`, '--window-size=1280,800', 'about:blank',
  ], { stdio: 'ignore' });

  let ws;
  for (let k = 0; k < 40 && !ws; k++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch {}
    if (!ws) await sleep(250);
  }
  if (!ws) throw new Error('CDP 连不上');
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let seq = 0; const waiters = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  const cdp = (method, params = {}) => {
    const id = ++seq; ws.send(JSON.stringify({ id, method, params }));
    return new Promise(r => waiters.set(id, r));
  };
  const ev = async expr => {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };
  await cdp('Page.enable'); await cdp('Runtime.enable');

  // ---------- 3. 开始菜单交互 ----------
  console.log('\n[壳配置]');
  // 固定端口是存档能跨启动保留的前提：localStorage 按 origin（含端口）隔离，
  // port=0 会让每次启动都是新 origin，存档等于「重启即失忆」
  const cfg = JSON.parse(readFileSync(path.join(ROOT, 'desktop/neutralino.config.json'), 'utf8'));
  (Number.isInteger(cfg.port) && cfg.port > 0)
    ? ok(`监听端口固定（${cfg.port}），存档可跨启动保留`)
    : bad(`port 必须是固定正整数（当前 ${cfg.port}）——否则存档每次重启都会丢`);

  console.log('\n[开始菜单]');
  await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(1200);

  const title = await ev(`document.querySelector('h1')?.textContent || ''`);
  title.replace(/\s/g, '').includes('大富翁') ? ok(`菜单页加载（${title.replace(/\s/g, '')}）`) : bad('菜单页标题异常: ' + title);

  const saveRowHidden = await ev(`document.getElementById('saveRow').classList.contains('hidden')`);
  saveRowHidden ? ok('无存档时隐藏「本机存档」区') : bad('无存档时不应显示存档区');

  // 预置三种存档：AI×3（新格式带 opt）、AI×1（旧格式无 ai 字段）、同屏 3 人；另加一条人数不自洽的脏档
  // 刷新后应只列出 3 条，且续档链接各自带上正确参数（这是「存档显示不出来」的核心回归）
  await ev(`(() => {
    const P = n => Array.from({ length: n }, () => ({ money: 1500, pos: 0, props: [], bankrupt: false }));
    localStorage.clear();
    localStorage.setItem('monopoly_save_v3_ai', JSON.stringify({ v:2, mode:'ai', ai:3, round:12,
      savedAt: Date.now() - 60e3, players: P(4), opt:'synergy,items', mods:{} }));
    localStorage.setItem('monopoly_save_v3_hotseat3', JSON.stringify({ v:2, mode:'hotseat', n:3, round:5,
      savedAt: Date.now() - 3600e3, players: P(3), mods:{} }));
    localStorage.setItem('monopoly_save_v3_hotseat4', JSON.stringify({ v:2, mode:'hotseat', n:4, round:9,
      savedAt: Date.now() - 7200e3, players: P(2), mods:{} }));   // 人数不自洽 → 应被过滤
    return 1; })()`);
  await cdp('Page.reload');
  await sleep(1000);
  const rows = await ev(`[...document.querySelectorAll('.save-item')].map(e => ({
    title: e.querySelector('b').textContent, url: e.dataset.url }))`);
  const rowTitles = rows.map(r => r.title).join(' | ');
  rows.length === 2
    ? ok(`存档列表显示 2 条（${rowTitles}）`)
    : bad(`存档列表数量异常：${rows.length} 条 — ${rowTitles}`);
  const aiRow = rows.find(r => r.url.includes('mode=ai'));
  const hsRow = rows.find(r => r.url.includes('mode=hotseat'));
  (aiRow && aiRow.url.includes('ai=4') === false && aiRow.url.includes('ai=3') &&
   aiRow.url.includes('mods=synergy%2Citems') && aiRow.url.includes('autoload=1'))
    ? ok(`AI 档续档链接正确（${aiRow.url}）`)
    : bad('AI 档续档链接异常: ' + (aiRow && aiRow.url));
  (hsRow && hsRow.url.includes('n=3'))
    ? ok(`同屏档续档链接正确（${hsRow.url}）`)
    : bad('同屏档续档链接异常: ' + (hsRow && hsRow.url));
  const dirtyHidden = await ev(`![...document.querySelectorAll('.save-item')].some(e => e.dataset.url.includes('n=4'))`);
  dirtyHidden ? ok('人数不自洽的脏档被过滤') : bad('脏档未被过滤');

  // 切到同屏 4 人 + 繁华都会 + 羁绊，点开始，断言跳转参数（先清档，避免触发「覆盖存档」二次确认）
  await ev(`localStorage.clear(); 1`);
  await cdp('Page.reload');
  await sleep(800);
  await ev(`document.querySelector('#modeSegs .seg[data-mode=hotseat]').click();
            document.querySelector('#hsRow .seg[data-n="4"]').click();
            document.querySelector('#mapSegs .seg[data-map=metro]').click();
            document.querySelector('#modSegs .mod[data-mod=synergy]').click(); 1`);
  const aiHidden = await ev(`document.getElementById('aiRow').style.display === 'none' && document.getElementById('hsRow').style.display !== 'none'`);
  aiHidden ? ok('切换同屏模式后区域联动正确') : bad('模式切换联动异常');
  await ev(`document.getElementById('startBtn').click(); 1`);
  await sleep(1500);
  const loc = await ev(`location.search`);
  const q = new URLSearchParams(loc);
  (q.get('mode') === 'hotseat' && q.get('n') === '4' && q.get('map') === 'metro' &&
   q.get('mods') === 'synergy' && q.get('new') === '1')
    ? ok(`跳转参数正确（${loc}）`)
    : bad('跳转参数异常: ' + loc);

  // ---------- 4. 对局页经壳服务器正常启动（整局逻辑已由 selftest 覆盖，这里只验启动）----------
  console.log('\n[对局页 · 壳服务器]');
  await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/game.html?mode=ai&ai=2&map=mini&seed=5&fast=1&new=1` });
  await sleep(2500);
  const tiles = await ev(`document.querySelectorAll('#board .tile').length`);
  const pcards = await ev(`document.querySelectorAll('.pcard').length`);
  const logs = await ev(`(document.querySelector('#log')?.children.length) || 0`);
  (tiles >= 20 && pcards >= 3 && logs > 0)
    ? ok(`对局页启动正常（棋盘 ${tiles} 格 / ${pcards} 张玩家卡 / 日志 ${logs} 条）`)
    : bad(`对局页启动异常（${tiles} 格 / ${pcards} 卡 / ${logs} 日志）`);

  // ---------- 5. 可选玩法模块（用户报的问题①：开羁绊后没有地块提示卡）----------
  console.log('\n[可选玩法 · 羁绊 + 地块提示卡]');
  await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/game.html?mode=ai&ai=2&map=mini&seed=5&mods=synergy&fast=1&new=1` });
  for (let k = 0; k < 40; k++) {
    if (await ev(`!!document.getElementById('tile0')`)) break;
    await sleep(250);
  }
  await ev(`(() => { const m = document.getElementById('resumeNo'); if (m) m.click();
    document.querySelectorAll('.overlay:not(.hidden)').forEach(o => o.classList.add('hidden')); return 1; })()`);
  await sleep(300);

  const hasSynBtn = await ev(`!!document.getElementById('synBtn')`);
  hasSynBtn ? ok('羁绊模块已加载（顶栏出现 🧩 羁绊入口）') : bad('羁绊模块未加载 —— 可选玩法缺失');

  // 找一块「包围盒中心确实命中」的地块，发真实鼠标事件触发悬停卡
  const nTile = await ev(`document.querySelectorAll('.tile[id^="tile"]').length`);
  let hovered = false;
  for (let i = 0; i < nTile && !hovered; i++) {
    const r = await ev(`(() => { const el = document.getElementById('tile${i}');
      if (!el) return null; const b = el.getBoundingClientRect();
      return (b.width < 10) ? null : { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    if (!r) continue;
    const hit = await ev(`(() => { const el = document.elementFromPoint(${r.x}, ${r.y});
      const t = el && el.closest ? el.closest('.tile') : null; return t ? t.id : null; })()`);
    if (hit !== 'tile' + i) continue;
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y, buttons: 0, clickCount: 0 });
    await sleep(250);
    hovered = true;
  }
  const tip = await ev(`(() => { const t = document.getElementById('synTip');
    return t ? { hidden: t.classList.contains('hidden'), text: (t.textContent || '').trim().length } : null; })()`);
  (tip && !tip.hidden && tip.text > 0)
    ? ok(`悬停地块弹出提示卡（${tip.text} 字）`)
    : bad('悬停地块没有提示卡 —— ' + (tip ? '存在但未显示' : '元素不存在'));

  // ---------- 6. 返回开始菜单（用户报的问题②）----------
  console.log('\n[返回开始菜单]');
  const back = await ev(`(() => { const a = [...document.querySelectorAll('a,button')]
      .find(e => (e.textContent || '').includes('返回开始菜单'));
    return a ? { href: a.getAttribute('href'), tag: a.tagName } : null; })()`);
  back ? ok(`存在「返回开始菜单」（<${back.tag.toLowerCase()}> href=${back.href}）`) : bad('没有返回开始菜单入口');
  if (back) {
    await ev(`[...document.querySelectorAll('a,button')].find(e => (e.textContent||'').includes('返回开始菜单')).click(); 1`);
    await sleep(1200);
    const backOk = await ev(`(location.pathname.endsWith('/index.html') || location.pathname === '/') &&
      !!document.getElementById('startBtn')`);
    backOk ? ok('点击后回到开始菜单') : bad('点击后未回到开始菜单: ' + await ev(`location.href`));
  }

  ws.close();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
} catch (e) {
  bad('异常: ' + e.message);
} finally {
  try { chrome?.kill(); } catch {}
  try { neu.kill(); } catch {}
  try { execFileSync('taskkill', ['/IM', 'neutralino-win_x64.exe', '/F'], { stdio: 'ignore' }); } catch {}
}

console.log(`\n${failCount === 0 ? '✓' : '✗'} 桌面版验证：${pass} 过 / ${failCount} 败`);
process.exit(failCount === 0 ? 0 : 1);
