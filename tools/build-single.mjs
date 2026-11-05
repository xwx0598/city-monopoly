#!/usr/bin/env node
// ================================================================
// 城市大富翁 · 单文件版构建器（tools/build-single.mjs）
//
// 用途：把模块化源码打包成一个零外部依赖、双击即玩的单文件 HTML，
//       作为「最基础最完整」的回退点。旧的手工版（重构前 V1）永远
//       可以从 git 历史找回（2026-11-02 之前的提交）。
//
// 内容：核心引擎 + 8 个基础模块（多地图/特殊地块/机会卡/组合/
//       AI难度/交易/拍卖与保险/统计）。可选玩法（羁绊/天气/道具/
//       股票/悬赏/探监/议案）与联机、大厅、地图编辑器不打包。
//       自检脚本一并内联（只在 ?selftest=1 时激活，正常游玩零开销）。
//
// 用法：node tools/build-single.mjs [输出路径] [--full]
//   无参数      → 城市大富翁-单文件版.html（基础完整：核心 + 8 基础模块）
//   --full      → 含 7 个可选玩法模块（桌面版用；模块仍按 ?mods= 激活）
// 退出码 0=构建成功且通过基本断言，1=失败。
// ================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
// 参数：--full = 全量模式（含 7 个可选玩法模块，供桌面版用；模块自身按 ?mods= 决定启不启用）
//       其余非 -- 开头的参数 = 输出路径（默认仓库根的单文件版）
const ARGS = process.argv.slice(2);
const FULL = ARGS.includes('--full');
const outArg = ARGS.find(a => !a.startsWith('--'));
const OUT = outArg ? path.resolve(ROOT, outArg) : path.join(ROOT, '城市大富翁-单文件版.html');
const GAME_HTML = path.join(ROOT, 'game/html/game.html');

// 基础模块清单：与 config.js 的 MB_MODULES 保持一致
const INCLUDE_BASE = [
  'icons.js', 'config.js', 'core.js',
  'modules/m-maps.js', 'modules/m-special.js', 'modules/m-chance.js',
  'modules/m-combos.js', 'modules/m-ai-diff.js', 'modules/m-trade.js',
  'modules/m-extra-tiles.js', 'modules/m-stats.js',
  '_selftest.js', 'boot.js',
];
// 可选玩法模块：仅 --full 打包（顺序与 game.html 一致）
const OPTIONAL = [
  'modules/m-synergy.js', 'modules/m-items.js', 'modules/m-stocks.js',
  'modules/m-quests.js', 'modules/m-visit.js', 'modules/m-vote.js',
  'modules/m-weather.js',
];
const SELFTEST_AT = INCLUDE_BASE.indexOf('_selftest.js');
const INCLUDE = FULL
  ? [...INCLUDE_BASE.slice(0, SELFTEST_AT), ...OPTIONAL, ...INCLUDE_BASE.slice(SELFTEST_AT)]
  : INCLUDE_BASE;
// 出现在引用里就报错，防止清单漂移（全量模式只排除联机）
const EXCLUDE_HINTS = FULL ? ['mp.js']
  : ['mp.js', 'm-synergy', 'm-weather', 'm-items', 'm-stocks', 'm-quests', 'm-visit', 'm-vote'];

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
let fail = 0;
const bad = m => { fail++; console.error('  ✗ ' + m); };
const good = m => console.log('  ✓ ' + m);

// ---------- 1. 解析 game.html ----------
const html = read('game/html/game.html');

// CSS 内联
let out = html.replace(
  /<link rel="stylesheet" href="\.\.\/css\/game\.css[^"]*">/,
  () => '<style>\n' + read('game/css/game.css') + '\n</style>'
);
if (out.includes('game.css?v=')) { bad('CSS 未成功内联'); }

