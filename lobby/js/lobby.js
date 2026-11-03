// ===== 3D 骰子装饰：矢量骰面贴图 + 翻面旋转 =====
(function(){
  const PIPS = {
    1:[[32,32]],
    2:[[19,19],[45,45]],
    3:[[19,19],[32,32],[45,45]],
    4:[[19,19],[45,19],[19,45],[45,45]],
    5:[[19,19],[45,19],[32,32],[19,45],[45,45]],
    6:[[19,16],[45,16],[19,32],[45,32],[19,48],[45,48]]
  };
  function faceImg(v){
    const dots = (PIPS[v] || []).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.4" fill="#F6F2E8"/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${dots}</svg>`;
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  }
  // 每个朝向对应哪个点数；对面之和为 7
  const FACES = [
    [1, 'rotateY(0deg)'], [6, 'rotateY(180deg)'],
    [3, 'rotateY(90deg)'], [4, 'rotateY(-90deg)'],
    [2, 'rotateX(90deg)'], [5, 'rotateX(-90deg)']
  ];
  const HALF = 27;   // 立方体半深 = 边长 54 / 2

  document.querySelectorAll('.die-wrap').forEach((wrap, i) => {
    const die = wrap.querySelector('.die3d');
    FACES.forEach(([v, tf]) => {
      const f = document.createElement('div');
      f.className = 'f';
      f.style.backgroundImage = faceImg(v) + ', linear-gradient(150deg,#95A3AE,#7B8A96)';
      f.style.transform = tf + ' translateZ(' + HALF + 'px)';
      die.appendChild(f);
    });

    // 透视、倾角、翻面角度拼在同一条 transform 上（顺序不能换）：只有一层 3D 上下文，
    // 中间层不会被浏览器扁平化。两颗骰子左右镜像，第二颗从 90° 起步。
    const base = 'perspective(520px) rotateX(-24deg) rotateY(' + (i === 1 ? -26 : 26) + 'deg) ';
    let rx = 0, ry = i === 1 ? 90 : 0, n = 0;
    function apply(){ die.style.transform = base + 'rotateX(' + rx + 'deg) rotateY(' + ry + 'deg)'; }
    apply();

    // 每次绕一个轴转 90°，停下来时正好换一个面朝前，不会停在棱角上
    const AXES = ['y', 'x', 'y', 'y', 'x', 'y'];
    function flip(){
      const axis = AXES[n++ % AXES.length];
      const dir = Math.random() < 0.5 ? 1 : -1;
      if (axis === 'y') ry += 90 * dir; else rx += 90 * dir;
      apply();
    }
    setTimeout(() => {
      flip();
      setInterval(flip, 3600);
    }, 1400 + i * 1800);
  });
})();

function openRules(){ document.getElementById('rulesModal').classList.remove('hidden'); }
function closeRules(){ document.getElementById('rulesModal').classList.add('hidden'); }
document.getElementById('rulesModal').addEventListener('click', e => {
  if (e.target.id === 'rulesModal') closeRules();
});

// ============ 两屏切换：先选模式 → 再配玩法 ============
let SETUP_MODE = 'ai';        // 'ai' | 'hotseat'
let HOTSEAT_N = 2;

function showView(name){
  const isSetup = ['setup', 'rooms', 'room'].includes(name);
  document.body.classList.toggle('setup-mode', isSetup);
  const map = { mode:'viewMode', setup:'viewSetup', rooms:'viewRooms', room:'viewRoom' };
  Object.keys(map).forEach(k => {
    const el = document.getElementById(map[k]);
    if (el) el.classList.toggle('hidden', k !== name);
  });
  window.scrollTo({ top: 0 });
}

