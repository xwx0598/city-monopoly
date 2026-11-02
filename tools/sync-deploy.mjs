// 把仓库源码同步到 deploy/（发布用副本）。
// 用法：node tools/sync-deploy.mjs
//
// 只拷游戏真正需要的静态资源；本地开发服务器已直接服务仓库根目录，不依赖本脚本。
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dest = join(root, 'deploy');

const ENTRIES = ['index.html', 'lobby', 'game', 'assets'];

if (!existsSync(join(root, 'lobby', 'html', 'index.html'))) {
  console.error('✗ 找不到 lobby/html/index.html，请在仓库根目录下运行');
  process.exit(1);
}

let copied = 0;
for (const name of ENTRIES) {
  const from = join(root, name);
  const to = join(dest, name);
  if (!existsSync(from)) {
    console.warn(`- 跳过（不存在）：${name}`);
    continue;
  }
  if (existsSync(to)) rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  copied++;
  console.log(`✓ ${name}`);
}

console.log(`\n已同步 ${copied} 项到 deploy/`);