// JS 内联（按 game.html 的引用顺序，只打 INCLUDE 清单里的文件）
// 注意：_selftest.js 在 game.html 里没有静态标签（boot 动态注入），要随 boot.js 一起内联
const scriptRe = /<script src="\.\.\/js\/([^"?]+)(?:\?[^"]*)?"><\/script>/g;
const inlineOne = rel => {
  const code = read('game/js/' + rel);
  return `<script>\n// ══════ ${rel} ══════\n` + code + '\n</script>';
};
out = out.replace(scriptRe, (m, rel) => {
  if (!INCLUDE.includes(rel)) return `<!-- 单文件版不含 ${rel} -->`;
  return rel === 'boot.js' ? inlineOne('_selftest.js') + '\n' + inlineOne(rel) : inlineOne(rel);
});
// 没被替换完的引用 = 清单外文件被漏掉
const leftover = [...out.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
if (leftover.length) bad('仍有未内联的脚本引用: ' + leftover.join(', '));
else good('CSS 与 JS 全部内联（含 ' + INCLUDE.length + ' 个 JS 文件）');

// ---------- 2. 单文件适配补丁 ----------
// ① 返回大厅：基础版删除（无大厅）；全量版（桌面版）改为「返回开始菜单」→ 同目录 index.html
if (FULL){
  out = out.replace(/<a class="btn-ghost" href="\.\.\/\.\.\/lobby\/html\/index\.html">[^<]*<\/a>/,
    '<a class="btn-ghost" href="index.html">🏠 返回开始菜单</a>');
  if (!out.includes('返回开始菜单')) bad('返回开始菜单链接未注入');
} else {
  out = out.replace(/\s*<a class="btn-ghost" href="\.\.\/\.\.\/lobby\/html\/index\.html">[^<]*<\/a>/, '');
}
if (out.includes('lobby/html/index.html')) bad('大厅链接未移除');

// ①b 摘除 PWA 清单链接（站点根路径引用，单文件/桌面壳都不需要；theme-color 保留无妨）
out = out.replace(/\s*<link rel="manifest" href="\/manifest\.webmanifest">/, '');

// ② boot 的自检动态加载改为空操作（_selftest.js 已内联，避免 file:// 404）
out = out.replace(
  "st.src = '../js/_selftest.js?v=20261102g';",
  "// 单文件版：_selftest.js 已内联，无需动态加载"
);
if (out.includes("../js/_selftest.js")) bad('boot 自检动态加载未摘除');

// ③ 头部加构建标记
const stamp = new Date().toISOString().slice(0, 10);
out = out.replace(
  '<title>城市大富翁</title>',
  `<title>城市大富翁</title>\n<!-- 单文件版（基础完整）：由 tools/build-single.mjs 自动生成于 ${stamp}，请勿手改；改 game/ 源码后重新构建 -->`
);

// ---------- 3. 基本断言 ----------
console.log('\n产物断言：');
// 允许的 href：锚点；全量模式下额外允许「返回开始菜单」的同目录 index.html
let noHref = out.replace(/<title>[^<]*<\/title>/, '');
if (FULL) noHref = noHref.replace(/href="index\.html"/, '');
if (/src="/.test(noHref) || /href="(?!#)[^"]*"/.test(noHref)) {
  bad('产物仍存在外部引用（src=/href=）');
} else good('零外部引用（真单文件）');

if (out.includes('Math.min(rentOf(i), p.money)')) bad('含已知的旧租金封顶 bug（不应存在）');
else good('无旧版租金封顶 bug');

for (const h of EXCLUDE_HINTS) {
  if (out.includes(`<script>\n// ══════ js/${h}`) || new RegExp(`src="[^"]*${h}`).test(out)) bad(`不应包含 ${h}`);
}
if (FULL){
  out.includes('══════ modules/m-synergy.js ══════')
    ? good('可选玩法模块已全部内联（含 m-synergy 地块提示卡）')
    : bad('全量模式缺 m-synergy（地块提示卡 + 羁绊）');
} else {
  out.includes('══════ modules/m-synergy.js ══════') ? bad('基础版不应包含可选玩法') : good('可选玩法 / 联机 / 大厅脚本未打包');
}

fs.writeFileSync(OUT, out);
const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`\n${fail === 0 ? '✓' : '✗'} 构建完成 → 城市大富翁-单文件版.html（${kb} KB）`);
process.exit(fail === 0 ? 0 : 1);