function showSetup(mode, n){
  SETUP_MODE = mode === 'hotseat' ? 'hotseat' : 'ai';
  if (n) HOTSEAT_N = Math.min(4, Math.max(2, n));
  const ai = SETUP_MODE === 'ai';
  document.getElementById('secDiff').classList.toggle('hidden', !ai);
  document.getElementById('secCount').classList.toggle('hidden', ai);
  document.getElementById('setupTitle').textContent = ai ? '单机 vs AI' : '本地同屏对战';
  document.getElementById('startBtn').textContent = ai ? '开始对局' : '开始 ' + HOTSEAT_N + ' 人对局';
  showView('setup');
  syncSegs();
  syncSummary();
  const hash = ai ? '#setup=ai' : '#setup=hotseat' + HOTSEAT_N;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

function showModePicker(){
  showView('mode');
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

document.querySelectorAll('[data-mode]').forEach(b => {
  b.addEventListener('click', () => {
    if (b.dataset.mode === 'online'){ if (window.MPLobby) MPLobby.enter(); return; }
    showSetup(b.dataset.mode, b.dataset.mode === 'hotseat' ? HOTSEAT_N : 0);
  });
});
document.getElementById('backBtn').addEventListener('click', showModePicker);

// ============ 地图选择 ============
const MAP_KEY = 'monopoly_map_pref';
const MAP_NAMES = { classic:'经典小城', mini:'迷你快棋', metro:'繁华都会', random:'随机岛屿' };
let MAP_PREF = (() => {
  try {
    const v = localStorage.getItem(MAP_KEY);
    if (v && (MAP_NAMES[v] || v.startsWith('custom:'))) return v;
    return 'classic';
  } catch(e){ return 'classic'; }
})();
const CUSTOM_STORE_KEY = 'cm_custom_maps';   // 与 editor.js 共用
function customMapName(pref){
  if (!pref || !pref.startsWith('custom:')) return null;
  try {
    const store = JSON.parse(localStorage.getItem(CUSTOM_STORE_KEY) || '{}');
    const m = store[pref.slice(7)];
    return (m && m.name) || '自定义地图';
  } catch(e){ return '自定义地图'; }
}
// 编辑器保存的本机地图动态插进地图选择行（放在「地图编辑器」链接之前）
function renderCustomMapOpts(){
  const row = document.getElementById('mapOpts');
  if (!row) return;
  row.querySelectorAll('button[data-map^="custom:"]').forEach(b => b.remove());
  let store = {};
  try { store = JSON.parse(localStorage.getItem(CUSTOM_STORE_KEY) || '{}'); } catch(e){}
  const link = row.querySelector('.map-editor-link');
  Object.keys(store).sort((a, b) => (store[b].ts || 0) - (store[a].ts || 0)).forEach(id => {
    const b = document.createElement('button');
    b.dataset.map = 'custom:' + id;
    b.title = '自制地图（在地图编辑器里管理）';
    b.innerHTML = `🎨 ${(store[id].name || id).slice(0, 6)}<small>自制</small>`;
    row.insertBefore(b, link);
  });
}

function syncMapOpts(){
  document.querySelectorAll('#mapOpts button').forEach(b => {
    b.classList.toggle('on', b.dataset.map === MAP_PREF);
  });
  syncSummary();
}
document.getElementById('mapOpts').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  MAP_PREF = b.dataset.map;
  try { localStorage.setItem(MAP_KEY, MAP_PREF); } catch(err){}
  syncMapOpts();
});
document.getElementById('mseedInput').addEventListener('input', syncSummary);

// ============ 可选玩法开关（?mods= 参数传给对局） ============
const MODS_KEY = 'monopoly_mods_pref';
let MODS_PREF = (() => {
  try { const v = JSON.parse(localStorage.getItem(MODS_KEY)); return Array.isArray(v) ? v : []; } catch(e){ return []; }
})();

