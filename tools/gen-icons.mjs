#!/usr/bin/env node
// ================================================================
// PWA 图标生成器（tools/gen-icons.mjs）
//
// 用无头 Chrome/Edge 把内联 SVG 渲染成 PNG，不引入任何图形库依赖。
// 产物（assets/icons/）：
//   icon-192.png / icon-512.png      普通图标（purpose: any）
//   icon-maskable-512.png           可裁切图标（Android 自适应，留安全边距）
//   apple-touch-icon.png            180×180（iOS 主屏，ios 会自己加圆角）
//
// 用法：node tools/gen-icons.mjs
// ================================================================
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_DIR = path.join(ROOT, 'assets/icons');
const BRAND = '#1D9E75';

const BROWSER = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(p => existsSync(p));
if (!BROWSER) { console.error('✗ 找不到 Chrome/Edge'); process.exit(2); }

// 塔楼图标（与 game/js/icons.js 的 tower 同一条路径，viewBox 64×64 居中）
const TOWER = "M19 -16 L19 -4 Q19 -2.75 18.15 -1.85 L15 1.25 15 10.75 18.15 13.9 Q19 14.75 19 16 L19 20 Q19 21.25 18.15 22.15 17.25 23 16 23 L-16 23 Q-17.25 23 -18.1 22.15 -19 21.25 -19 20 L-19 16 Q-19 14.75 -18.1 13.9 L-15 10.75 -15 1.25 -18.1 -1.85 Q-19 -2.75 -19 -4 L-19 -16 Q-19 -17.25 -18.1 -18.1 -17.25 -19 -16 -19 L-12 -19 Q-10.75 -19 -9.85 -18.1 -9 -17.25 -9 -16 L-9 -11 -7 -11 -7 -16 Q-7 -17.25 -6.1 -18.1 -5.25 -19 -4 -19 L4 -19 Q5.25 -19 6.15 -18.1 7 -17.25 7 -16 L7 -11 9 -11 9 -16 Q9 -17.25 9.9 -18.1 10.75 -19 12 -19 L16 -19 Q17.25 -19 18.15 -18.1 19 -17.25 19 -16";

mkdirSync(OUT_DIR, { recursive: true });
const tmp = mkdtempSync(path.join(tmpdir(), 'cm-icon-'));

// ratio = 图形占画布的比例（maskable 要留出被裁切的余量）
const JOBS = [
  { file: 'icon-192.png', size: 192, ratio: 0.66 },
  { file: 'icon-512.png', size: 512, ratio: 0.66 },
  { file: 'icon-maskable-512.png', size: 512, ratio: 0.52 },
  { file: 'apple-touch-icon.png', size: 180, ratio: 0.62 },
];

let fail = 0;
for (const j of JOBS) {
  const glyph = Math.round(j.size * j.ratio);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;width:${j.size}px;height:${j.size}px;overflow:hidden;background:${BRAND}}
  .wrap{width:${j.size}px;height:${j.size}px;display:flex;align-items:center;justify-content:center}
  svg{width:${glyph}px;height:${glyph}px;fill:#fff}
</style></head><body><div class="wrap">
<svg viewBox="-32 -32 64 64"><path d="${TOWER}"/></svg>
</div></body></html>`;
  const page = path.join(tmp, j.file.replace('.png', '.html'));
  writeFileSync(page, html);
  const out = path.join(OUT_DIR, j.file);
  const r = spawnSync(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--hide-scrollbars',
    '--force-device-scale-factor=1', `--window-size=${j.size},${j.size}`,
    '--user-data-dir=' + path.join(tmp, 'profile'),
    '--screenshot=' + out, 'file:///' + page.replace(/\\/g, '/'),
  ], { encoding: 'utf8', timeout: 60000 });

  if (existsSync(out) && statSync(out).size > 1000) {
    console.log(`  ✓ ${j.file}  ${j.size}×${j.size}`);
  } else {
    fail++;
    console.error(`  ✗ ${j.file} 生成失败 ${(r.stderr || '').slice(0, 200)}`);
  }
}
try { rmSync(tmp, { recursive: true, force: true }); } catch { }
console.log(fail ? `\n✗ ${fail} 个图标失败` : '\n✓ 图标全部生成');
process.exit(fail ? 1 : 0);
