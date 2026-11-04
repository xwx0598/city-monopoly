// ================================================================
// PWA：Service Worker 注册 + 「安装到桌面」入口
//
// 只在大厅页注册一次（scope = /，覆盖全部页面）。
// 安装按钮动态插入 .quick-links，浏览器不给 beforeinstallprompt
// （已安装 / 不支持 / 非 HTTPS 环境）时就不出现，不打扰正常玩家。
// 注意：Chrome 要求安全上下文——localhost 天然满足；局域网 IP 的
// http:// 不会弹安装提示，属于浏览器安全策略，不是本文件的问题。
// ================================================================
(function(){
  'use strict';
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('/sw.js', { scope: '/' })
    .then(reg => { window.MP_SW_READY = true; })
    .catch(err => console.warn('[PWA] 注册失败', err));

  // ---------- 安装入口 ----------
  let deferredPrompt = null;

  function addInstallBtn(){
    if (document.getElementById('pwaInstall')) return;
    const bar = document.querySelector('#viewMode .quick-links');
    if (!bar) return;
    const a = document.createElement('a');
    a.id = 'pwaInstall';
    a.href = '#';
    a.textContent = '📲 安装到桌面（离线可玩）';
    a.onclick = async () => {
      a.onclick = null;
      if (!deferredPrompt) return false;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') a.remove();
      deferredPrompt = null;
      return false;
    };
    bar.appendChild(a);
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addInstallBtn);
    else addInstallBtn();
  });

  // 已装成应用（standalone 窗口）里就不再显示入口
  if (window.matchMedia('(display-mode: standalone)').matches
      || navigator.standalone === true){
    window.addEventListener('beforeinstallprompt', e => e.preventDefault());
  }
})();