// 玩法套餐：一键勾好常用组合，仍可手动微调（微调后自动变「自定义」）
const PRESETS = {
  none:  [],
  std:   ['synergy', 'weather', 'items', 'quests'],
  chaos: ['synergy', 'weather', 'items', 'stocks', 'quests', 'visit', 'vote'],
};
function saveMods(){ try { localStorage.setItem(MODS_KEY, JSON.stringify(MODS_PREF)); } catch(e){} }
function presetKey(){
  const cur = MODS_PREF.slice().sort().join(',');
  for (const k in PRESETS){
    if (PRESETS[k].slice().sort().join(',') === cur) return k;
  }
  return 'custom';
}
function syncModsOpts(){
  document.querySelectorAll('#modsOpts button').forEach(b => {
    b.classList.toggle('on', MODS_PREF.includes(b.dataset.mod));
  });
  const k = presetKey();
  document.querySelectorAll('#presetRow button').forEach(b => b.classList.toggle('on', b.dataset.preset === k));
  const n = MODS_PREF.length;
  const cnt = document.getElementById('modsCount');
  if (cnt) cnt.textContent = n ? `已启用 ${n} 项` : '未启用 · 纯经典规则';
  const clr = document.getElementById('modsClear');
  if (clr) clr.classList.toggle('hidden', !n);
  syncSummary();
}
document.getElementById('modsOpts').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const m = b.dataset.mod;
  MODS_PREF = MODS_PREF.includes(m) ? MODS_PREF.filter(x => x !== m) : MODS_PREF.concat(m);
  saveMods();
  syncModsOpts();
});
document.getElementById('modsClear').addEventListener('click', () => {
  MODS_PREF = [];
  saveMods();
  syncModsOpts();
});
document.getElementById('presetRow').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || b.dataset.preset === 'custom') return;   // 「自定义」只是状态指示，不响应点击
  MODS_PREF = PRESETS[b.dataset.preset].slice();
  saveMods();
  syncModsOpts();
});

// ============ 对局设置分段控件 ============
const SEG_COLOR = { '1':'#6E7C88', '2':'#8E86A0', '3':'#B5806F', '4':'#B5806F', easy:'#93A0AA', normal:'#B08968', hard:'#B5806F' };
const AI_SETUP = { count:1, buy:'normal', build:'normal', tactic:'normal' };

document.querySelectorAll('#viewSetup .seg').forEach(seg => {
  seg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (seg.id === 'segCount'){
      AI_SETUP.count = parseInt(b.dataset.v);
    } else if (seg.id === 'segN'){
      HOTSEAT_N = parseInt(b.dataset.v);
      document.getElementById('startBtn').textContent = '开始 ' + HOTSEAT_N + ' 人对局';
      const hash = '#setup=hotseat' + HOTSEAT_N;
      if (location.hash !== hash) history.replaceState(null, '', hash);
      syncSummary();
    } else if (seg.id === 'segPreset'){
      AI_SETUP.buy = AI_SETUP.build = AI_SETUP.tactic = b.dataset.v;
    } else {
      AI_SETUP[seg.dataset.attr] = b.dataset.v;
    }
    syncSegs();
  });
});

function syncSegs(){
  const uniform = AI_SETUP.buy === AI_SETUP.build && AI_SETUP.build === AI_SETUP.tactic;
  document.querySelectorAll('#viewSetup .seg').forEach(seg => {
    let cur;
    if (seg.id === 'segCount') cur = String(AI_SETUP.count);
    else if (seg.id === 'segN') cur = String(HOTSEAT_N);
    else if (seg.id === 'segPreset') cur = uniform ? AI_SETUP.buy : '';
    else cur = AI_SETUP[seg.dataset.attr];
    seg.querySelectorAll('button').forEach(b => {
      const on = b.dataset.v === cur;
      b.classList.toggle('on', on);
      b.style.background = on ? SEG_COLOR[b.dataset.v] : 'transparent';
      b.style.color = on ? '#fff' : '';
    });
  });
  syncSummary();
}

// ============ 摘要文案（模式卡 + 开始条） ============
const DIFF_NAME = { easy:'简单', normal:'普通', hard:'困难' };
function diffLabel(){
  const v = [AI_SETUP.buy, AI_SETUP.build, AI_SETUP.tactic];
  return v.every(x => x === v[0]) ? DIFF_NAME[v[0]] : '自定义难度';
}
function modsLabel(){ return MODS_PREF.length ? MODS_PREF.length + ' 项玩法' : '纯经典玩法'; }

