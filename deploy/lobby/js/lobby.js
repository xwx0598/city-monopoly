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

function openAiSetup(){
  // 有存档时用上次的设置作为默认值，方便“同设置再来一局”
  const d = readSlot({ key:'monopoly_save_v3_ai', mode:'ai', expect:2 });
  if (d){
    AI_SETUP.count = Math.min(3, Math.max(1, parseInt(d.ai) || 1));
    if (d.attrs){
      ['buy','build','tactic'].forEach(k => {
        if (['easy','normal','hard'].includes(d.attrs[k])) AI_SETUP[k] = d.attrs[k];
      });
    }
  }
  document.getElementById('aiModal').classList.remove('hidden');
  syncSegs();
}
function closeAiSetup(){ document.getElementById('aiModal').classList.add('hidden'); }
document.getElementById('aiModal').addEventListener('click', e => {
  if (e.target.id === 'aiModal') closeAiSetup();
});

// ============ 地图选择 ============
const MAP_KEY = 'monopoly_map_pref';
const MAP_NAMES = { classic:'经典小城', mini:'迷你快棋', metro:'繁华都会', random:'随机岛屿' };
let MAP_PREF = (() => {
  try { const v = localStorage.getItem(MAP_KEY); return MAP_NAMES[v] ? v : 'classic'; } catch(e){ return 'classic'; }
})();

function syncMapOpts(){
  document.querySelectorAll('#mapOpts button').forEach(b => {
    b.classList.toggle('on', b.dataset.map === MAP_PREF);
  });
  // 同屏对战的人数按钮始终跟随当前地图选择（并带上可选玩法参数）
  document.querySelectorAll('.hotseat-opts a').forEach(a => {
    const n = a.dataset.slot.replace('hotseat', '');
    a.href = '../../game/html/game.html?mode=hotseat&n=' + n + '&map=' + MAP_PREF + '&new=1' + modsQuery();
  });
}
document.getElementById('mapOpts').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  MAP_PREF = b.dataset.map;
  try { localStorage.setItem(MAP_KEY, MAP_PREF); } catch(err){}
  syncMapOpts();
});
// 注意：首次调用 syncMapOpts 必须等 MODS_PREF 初始化之后（见下方可选玩法段），
// 因为 syncMapOpts → modsQuery 会读取 MODS_PREF，提前调用会踩 TDZ 报错

// ============ 可选玩法开关（?mods= 参数传给对局） ============
const MODS_KEY = 'monopoly_mods_pref';
let MODS_PREF = (() => {
  try { const v = JSON.parse(localStorage.getItem(MODS_KEY)); return Array.isArray(v) ? v : []; } catch(e){ return []; }
})();
function modsQuery(){ return MODS_PREF.length ? '&mods=' + MODS_PREF.join(',') : ''; }
function syncModsOpts(){
  document.querySelectorAll('#modsOpts button').forEach(b => {
    b.classList.toggle('on', MODS_PREF.includes(b.dataset.mod));
  });
}
document.getElementById('modsOpts').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const m = b.dataset.mod;
  MODS_PREF = MODS_PREF.includes(m) ? MODS_PREF.filter(x => x !== m) : MODS_PREF.concat(m);
  try { localStorage.setItem(MODS_KEY, JSON.stringify(MODS_PREF)); } catch(err){}
  syncModsOpts();
  syncMapOpts();   // 同屏入口链接要带上最新开关
});
syncModsOpts();
syncMapOpts();   // MODS_PREF 已就绪，这里才能安全带上可选玩法参数

// ============ 对局设置分段控件 ============
const SEG_COLOR = { '1':'#6E7C88', '2':'#8E86A0', '3':'#B5806F', easy:'#93A0AA', normal:'#B08968', hard:'#B5806F' };
const AI_SETUP = { count:1, buy:'normal', build:'normal', tactic:'normal' };

document.querySelectorAll('#aiModal .seg').forEach(seg => {
  seg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (seg.id === 'segCount'){
      AI_SETUP.count = parseInt(b.dataset.v);
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
  document.querySelectorAll('#aiModal .seg').forEach(seg => {
    let cur;
    if (seg.id === 'segCount') cur = String(AI_SETUP.count);
    else if (seg.id === 'segPreset') cur = uniform ? AI_SETUP.buy : '';
    else cur = AI_SETUP[seg.dataset.attr];
    seg.querySelectorAll('button').forEach(b => {
      const on = b.dataset.v === cur;
      b.classList.toggle('on', on);
      b.style.background = on ? SEG_COLOR[b.dataset.v] : 'transparent';
      b.style.color = on ? '#fff' : '';
    });
  });
}

document.getElementById('aiStartBtn').addEventListener('click', () => {
  if (readSlot(SAVE_SLOTS[0]) && !confirm('开始新对局会清空「单机 vs AI」的存档，确定吗？')) return;
  const q = new URLSearchParams({
    mode:'ai', ai:String(AI_SETUP.count),
    buy:AI_SETUP.buy, build:AI_SETUP.build, tactic:AI_SETUP.tactic,
    map: MAP_PREF, new:'1',
  });
  if (MODS_PREF.length) q.set('mods', MODS_PREF.join(','));
  location.href = '../../game/html/game.html?' + q.toString();
});
syncSegs();

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

// 有存档时：相关入口加存档小圆点 + 开新局前二次确认
function syncButtons(){
  SAVE_SLOTS.forEach(slot => {
    const data = readSlot(slot);
    document.querySelectorAll('[data-slot="' + slot.id + '"]').forEach(link => {
      link.classList.toggle('has-save', !!data);
      link.onclick = data ? (e => {
        if (!confirm('开始新对局会清空「' + slot.label + '」的存档，确定吗？')){
          e.preventDefault();
          return false;
        }
      }) : null;
    });
  });
  // 单机卡片的入口按钮也点亮存档小圆点（确认逻辑在弹窗的开始按钮上）
  const aiCardBtn = document.getElementById('aiSetupBtn');
  if (aiCardBtn) aiCardBtn.classList.toggle('has-save', !!readSlot(SAVE_SLOTS[0]));
}

renderSaves();

// 从对局返回、或切回本页时刷新存档列表
window.addEventListener('pageshow', renderSaves);
document.addEventListener('visibilitychange', () => { if (!document.hidden) renderSaves(); });

// 支持 #rules / #ai 直达对应弹窗
if (location.hash === '#rules') openRules();
if (location.hash === '#ai') openAiSetup();
