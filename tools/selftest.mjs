#!/usr/bin/env node
// ================================================================
// 城市大富翁 · 自检跑批（tools/selftest.mjs）
//
// 用法：
//   node tools/selftest.mjs                跑默认 8 组配置
//   node tools/selftest.mjs --only=3       只跑第 3 组（可逗号分隔：--only=1,4）
//   node tools/selftest.mjs --budget=1200000   调大虚拟时间预算（毫秒）
//   node tools/selftest.mjs --verbose      打印每组的落格覆盖率与告警明细
//
// 原理：用 Edge/Chrome 无头模式打开 game.html?selftest=1，
//       --virtual-time-budget 让浏览器把几十秒的动画瞬间快进完，
//       页面内的 _selftest.js 托管人类玩家打完一局并把 JSON 写进 DOM，
//       --dump-dom 把 DOM 打回 stdout，这里解析 SELFTESTBASE64 并汇总。
// 无第三方依赖，退出码 0=全通过，1=有违规。
// ================================================================
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const GAME = path.join(ROOT, 'game', 'html', 'game.html');

// 默认配置矩阵：地图 × 可选玩法 × 人数 × 种子
const CASES = [
  { name: '经典·羁绊·4人',   q: 'mode=ai&ai=3&map=classic&mods=synergy&seed=101' },
  { name: '地铁·羁绊·4人',   q: 'mode=ai&ai=3&map=metro&mods=synergy&seed=202' },
  { name: '迷你·羁绊·3人',   q: 'mode=ai&ai=2&map=mini&mods=synergy&seed=303' },
  { name: '随机·羁绊·4人',   q: 'mode=ai&ai=3&map=random&mods=synergy&seed=404' },
  { name: '纯核心·无模块',   q: 'mode=ai&ai=3&map=classic&mods=0&seed=505' },
  { name: '同屏4人·羁绊',    q: 'mode=hotseat&n=4&map=classic&mods=synergy&seed=606' },
  { name: '经典·羁绊·2人',   q: 'mode=ai&ai=1&map=classic&mods=synergy&seed=707' },
  { name: '地铁·羁绊·另一种子', q: 'mode=ai&ai=3&map=metro&mods=synergy&seed=808' },
];

const args = process.argv.slice(2);
const opt = {
  budget: 900000,
  verbose: args.includes('--verbose'),
  only: null,
};
args.forEach(a => {
  const m = a.match(/^--(budget|only)=(.+)$/);
  if (!m) return;
  if (m[1] === 'budget') opt.budget = parseInt(m[2], 10) || opt.budget;
  if (m[1] === 'only') opt.only = m[2].split(',').map(s => parseInt(s, 10)).filter(Boolean);
});

function findBrowser(){
  const cands = [
    process.env.SELFTEST_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const c of cands) if (existsSync(c)) return c;
  return null;
}

const BROWSER = findBrowser();
if (!BROWSER){
  console.error('✗ 找不到 Edge/Chrome。可用环境变量 SELFTEST_BROWSER 指定可执行文件路径。');
  process.exit(2);
}
if (!existsSync(GAME)){
  console.error('✗ 找不到 ' + GAME);
  process.exit(2);
}

const cases = opt.only ? CASES.filter((_, i) => opt.only.includes(i + 1)) : CASES;
let failed = 0;

console.log(`城市大富翁 · 自检  |  浏览器：${path.basename(BROWSER)}  |  预算：${opt.budget}ms/局\n`);

for (const c of cases){
  const profile = mkdtempSync(path.join(tmpdir(), 'cm-selftest-'));
  const url = `${pathToFileURL(GAME).href}?${c.q}&new=1&selftest=1`;
  const t0 = Date.now();
  const res = spawnSync(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--user-data-dir=' + profile, '--window-size=1440,900',
    '--virtual-time-budget=' + opt.budget, '--dump-dom', url,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000 });
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  try { rmSync(profile, { recursive: true, force: true }); } catch(e){}

  const dom = res.stdout || '';
  const m = dom.match(/SELFTESTBASE64:([A-Za-z0-9+/=]+)/);
  if (!m){
    failed++;
    console.log(`✗ ${c.name}  (${wall}s)`);
    console.log(`    页面没有产出结果——可能卡死、脚本报错，或预算不够。`);
    console.log(`    URL: ${url}`);
    if (res.stderr && opt.verbose) console.log('    stderr: ' + res.stderr.slice(0, 800));
    continue;
  }
  const rep = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
  const mark = rep.ok ? '✓' : '✗';
  if (!rep.ok) failed++;
  const p = rep.players.map(x => `${x.name}${x.bankrupt ? '(破产)' : ''} ¥${x.money}/净${x.net}`).join('  ');
  console.log(`${mark} ${c.name}  (${wall}s)`);
  console.log(`    回合 ${rep.round} · 状态变化 ${rep.turns} · 结束：${rep.endReason || '?'} · 点击 ${rep.stats.clicks} 次`);
  console.log(`    终局：${p}`);
  const landing = Object.entries(rep.stats.landing).map(([k, v]) => `${k}×${v}`).join(' ');
  console.log(`    落格：${landing || '无'}　最高建筑等级：${rep.stats.maxLevel}　拍卖 ${rep.stats.auctions} 次 · 入狱 ${rep.stats.jails} 次 · 破产抉择 ${rep.stats.debts} 次`);
  if (!rep.finished) console.log(`    ⚠️ 本局未自然结束（${rep.endReason}），覆盖不完整`);
  if (rep.stall){
    const s = rep.stall;
    console.log(`    卡在：${s.openModals.join(',') || '无弹窗'}　rollBtn禁用=${s.rollDisabled}　busy=${s.busy}`);
    if (s.extra) console.log(`    现场：${JSON.stringify(s.extra)}`);
    if (s.trail) console.log(`    操作轨迹：${s.trail.slice(-16).join(' → ')}`);
    (s.log || []).forEach(l => console.log(`      log> ${l}`));
  }
  (rep.errors || []).forEach(e => console.log(`    ! ${e}`));
  rep.violations.forEach(v => console.log(`    ✗ [${v.code}] 第${v.round}回合 玩家${v.turn}：${v.msg}`));
  if (opt.verbose) rep.warnings.forEach(v => console.log(`    · [${v.code}] 第${v.round}回合：${v.msg}`));
  console.log('');
}

console.log(failed ? `\n✗ ${failed} 组发现问题` : '\n✓ 全部通过');
process.exit(failed ? 1 : 0);