function syncSummary(){
  const m = customMapName(MAP_PREF) || MAP_NAMES[MAP_PREF] || '经典小城';
  const aiSum = document.getElementById('sumAi');
  if (aiSum) aiSum.textContent = `${m} · ${modsLabel()} · ${diffLabel()}`;
  const hsSum = document.getElementById('sumHotseat');
  if (hsSum) hsSum.textContent = `${m} · ${modsLabel()}`;
  const tip = document.getElementById('startTip');
  if (tip) tip.textContent = SETUP_MODE === 'ai'
    ? `即将开始：${m} · ${modsLabel()} · ${AI_SETUP.count} 位 AI · ${diffLabel()}`
    : `即将开始：${m} · ${modsLabel()} · ${HOTSEAT_N} 人同屏`;
}

// ============ 开始对局 ============
document.getElementById('startBtn').addEventListener('click', () => {
  const q = new URLSearchParams({ new:'1', map: MAP_PREF });
  let slot;
  if (SETUP_MODE === 'ai'){
    q.set('mode', 'ai');
    q.set('ai', String(AI_SETUP.count));
    q.set('buy', AI_SETUP.buy);
    q.set('build', AI_SETUP.build);
    q.set('tactic', AI_SETUP.tactic);
    slot = SAVE_SLOTS[0];
  } else {
    q.set('mode', 'hotseat');
    q.set('n', String(HOTSEAT_N));
    slot = SAVE_SLOTS.find(s => s.id === 'hotseat' + HOTSEAT_N);
  }
  if (MAP_PREF === 'random'){
    const ms = (document.getElementById('mseedInput').value || '').trim();
    if (/^\d{1,6}$/.test(ms)) q.set('mseed', ms);
  }
  if (MAP_PREF && MAP_PREF.startsWith('custom:')){
    q.set('map', 'custom');
    q.set('mid', MAP_PREF.slice(7));     // 对局页从本机 cm_custom_maps 里取
  }
  if (MODS_PREF.length) q.set('mods', MODS_PREF.join(','));
  if (slot && readSlot(slot) && !confirm('开始新对局会清空「' + slot.label + '」的存档，确定吗？')) return;
  location.href = '../../game/html/game.html?' + q.toString();
});

// ============ 存档识别 ============
const SAVE_SLOTS = [
  { id:'ai',        key:'monopoly_save_v3_ai',        mode:'ai',      n:null, host:'savesAi',      label:'单机 vs AI',  short:'AI',   expect:2 },
  { id:'hotseat2',  key:'monopoly_save_v3_hotseat2',  mode:'hotseat', n:2,    host:'savesHotseat', label:'2 人同屏',    short:'2 人', expect:2 },
  { id:'hotseat3',  key:'monopoly_save_v3_hotseat3',  mode:'hotseat', n:3,    host:'savesHotseat', label:'3 人同屏',    short:'3 人', expect:3 },
  { id:'hotseat4',  key:'monopoly_save_v3_hotseat4',  mode:'hotseat', n:4,    host:'savesHotseat', label:'4 人同屏',    short:'4 人', expect:4 },
];

const SAVE_ICON = '<svg class="sico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h4l1.8 2h7.2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-11Z"/><path d="M12 10.5v4.5M10 13.2l2 2 2-2"/></svg>';

function pad2(n){ return String(n).padStart(2,'0'); }

function fmtTime(ts){
  const d = new Date(ts), now = Date.now(), diff = now - ts;
  if (!isFinite(ts) || diff < 0 || diff < 60e3) return '刚刚';
  if (diff < 3600e3) return Math.floor(diff / 60e3) + '分钟前';
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  if (sameDay) return '今天 ' + hm;
  const y = new Date(now).getFullYear();
  return d.getFullYear() === y
    ? (d.getMonth()+1) + '月' + d.getDate() + '日'
    : d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate());
}

