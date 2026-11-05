#!/usr/bin/env node
// ================================================================
// 城市大富翁 · PC 桌面版构建器（tools/build-desktop.mjs）
//
// 用途：刷新 desktop/ 壳内的游戏资源。壳本身（Neutralino 配置、
//       开始菜单页）是手工维护的源码，不在这里生成。
//
// 步骤：① 调 build-single.mjs 把「核心+基础模块」单文件版生成到
//         desktop/resources/game.html（自带全部产物断言）
//       ② 同步应用图标
//
// 用法：node tools/build-desktop.mjs
//       打安装包再跑：cd desktop && npx neu build --release
// ================================================================
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RES = path.join(ROOT, 'desktop/resources');

console.log('① 生成对局页（全量模块 → desktop/resources/game.html）');
execFileSync(process.execPath, [path.join(HERE, 'build-single.mjs'),
  'desktop/resources/game.html', '--full'], { stdio: 'inherit' });

console.log('\n② 同步图标');
fs.mkdirSync(path.join(RES, 'icons'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'assets/icons/icon-512.png'),
  path.join(RES, 'icons/appIcon.png'));
console.log('  ✓ assets/icons/icon-512.png → desktop/resources/icons/appIcon.png');

const kb = (fs.statSync(path.join(RES, 'game.html')).size / 1024).toFixed(1);
console.log(`\n✓ 桌面资源就绪（game.html ${kb} KB）。打包：cd desktop && npx neu build --release`);
