// ================================================================
// 城市大富翁 · 地图编辑器（lobby/js/editor.js）
// 环形预览 + 点击选中 + 字段编辑 + 分享码导入导出 + 本机保存。
// 产出格式与 m-maps.js 的地图结构一致：{ name, tiles:[{type,name,group?,price?}] }
// 分享码 = URL 安全 base64(JSON)；解码侧在 game/js/modules/m-maps.js（刻意不共享文件）。
// ================================================================
(function(){
  'use strict';
  const $ = id => document.getElementById(id);

  // ---- 类型元数据（与 core.js 的 tileHandlers 对齐）----
  const TYPES = {
    go:       { label:'起点',     emoji:'🚩', price:false, group:false },
    prop:     { label:'地产',     emoji:'🏠', price:true,  group:true },
    station:  { label:'车站',     emoji:'🚉', price:true,  group:false },
    utility:  { label:'设施',     emoji:'⚡', price:true,  group:false },
    chance:   { label:'机会',     emoji:'❓', price:false, group:false },
    tax:      { label:'税收',     emoji:'💰', price:false, group:false },
    jail:     { label:'监狱',     emoji:'🚔', price:false, group:false },
    parking:  { label:'免费停车', emoji:'🅿️', price:false, group:false },
    bonus:    { label:'奖励格',   emoji:'🎁', price:false, group:false },
    casino:   { label:'赌场',     emoji:'🎲', price:false, group:false },
    police:   { label:'交警',     emoji:'🚨', price:false, group:false },
    insurance:{ label:'保险',     emoji:'🛡️', price:false, group:false },
    auction:  { label:'拍卖行',   emoji:'🔨', price:false, group:false },
  };
  const GROUP_COLORS = { A:'#8E86A0', B:'#8FA6B8', C:'#C39B7E', D:'#98A99B', E:'#B98D8D' };
  const CORNERS = new Set(['go','jail','parking','bonus']);
  const PROP_NAMES = ['樱花大道','甜心小巷','阳光公寓','码头仓库','海风旅馆','灯塔广场','中心百货','天际大厦','金融街','科技园','电视塔','王朝酒店','翡翠湾','月光湾','梧桐街区','云顶花园','琥珀庄园','风车小镇','玫瑰大道','银滩别墅','青石板巷','星光码头','凤凰城','紫藤花苑'];

  // ---- 分享码编解码（与 m-maps.js 的 decodeMapCode 配对）----
  function encodeMap(obj){
    return btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeMapCode(code){
    try {
      let s = String(code || '').trim().replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      const obj = JSON.parse(decodeURIComponent(escape(atob(s))));
      if (!obj || !Array.isArray(obj.tiles) || obj.tiles.length < 10 || obj.tiles.length > 64) return null;
      if (!obj.tiles.every(t => t && TYPES[t.type])) return null;
      if (!obj.tiles[0] || obj.tiles[0].type !== 'go') return null;
      return obj;
    } catch(e){ return null; }
  }

  // ---- 状态 ----
  let tiles = [];
  let sel = 0;
  let nameCounter = 0;

  const nextPropName = () => PROP_NAMES[(nameCounter++) % PROP_NAMES.length];
  const mkProp = (group, price) => ({ type:'prop', name: nextPropName(), group, price });
  function blankBoard(){
    const n = 20, edge = n / 4 - 1;
    const arr = new Array(n).fill(null).map(() => ({ type:'chance', name:'机会' }));
    arr[0] = { type:'go', name:'起点' };
    arr[edge + 1] = { type:'jail', name:'监狱' };
    arr[2 * (edge + 1)] = { type:'parking', name:'免费停车' };
    arr[3 * (edge + 1)] = { type:'bonus', name:'奖励格' };
    return arr;
  }
  function miniBoard(){ return JSON.parse(JSON.stringify(TPL.mini.tiles)); }
  const TPL = {};   // 模板在本文件底部由内置数据填充

  // ---- 渲染 ----
  function tileColor(t){
    if (t.type === 'prop') return GROUP_COLORS[t.group] || '#C9BFA9';
    if (t.type === 'station') return '#8B8779';
    if (t.type === 'utility') return '#C79E6E';
    return '#A9A292';
  }
  function renderBoard(){
    const board = $('edBoard');
    board.innerHTML = '';
    const n = tiles.length;
    // 周长参数化均匀分布：s∈[0,1) 绕一圈（上→右→下→左），每格落在自己弧段的正中，
    // 保证整圈等距、角上不会出现两边格子挤在一起
    const P = s => {
      const seg = Math.min(3, Math.floor(s * 4)), t = s * 4 - seg;
      const p = 5 + t * 90;                       // 5%~95%
      if (seg === 0) return [p, 5];               // 上边：左→右
      if (seg === 1) return [95, p];              // 右边：上→下
      if (seg === 2) return [100 - p, 95];        // 下边：右→左
      return [5, 100 - p];                        // 左边：下→上
    };
    tiles.forEach((t, i) => {
      const meta = TYPES[t.type] || TYPES.chance;
      const [x, y] = P(i / n + 0.5 / n);
      const w = n <= 24 ? 11.5 : n <= 32 ? 9.5 : 8;      // 格子多就整体缩小
      const el = document.createElement('div');
      el.className = 'ed-tile' + (i === sel ? ' sel' : '') + (CORNERS.has(t.type) ? ' corner' : '');
      el.style.left = x + '%';
      el.style.top = y + '%';
      el.style.width = w + '%';
      el.innerHTML = `<div class="tt" style="font-size:${15 * w / 11.5}px">${meta.emoji}</div>` +
        `<div class="tn" style="font-size:${9.5 * w / 11.5}px">${t.name || meta.label}</div>` +
        (meta.price ? `<div class="tp" style="color:${tileColor(t)};font-size:${9 * w / 11.5}px">¥${t.price || 0}${t.type === 'prop' ? ' · ' + (t.group || '?') : ''}</div>` : '');
      el.addEventListener('click', () => { sel = i; render(); });
      board.appendChild(el);
    });
  }
  function renderList(){
    const ol = $('tileList');
    ol.innerHTML = '';
    tiles.forEach((t, i) => {
      const meta = TYPES[t.type] || TYPES.chance;
      const li = document.createElement('li');
      if (i === sel) li.className = 'sel';
      li.innerHTML = `<span class="li-i">${i}</span>` +
        `<span class="li-dot" style="background:${tileColor(t)}"></span>` +
        `<span class="li-n">${meta.emoji} ${t.name || meta.label}</span>` +
        (meta.price ? `<span class="li-p">¥${t.price || 0}</span>` : '');
      li.addEventListener('click', () => { sel = i; render(); });
      ol.appendChild(li);
    });
  }
  function renderForm(){
    const t = tiles[sel] || tiles[0];
    if (!t) return;
    const meta = TYPES[t.type];
    $('fType').value = t.type;
    $('fName').value = t.name || '';
    $('rowPrice').style.display = meta.price ? '' : 'none';
    $('rowGroup').style.display = meta.group ? '' : 'none';
    if (meta.price) $('fPrice').value = t.price || 600;
    if (meta.group) $('fGroup').value = t.group || 'A';
  }
  function validate(){
    const warns = [];
    if (!tiles.length) return ['棋盘是空的'];
    if (tiles[0].type !== 'go') warns.push('第 0 格必须是「起点」（试玩会被拒绝）');
    if (tiles.filter(t => t.type === 'go').length !== 1) warns.push('「起点」只能有一个');
    if (!tiles.some(t => t.type === 'jail')) warns.push('建议放一个「监狱」，否则入狱判定无处可去');
    const groups = {};
    tiles.forEach(t => { if (t.type === 'prop') groups[t.group] = (groups[t.group] || 0) + 1; });
    Object.entries(groups).forEach(([g, c]) => { if (c < 2) warns.push(`${g} 组只有 ${c} 块地，凑不成垄断组（建议 ≥2）`); });
    if (!Object.keys(groups).length) warns.push('一块地产都没有，收租玩法就没了');
    if (tiles.length < 12) warns.push('格子少于 12 个，棋盘会很挤');
    if (tiles.length > 48) warns.push('格子超过 48 个，每一格会非常小');
    return warns;
  }
  function render(){
    renderBoard();
    renderList();
    renderForm();
    const warns = validate();
    $('edWarn').innerHTML = warns.map(w => '⚠️ ' + w).join('<br>');
    const groups = {};
    let props = 0;
    tiles.forEach(t => { if (t.type === 'prop'){ props++; groups[t.group] = (groups[t.group] || 0) + 1; } });
    $('edStat').textContent = `共 ${tiles.length} 格 · 地产 ${props} 块 / ${Object.keys(groups).length} 组 · ` +
      Object.entries(groups).sort().map(([g, c]) => g + ':' + c).join(' ');
  }
  function renderSaved(){
    const box = $('savedMaps');
    box.innerHTML = '<span class="ed-saved-title">💾 本机地图：</span>';
    const store = loadStore();
    const ids = Object.keys(store);
    if (!ids.length){ box.innerHTML += '<span class="ed-saved-title" style="opacity:.6">还没有保存过</span>'; return; }
    ids.sort((a, b) => (store[b].ts || 0) - (store[a].ts || 0)).forEach(id => {
      const b = document.createElement('button');
      b.className = 'ed-btn ghost';
      b.textContent = '📂 ' + (store[id].name || id);
      b.title = '载入这张地图';
      b.addEventListener('click', () => {
        tiles = JSON.parse(JSON.stringify(store[id].tiles));
        $('mapName').value = store[id].name || '我的地图';
        sel = 0; render();
      });
      const d = document.createElement('button');
      d.className = 'ed-btn del';
      d.textContent = '✕';
      d.title = '删除';
      d.addEventListener('click', () => {
        if (!confirm(`删除「${store[id].name || id}」？`)) return;
        const s = loadStore(); delete s[id]; saveStore(s); renderSaved();
      });
      box.appendChild(b); box.appendChild(d);
    });
  }

  // ---- 本机存储 ----
  const STORE_KEY = 'cm_custom_maps';
  const loadStore = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch(e){ return {}; } };
  const saveStore = s => { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch(e){} };
  function currentMap(){ return { name: $('mapName').value.trim() || '我的地图', tiles: JSON.parse(JSON.stringify(tiles)) }; }

  // ---- 表单事件 ----
  function bindForm(){
    const t = () => tiles[sel];
    $('fType').addEventListener('change', e => {
      const nt = e.target.value, meta = TYPES[nt], old = t();
      if (!old) return;
      const keep = confirm('改类型会重置该格的名字/价格/分组，继续吗？');
      if (!keep){ e.target.value = old.type; renderForm(); return; }
      const nu = { type: nt, name: nt === 'prop' ? nextPropName() : meta.label };
      if (meta.price) nu.price = 800;
      if (meta.group) nu.group = 'A';
      tiles[sel] = nu; render();
    });
    $('fName').addEventListener('input', e => { if (t()){ t().name = e.target.value.trim(); renderBoard(); renderList(); } });
    $('fPrice').addEventListener('change', e => {
      if (t() && TYPES[t().type].price){
        let v = parseInt(e.target.value, 10); if (!Number.isFinite(v)) v = 600;
        v = Math.max(100, Math.min(4000, Math.round(v / 50) * 50));
        t().price = v; e.target.value = v; renderBoard(); renderList();
      }
    });
    $('fGroup').addEventListener('change', e => { if (t() && t().type === 'prop'){ t().group = e.target.value; renderBoard(); renderList(); render(); } });
  }

  // ---- 顶部按钮 ----
  $('tplLoad').addEventListener('click', () => {
    const v = $('tplSel').value;
    tiles = v === 'blank' ? blankBoard() : JSON.parse(JSON.stringify(TPL[v].tiles));
    sel = 0; render();
  });
  $('saveBtn').addEventListener('click', () => {
    if (validate().some(w => w.includes('会被拒绝'))){ alert('第 0 格必须是起点，先修一下再保存'); return; }
    const store = loadStore();
    const m = currentMap();
    // 同名覆盖：找到同名图就更新
    let id = Object.keys(store).find(k => store[k].name === m.name);
    if (!id){ id = 'm' + Date.now().toString(36); }
    store[id] = { name: m.name, tiles: m.tiles, ts: Date.now() };
    saveStore(store); renderSaved();
    alert('已保存到本机（' + m.name + '），大厅地图选择里可以直接用');
  });
  $('playBtn').addEventListener('click', () => {
    const warns = validate();
    if (tiles[0] && tiles[0].type !== 'go'){ alert('第 0 格必须是「起点」'); return; }
    if (warns.length && !confirm('有几个建议项：\n' + warns.join('\n') + '\n\n仍要试玩吗？')) return;
    const code = encodeMap(currentMap());
    location.href = '../../game/html/game.html?mode=ai&ai=2&map=custom&mc=' + encodeURIComponent(code) + '&new=1&fast=1';
  });
  $('copyCode').addEventListener('click', () => {
    const code = encodeMap(currentMap());
    const done = () => alert('分享码已复制（' + code.length + ' 字符），发给朋友后在编辑器里「导入分享码」即可');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, () => prompt('复制下面的分享码：', code));
    else prompt('复制下面的分享码：', code);
  });
  $('importCode').addEventListener('click', () => {
    const s = prompt('粘贴分享码：');
    if (!s) return;
    const obj = decodeMapCode(s);
    if (!obj){ alert('分享码无效'); return; }
    tiles = obj.tiles;
    if (obj.name) $('mapName').value = obj.name;
    sel = 0; render();
  });

  // ---- 格子操作 ----
  $('addTile').addEventListener('click', () => {
    const at = Math.min(sel + 1, tiles.length);
    tiles.splice(at, 0, mkProp(['A','B','C','D','E'][tiles.filter(t => t.type === 'prop').length % 5], 800));
    sel = at; render();
  });
  $('delTile').addEventListener('click', () => {
    if (tiles.length <= 10){ alert('至少保留 10 个格子'); return; }
    if (tiles[sel].type === 'go'){ alert('起点不能删'); return; }
    tiles.splice(sel, 1);
    sel = Math.min(sel, tiles.length - 1); render();
  });
  $('mvUp').addEventListener('click', () => {
    if (sel <= 0 || sel - 1 === 0 && tiles[0].type === 'go'){ return; }   // 不能越过起点
    [tiles[sel - 1], tiles[sel]] = [tiles[sel], tiles[sel - 1]];
    sel--; render();
  });
  $('mvDown').addEventListener('click', () => {
    if (sel >= tiles.length - 1) return;
    if (sel === 0) return;                                                // 起点不动
    [tiles[sel + 1], tiles[sel]] = [tiles[sel], tiles[sel + 1]];
    sel++; render();
  });

  // ---- 初始化：模板内置于本文件（与 m-maps.js 预设一致；改动请同步）----
  TPL.mini = { name:'迷你快棋', tiles: [
    { type:'go', name:'起点' }, { type:'prop', name:'樱花大道', group:'A', price:600 },
    { type:'utility', name:'电力公司', price:700 }, { type:'chance', name:'机会' },
    { type:'prop', name:'甜心小巷', group:'A', price:600 }, { type:'jail', name:'监狱' },
    { type:'prop', name:'码头仓库', group:'B', price:800 }, { type:'casino', name:'幸运赌场' },
    { type:'prop', name:'海风旅馆', group:'B', price:800 }, { type:'parking', name:'免费停车' },
    { type:'prop', name:'中心百货', group:'C', price:1000 }, { type:'police', name:'交警临检' },
    { type:'prop', name:'天际大厦', group:'C', price:1000 }, { type:'auction', name:'拍卖行' },
    { type:'station', name:'中央车站', price:800 }, { type:'prop', name:'金融街', group:'C', price:1100 },
    { type:'bonus', name:'奖励格' }, { type:'prop', name:'科技园', group:'D', price:1200 },
    { type:'insurance', name:'保险代理' }, { type:'prop', name:'王朝酒店', group:'D', price:1400 },
  ]};
  TPL.classic = { name:'经典小城', tiles: [
    { type:'go', name:'起点' }, { type:'prop', name:'樱花大道', group:'A', price:600 },
    { type:'chance', name:'机会' }, { type:'prop', name:'甜心小巷', group:'A', price:600 },
    { type:'station', name:'中央车站', price:800 }, { type:'prop', name:'阳光公寓', group:'A', price:700 },
    { type:'jail', name:'监狱' }, { type:'prop', name:'码头仓库', group:'B', price:800 },
    { type:'tax', name:'税收' }, { type:'prop', name:'海风旅馆', group:'B', price:800 },
    { type:'auction', name:'拍卖行' }, { type:'prop', name:'灯塔广场', group:'B', price:900 },
    { type:'parking', name:'免费停车' }, { type:'prop', name:'中心百货', group:'C', price:1000 },
    { type:'station', name:'地铁2号线', price:800 }, { type:'prop', name:'天际大厦', group:'C', price:1000 },
    { type:'chance', name:'机会' }, { type:'prop', name:'金融街', group:'C', price:1100 },
    { type:'bonus', name:'奖励格' }, { type:'prop', name:'科技园', group:'D', price:1200 },
    { type:'insurance', name:'保险代理' }, { type:'prop', name:'电视塔', group:'D', price:1200 },
    { type:'station', name:'机场快线', price:800 }, { type:'prop', name:'王朝酒店', group:'D', price:1400 },
  ]};
  TPL.metro = null;   // 繁华都会 32 格太长，模板列表只给小图；要用就从大厅开一局metro看

  // ---- 启动 ----
  (function init(){
    const sel2 = $('fType');
    Object.entries(TYPES).forEach(([k, m]) => {
      const o = document.createElement('option');
      o.value = k; o.textContent = m.emoji + ' ' + m.label;
      sel2.appendChild(o);
    });
    // URL 带 mc= 分享码：直接载入（从大厅「编辑这张图」跳转过来）
    const mc = new URLSearchParams(location.search).get('mc');
    if (mc){
      const obj = decodeMapCode(mc);
      if (obj){ tiles = obj.tiles; if (obj.name) $('mapName').value = obj.name; }
    }
    if (!tiles.length) tiles = miniBoard();
    bindForm();
    render();
    renderSaved();
  })();
})();