function readSlot(slot){
  try {
    const raw = localStorage.getItem(slot.key);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || d.v !== 2 || d.mode !== slot.mode) return null;
    // 单机档的人数取决于 AI 数量（人类 1 + AI n），同屏档固定
    const expect = slot.mode === 'ai' ? 1 + Math.min(3, Math.max(1, parseInt(d.ai) || 1)) : slot.expect;
    if (!Array.isArray(d.players) || d.players.length !== expect) return null;
    return d;
  } catch (e) { return null; }
}

function renderSaves(){
  // 清空后重绘，避免重复追加
  [...new Set(SAVE_SLOTS.map(s => s.host))].forEach(h => {
    const box = document.getElementById(h);
    if (box) box.innerHTML = '';
  });

  SAVE_SLOTS.forEach(slot => {
    const box = document.getElementById(slot.host);
    if (!box) return;
    const data = readSlot(slot);
    if (!data) return;

    const dname = { easy:'简单', normal:'普通', hard:'困难' };
    let title, sub;
    if (slot.id === 'ai'){
      let lv = '普通';
      const a = data.attrs;
      if (a && a.buy && a.build && a.tactic){
        const vals = [a.buy, a.build, a.tactic];
        lv = vals.every(v => v === vals[0]) ? dname[vals[0]] : '自定义';
      }
      title = '继续存档 · ' + (data.ai > 1 ? data.ai + ' 位 AI' : 'AI 对手');
      sub = `第 ${data.round} 回合 · ${lv} · <span class="nw">${fmtTime(data.savedAt)}</span>`;
    } else {
      title = '继续存档 · ' + slot.short;
      sub = `第 ${data.round} 回合 · ${fmtTime(data.savedAt)}`;
    }

    const url = '../../game/html/game.html?mode=' + slot.mode + (slot.n ? '&n=' + slot.n : '')
      + (slot.id === 'ai' && data.ai ? '&ai=' + data.ai : '')
      + (data.opt && data.opt !== '0' ? '&mods=' + data.opt : '')   // 续档带回开局时选的可选玩法
      + '&autoload=1';

    const a = document.createElement('a');
    a.className = 'save-row';
    a.href = url;
    a.innerHTML = SAVE_ICON +
      '<span class="save-main"><b>' + title + '</b>' +
      '<small>' + sub + '</small></span>' +
      '<span class="save-x" title="删除该存档">✕</span>';

    a.querySelector('.save-x').addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (confirm('删除「' + slot.label + '」的存档？删除后无法恢复。')){
        try { localStorage.removeItem(slot.key); } catch (err) {}
        a.remove();
        syncButtons();
      }
    });
    box.appendChild(a);
  });
  syncButtons();
}

// 有存档时：模式卡按钮挂小圆点（开新局前会在「开始对局」二次确认）
function syncButtons(){
  const has = id => !!readSlot(SAVE_SLOTS.find(s => s.id === id));
  const ai = document.getElementById('goAi');
  if (ai) ai.classList.toggle('has-save', has('ai'));
  const hs = document.getElementById('goHotseat');
  if (hs) hs.classList.toggle('has-save', has('hotseat2') || has('hotseat3') || has('hotseat4'));
}

renderSaves();

// 从对局返回、或切回本页时刷新存档列表
window.addEventListener('pageshow', () => { renderCustomMapOpts(); renderSaves(); syncModsOpts(); syncMapOpts(); syncSegs(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) renderSaves(); });

// ============ 初始化 + 直链支持 ============
syncModsOpts();
syncMapOpts();
syncSegs();

(function initHash(){
  const h = location.hash;
  if (h === '#rules'){ openRules(); return; }
  if (h === '#ai'){ showSetup('ai'); return; }
  if (h === '#online'){ if (window.MPLobby) MPLobby.enter(); return; }
  const m = /^#setup=(ai|hotseat[2-4])$/.exec(h);
  if (!m) return;
  if (m[1] === 'ai') showSetup('ai');
  else showSetup('hotseat', parseInt(m[1].slice(7), 10));
})();
