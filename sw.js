// ================================================================
// 城市大富翁 · Service Worker（PWA 离线支持）
//
// 策略：
//   · 页面导航（html）：网络优先，失败回缓存——保证改版立即生效，断网也能进
//   · 静态资源（css/js/图标/字体）：缓存优先 + 后台刷新（stale-while-revalidate）
//   · 匹配一律 ignoreSearch：?v=20261104a 这类版本参数不参与缓存键，
//     资产升版本后后台自动换新，旧条目在 activate 时整体清理
//   · /ws 联机是 WebSocket 升级请求，不经过 fetch，天然不受影响
//   · 联机断网时本来就有 AI 托管兜底，这里只管「页面打得开」
//
// 版本号：改了 PRECACHE 里的文件内容时手动 +1，触发旧缓存清理。
// ================================================================
const VERSION = 'v1';
const CACHE = 'cm-' + VERSION;

const PRECACHE = [
  '/index.html',
  '/manifest.webmanifest',
  '/lobby/html/index.html',
  '/lobby/html/editor.html',
  '/lobby/css/lobby.css',
  '/lobby/css/editor.css',
  '/lobby/js/icons.js',
  '/lobby/js/lobby.js',
  '/lobby/js/net.js',
  '/lobby/js/editor.js',
  '/game/html/game.html',
  '/game/css/game.css',
  '/game/js/icons.js',
  '/game/js/config.js',
  '/game/js/core.js',
  '/game/js/mp.js',
  '/game/js/boot.js',
  '/game/js/modules/m-maps.js',
  '/game/js/modules/m-special.js',
  '/game/js/modules/m-chance.js',
  '/game/js/modules/m-combos.js',
  '/game/js/modules/m-ai-diff.js',
  '/game/js/modules/m-trade.js',
  '/game/js/modules/m-extra-tiles.js',
  '/game/js/modules/m-stats.js',
  '/game/js/modules/m-synergy.js',
  '/game/js/modules/m-items.js',
  '/game/js/modules/m-stocks.js',
  '/game/js/modules/m-quests.js',
  '/game/js/modules/m-visit.js',
  '/game/js/modules/m-vote.js',
  '/game/js/modules/m-weather.js',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/icon-maskable-512.png',
];

self.addEventListener('install', e => {
  // 逐条装、单条失败不拖垮整个 install（缺失文件只损失一项离线覆盖）
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(PRECACHE.map(u =>
        c.add(new Request(u, { cache: 'reload' })).catch(() => { })
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;         // 外部资源（CDN 等）不拦
  if (url.pathname === '/sw.js') return;              // 自己永远走网络

  // 页面导航：网络优先，断网回缓存（match 时忽略 ?v= 差异）
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => { });
        return res;
      }).catch(() =>
        caches.match(req, { ignoreSearch: true })
          .then(r => r || caches.match('/index.html', { ignoreSearch: true }))
      )
    );
    return;
  }

  // 静态资源：缓存优先 + 后台换新
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      const net = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => { });
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
