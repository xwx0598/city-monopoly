// 静态检查：语法 / 资源引用 / 缓存版本号新鲜度 / deploy 同步
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.argv[2] || process.cwd();
let fail = 0;
const bad = (m) => { fail++; console.log('  ✗ ' + m); };
const good = (m) => console.log('  ✓ ' + m);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '.shots') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const all = walk(ROOT);
const jsFiles = all.filter(f => f.endsWith('.js'));
const htmlFiles = all.filter(f => f.endsWith('.html'));

// ---------- 1. 语法 ----------
console.log('\n[1] JS 语法检查');
const tmp = path.join(process.env.TEMP || '/tmp', 'cm-syntax');
fs.mkdirSync(tmp, { recursive: true });
let syntaxFail = 0;
for (const f of jsFiles) {
  let r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status === 0) continue;
  // 可能是 ESM（含 import/export），换 .mjs 再查
  if (/Cannot use import statement|Unexpected token 'export'|await is only valid/.test(r.stderr || '')) {
    const copy = path.join(tmp, path.basename(f, '.js') + '-' + Math.random().toString(36).slice(2, 7) + '.mjs');
    fs.copyFileSync(f, copy);
    r = spawnSync(process.execPath, ['--check', copy], { encoding: 'utf8' });
    fs.rmSync(copy, { force: true });
    if (r.status === 0) continue;
  }
  syntaxFail++;
  bad(`${path.relative(ROOT, f)}: ${(r.stderr || '').split('\n').slice(0, 4).join(' | ')}`);
}
if (!syntaxFail) good(`${jsFiles.length} 个 JS 文件语法全部通过`);

// ---------- 2. 资源引用存在性 ----------
console.log('\n[2] HTML 资源引用');
let refFail = 0;
for (const h of htmlFiles) {
  const src = fs.readFileSync(h, 'utf8');
  const refs = [...src.matchAll(/(?:src|href)="([^"#?]+)(?:\?[^"]*)?"/g)].map(m => m[1]);
  for (const r of new Set(refs)) {
    if (/^(https?:|data:|mailto:|#|\/\/)/.test(r)) continue;
    // 以 / 开头 = 从站点根出发（PWA 清单、图标等），相对仓库根解析
    const abs = r.startsWith('/') ? path.join(ROOT, r) : path.resolve(path.dirname(h), r);
    if (!fs.existsSync(abs)) { refFail++; bad(`${path.relative(ROOT, h)} → 缺失 ${r}`); }
  }
}
if (!refFail) good(`${htmlFiles.length} 个 HTML 的本地引用全部存在`);

// ---------- 3. 缓存版本号新鲜度 ----------
console.log('\n[3] 缓存版本号（改动后必须提 ?v=）');
let stale = 0;
for (const h of htmlFiles) {
  const src = fs.readFileSync(h, 'utf8');
  for (const m of src.matchAll(/(?:src|href)="([^"?]+)\?v=(\d{8})([a-z]?)"/g)) {
    const rel = m[1], ver = m[2];
    const abs = path.resolve(path.dirname(h), rel);
    if (!fs.existsSync(abs)) continue;
    const st = fs.statSync(abs);
    const mtime = new Date(st.mtimeMs);
    const fmt = `${mtime.getFullYear()}${String(mtime.getMonth() + 1).padStart(2, '0')}${String(mtime.getDate()).padStart(2, '0')}`;
    if (fmt > ver) { stale++; bad(`${path.relative(ROOT, h)}: ${path.basename(rel)} 版本 ${ver} 早于文件改动日期 ${fmt}`); }
  }
}
if (!stale) good('所有带 ?v= 的引用都不早于文件改动时间');

// ---------- 4. deploy 与源目录一致性 ----------
console.log('\n[4] deploy 目录与源码同步');
const pairs = [
  ['game', 'deploy/game'],
  ['lobby', 'deploy/lobby'],
  ['index.html', 'deploy/index.html'],
];
let syncFail = 0;
for (const [a, b] of pairs) {
  const srcA = path.join(ROOT, a), srcB = path.join(ROOT, b);
  if (!fs.existsSync(srcB)) { bad(`缺少 ${b}`); syncFail++; continue; }
  const fa = fs.statSync(srcA).isDirectory() ? walk(srcA) : [srcA];
  for (const f of fa) {
    const rel = a.endsWith('.html') ? '' : path.relative(srcA, f);
    const other = a.endsWith('.html') ? srcB : path.join(srcB, rel);
    if (!fs.existsSync(other)) { bad(`${b}/${rel} 不存在`); syncFail++; continue; }
    if (fs.readFileSync(f).compare(fs.readFileSync(other)) !== 0) {
      bad(`${b}/${rel} 与源文件内容不一致`); syncFail++;
    }
  }
}
if (!syncFail) good('deploy 与 game/lobby/index 完全一致');

console.log(`\n结果：${fail === 0 ? '全部通过' : fail + ' 项问题'}`);
process.exit(fail === 0 ? 0 : 1);
