// ================================================================
// 城市大富翁 · L0 核心引擎（Core）
// 只包含最基础的对局能力：掷骰移动 / 买地 / 租金 / 建房变卖 / 破产清算 / 胜负判定
// 特殊地块、事件卡、组合、多地图、AI 难度全部由 js/modules/ 下的模块提供；
// 模块通过 Game.* 钩子挂载，任何模块报错都不影响核心对局（见 Game.use）。
// ================================================================
window.Game = {
  _loaded: [], _off: [], _failed: [],
  modEnabled(name){
    if (new URLSearchParams(location.search).get('mods') === '0') return false;
    return (window.MB_MODULES || []).includes(name);
  },
  // 模块装载入口：一个模块的所有代码都包在这里，出错只记日志、不炸游戏
  use(name, fn){
    if (!Game.modEnabled(name)){ Game._off.push(name); return; }
    try { fn(Game); Game._loaded.push(name); }
    catch(e){ Game._failed.push(name); console.warn('[模块装载失败] ' + name, e); }
  },
  // ---- 扩展点 ----
  tileHandlers: {},   // 地块类型 -> async 处理器 (pi, i, t, depth)；未注册的类型落格即歇脚
  rentOverrides: {},  // 地块类型 -> fn(i)=>租金（电站等自定义租金公式的模块用）
  rentFilters: [],    // fn(ownerPi, i, t, rent)=>rent（组合等倍率模块用）
  salaryFilters: [],  // fn(pi, salary)=>salary
  nameSuffix: [],     // fn(pi)=>html，玩家名后缀（AI 难度标签用）
  badges: [],         // fn(pi)=>html，玩家卡徽章（组合用）
  afterRender: [],    // fn()，renderPlayers 之后触发（奖池提示、组合播报）
  saveExtras: [],     // fn()=>object，模块存档数据（合并进存档的 mods 字段）
  loadExtras: [],     // fn(save)，读档时恢复模块状态
  beforeBoard: [],    // fn(bootSave)，棋盘渲染前（地图模块在此决定用哪张图）
  onStart: [],        // fn()，新对局开始时
  onRound: [],        // fn(newRound)，回合数递增时（新一轮即将开始，上一个完整回合已结束）
  payWaivers: [],     // fn(from, to, amount, reason)=>null 表示本次付款全额免除（保险模块用）
  ai: null,           // AI 决策策略，模块可整体替换（见下方默认实现）
  applyMap: null,     // 由 core 提供
  DEFAULT_MAP: null,  // 核心内置地图（模块未加载时兜底）
};

// ================= 基础数据 =================
const QS = new URLSearchParams(location.search);
const GAME_MODE = QS.get('mode') === 'hotseat' ? 'hotseat' : 'ai';
const HOTSEAT_N = Math.min(4, Math.max(2, parseInt(QS.get('n')) || 2));
const PLAYER_COLORS = ['#6E8598', '#B08968', '#B5806F', '#8E86A0'];
const START_MONEY = 1500, SALARY = 200, MAX_ROUNDS = 30;
const MAX_LEVEL = 3;
const LEVEL_ICON = [null, 'ic-house', 'ic-tower', 'ic-church'];
const LEVEL_NAME = ['空地', '小屋', '大楼', '地标'];
const AI_NAMES = ['AI 阿豪', 'AI 小柔', 'AI 老周'];
const AI_COUNT = GAME_MODE === 'ai' ? Math.min(3, Math.max(1, parseInt(QS.get('ai')) || 1)) : 0;

const GROUP_COLORS = { A:'#8E86A0', B:'#8FA6B8', C:'#C39B7E', D:'#98A99B', E:'#B98D8D',
  station:'#8B8779', utility:'#C79E6E', chance:'#B08968', tax:'#A9605A', bonus:'#AD8A55',
  casino:'#A9738A', police:'#6E8598', insurance:'#7E9C8F', auction:'#A9885C' };

// ================= 玩家 =================
const players = [];
const mkPlayer = (name, color, isAI) => ({ name, color, money:START_MONEY, pos:0, props:[], bankrupt:false, skip:0, jail:0, jailCard:0, isAI });
if (GAME_MODE === 'ai'){
  players.push(mkPlayer('你', PLAYER_COLORS[0], false));
  for (let k = 0; k < AI_COUNT; k++){
    players.push(mkPlayer(AI_NAMES[k], PLAYER_COLORS[(k + 1) % 4], true));
  }
} else {
  for (let k = 0; k < HOTSEAT_N; k++){
    players.push(mkPlayer(`玩家 ${k+1}`, PLAYER_COLORS[k], false));
  }
}

let tileOwner = {};
let tileLevel = {};
let tileMortgaged = {};   // 抵押状态（经典规则：半价套现，可付 110% 赎回；抵押中不收租、不能加盖）
let turn = 0, round = 1, gameOver = false, busy = false;
let lastRoll = 7;          // 最近一次骰子总点（自定义租金公式的模块可能用）
let doubleStreak = 0;      // 连续掷出双数的次数（三连入狱）

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = id => document.getElementById(id);
// 图标：内联 SVG（见 js/icons.js）
const icon = (name, cls = '', style = '') => mbIcon(name, cls, null, style);

// ================= 存档 =================
const SAVE_KEY = 'monopoly_save_v3_' + (GAME_MODE === 'ai' ? 'ai' : 'hotseat' + HOTSEAT_N);

function saveGame(){
  if (gameOver) return;
  try {
    const mods = {};
    Game.saveExtras.forEach(f => Object.assign(mods, f()));
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 2, mode: GAME_MODE, savedAt: Date.now(), round, turn,
      players: players.map(p => ({ money:p.money, pos:p.pos, props:[...p.props], bankrupt:p.bankrupt, skip:p.skip || 0, jail:p.jail || 0, jailCard:p.jailCard || 0, insured:p.insured || 0 })),
      tileOwner: { ...tileOwner },
      levels: { ...tileLevel },
      mortgaged: { ...tileMortgaged },
      mods,
    }));
  } catch(e){}
}
function loadSave(){
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d.v !== 2 || d.mode !== GAME_MODE || !Array.isArray(d.players) || d.players.length !== players.length) return null;
    return d;
  } catch(e){ return null; }
}
function clearSave(){ try { localStorage.removeItem(SAVE_KEY); } catch(e){} }

// ================= 地图几何 =================
// 棋盘为正方形，四个角固定为 起点/监狱/免费停车/奖励格，边数可变。
const BOARD_PX = 530, CORNER_PX = 90;
let MAP = null, TILES = [], TOTAL = 24, EDGE = 5, EDGE_W = 70, CORNER_IDX = [0, 6, 12, 18];

Game.applyMap = function(m){
  MAP = m;
  TILES = m.tiles;
  TOTAL = TILES.length;
  EDGE = TOTAL / 4 - 1;
  EDGE_W = (BOARD_PX - 2 * CORNER_PX) / EDGE;
  CORNER_IDX = [0, EDGE + 1, 2 * (EDGE + 1), 3 * (EDGE + 1)];
};

// 核心内置地图：模块全部关闭时的兜底棋盘（只有最基础的地产玩法）
Game.DEFAULT_MAP = { id:'classic', name:'经典小城', tiles: [
  { type:'go',      name:'起点' },
  { type:'prop',    name:'樱花大道', group:'A', price:600 },
  { type:'chance',  name:'机会' },
  { type:'prop',    name:'甜心小巷', group:'A', price:600 },
  { type:'station', name:'中央车站', price:800 },
  { type:'prop',    name:'阳光公寓', group:'A', price:700 },
  { type:'jail',    name:'监狱' },
  { type:'prop',    name:'码头仓库', group:'B', price:800 },
  { type:'tax',     name:'税收' },
  { type:'prop',    name:'海风旅馆', group:'B', price:800 },
  { type:'chance',  name:'机会' },
  { type:'prop',    name:'灯塔广场', group:'B', price:900 },
  { type:'parking', name:'免费停车' },
  { type:'prop',    name:'中心百货', group:'C', price:1000 },
  { type:'station', name:'地铁2号线', price:800 },
  { type:'prop',    name:'天际大厦', group:'C', price:1000 },
  { type:'chance',  name:'机会' },
  { type:'prop',    name:'金融街', group:'C', price:1100 },
  { type:'bonus',   name:'奖励格' },
  { type:'prop',    name:'科技园', group:'D', price:1200 },
  { type:'tax',     name:'税收' },
  { type:'prop',    name:'电视塔', group:'D', price:1200 },
  { type:'station', name:'机场快线', price:800 },
  { type:'prop',    name:'王朝酒店', group:'D', price:1400 },
]};

// ================= 棋盘渲染 =================
function tileColor(t){ return t.type === 'prop' ? GROUP_COLORS[t.group] : (GROUP_COLORS[t.type] || '#B4B2A9'); }

function tileRect(i){
  const B = BOARD_PX, C = CORNER_PX, e = EDGE_W;
  if (i === 0) return { x:0, y:0, w:C, h:C };
  if (i === CORNER_IDX[1]) return { x:B-C, y:0, w:C, h:C };
  if (i === CORNER_IDX[2]) return { x:B-C, y:B-C, w:C, h:C };
  if (i === CORNER_IDX[3]) return { x:0, y:B-C, w:C, h:C };
  if (i < CORNER_IDX[1]) return { x:C + (i-1)*e, y:0, w:e, h:C };
  if (i < CORNER_IDX[2]) return { x:B-C, y:C + (i-CORNER_IDX[1]-1)*e, w:C, h:e };
  if (i < CORNER_IDX[3]) return { x:C + (CORNER_IDX[3]-1-i)*e, y:B-C, w:e, h:C };
  return { x:0, y:C + (TOTAL-1-i)*e, w:C, h:e };
}

const TILE_ICONS = {
  chance: ['ic-card',  '#A9744C'],
  tax:    ['ic-dollar','#A9605A'],
};

function buildBoard(){
  const [c1, c2, c3] = [CORNER_IDX[1], CORNER_IDX[2], CORNER_IDX[3]];
  const stripOf = i => (i <= c1 ? 'rowTop' : i <= c2 ? 'colRight' : i <= c3 ? 'rowBottom' : 'colLeft');
  TILES.forEach((t, i) => {
    const isCorner = CORNER_IDX.includes(i);
    const horiz = stripOf(i) === 'rowTop' || stripOf(i) === 'rowBottom';
    const el = document.createElement('div');
    el.className = 'tile' + (isCorner ? ' corner' : '');
    el.id = 'tile' + i;
    el.style.width  = (isCorner ? CORNER_PX : (horiz ? EDGE_W : CORNER_PX)) + 'px';
    el.style.height = (isCorner ? CORNER_PX : (horiz ? CORNER_PX : EDGE_W)) + 'px';

    if (t.type === 'prop' || t.type === 'station' || t.type === 'utility'){
      el.innerHTML = `
        <div class="cbar" style="background:${tileColor(t)}"></div>
        <div class="tname">${t.name}</div>
        ${t.price ? `<div class="tprice">¥${t.price}</div>` : ''}
        ${t.type === 'prop' ? `<svg class="ico struct" id="struct${i}" viewBox="-32 -32 64 64"><path d=""/></svg>` : ''}`;
    } else if (t.type === 'chance' || t.type === 'tax'){
      const [cls, col] = TILE_ICONS[t.type];
      // 机会用描边问号（比实心卡片更易辨识），税收用美元符号
      const glyph = t.type === 'chance'
        ? `<svg class="ico mini" viewBox="-32 -32 64 64" style="color:${col}">
             <path d="M-8.5 -7 Q-8.5 -19.5 0 -19.5 Q8.5 -19.5 8.5 -11 Q8.5 -4.2 2 -1.4 L2 3"
                   fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
             <circle cx="0" cy="14.5" r="4.2" fill="currentColor"/></svg>`
        : icon(cls.replace('ic-', ''), 'mini', `color:${col}`);
      el.innerHTML = `<div class="cbar" style="background:${GROUP_COLORS[t.type]}"></div>
        <div class="tname" style="font-size:10px">${t.name}</div>
        ${glyph}`;
    } else if (t.type === 'casino' || t.type === 'police'){
      el.innerHTML = `<div class="cbar" style="background:${GROUP_COLORS[t.type]}"></div>
        <div class="tname" style="font-size:10px">${t.name}</div>
        <div class="temoji">${t.type === 'casino' ? '🎰' : '🚨'}</div>`;
    } else if (t.type === 'go'){
      el.innerHTML = `${icon('flag', '', 'width:26px;height:26px;color:#5F6C78')}
        <div class="cname" style="color:#5F6C78;margin-top:3px">起点<br><span style="font-size:9px">+¥${SALARY}</span></div>`;
    } else if (t.type === 'jail'){
      el.innerHTML = `${icon('lock', '', 'width:24px;height:24px;color:#96714F')}
        <div class="cname" style="margin-top:3px">监狱</div>`;
    } else if (t.type === 'parking'){
      el.innerHTML = `<div class="cname" style="font-size:22px">🅿️</div><div class="cname">免费停车<br><span style="font-size:9px;color:#9C9789" id="poolHint">奖池</span></div>`;
    } else if (t.type === 'bonus'){
      el.innerHTML = `${icon('award', '', 'width:26px;height:26px;color:#AD8A55')}
        <div class="cname" style="margin-top:2px">奖励<br><span style="font-size:9px">+¥200</span></div>`;
    } else if (t.emoji){
      // 通用兜底：模块自定义地块只要带 emoji 字段就能渲染（模块关闭时落格=歇脚）
      el.innerHTML = `<div class="cbar" style="background:${tileColor(t)}"></div>
        <div class="tname" style="font-size:10px">${t.name}</div>
        <div class="temoji">${t.emoji}</div>`;
    }
    $(stripOf(i)).appendChild(el);
  });
  // 让棋盘四个角跟着圆角走（角格原先是直角，会盖住棋盘圆角）
  const radii = { 0:'18px 0 0 0', [c1]:'0 18px 0 0', [c2]:'0 0 18px 0', [c3]:'0 0 0 18px' };
  Object.entries(radii).forEach(([i, r]) => { const el = $('tile' + i); if (el) el.style.borderRadius = r; });
}

function refreshTile(i){
  const dot = document.querySelector('#tile'+i+' .owner-dot');
  if (dot) dot.remove();
  if (tileOwner[i] !== undefined){
    const d = document.createElement('div');
    d.className = 'owner-dot';
    d.style.background = players[tileOwner[i]].color;
    $('tile'+i).appendChild(d);
  }
  const st = $('struct'+i);
  if (st){
    const lv = tileLevel[i] || 0;
    st.classList.toggle('on', lv > 0);
    const path = st.querySelector('path');
    const nm = lv > 0 ? LEVEL_ICON[lv].replace('ic-', '') : 'house';
    if (path && MB_ICONS[nm]) path.setAttribute('d', MB_ICONS[nm]);
    st.style.color = tileOwner[i] !== undefined ? players[tileOwner[i]].color : '#9A958A';
  }
  // 抵押标记
  const mk = document.querySelector('#tile'+i+' .mtg-mark');
  if (tileMortgaged[i]){
    if (!mk){
      const m = document.createElement('div');
      m.className = 'mtg-mark';
      m.textContent = '抵';
      $('tile'+i).appendChild(m);
    }
  } else if (mk) mk.remove();
}

// ================= 棋子 =================
const PAWN_D = 'M13 -13.1 Q13 -7.75 9.1 -4 L8.45 -3.35 9.25 -1.8 Q12.95 6.45 13 18.2 L13 18.35 Q13 21.5 9.25 23.75 5.45 26 0 26 -5.35 26 -9.15 23.75 -13 21.5 -13 18.35 L-13 18.2 Q-12.95 6.45 -9.15 -1.8 L-8.4 -3.3 -9.15 -4 Q-13 -7.75 -13 -13.1 -13 -18.5 -9.15 -22.25 -5.35 -26 0 -26 5.35 -26 9.1 -22.25 13 -18.5 13 -13.1';
const TOKENS = [];
function initTokens(){
  const layer = $('tokenLayer');
  players.forEach((p, pi) => {
    const el = document.createElement('div');
    el.className = 'token';
    el.style.color = p.color;
    el.style.zIndex = 10 + pi;
    el.innerHTML = `<svg viewBox="-32 -32 64 64">
      <path d="${PAWN_D}" fill="none" stroke="#ffffff" stroke-width="5" stroke-linejoin="round"/>
      <path d="${PAWN_D}" fill="currentColor"/>
    </svg>`;
    layer.appendChild(el);
    TOKENS.push(el);
  });
}
function positionTokens(){
  const n = players.length;
  const [c1, c2, c3] = [CORNER_IDX[1], CORNER_IDX[2], CORNER_IDX[3]];
  const gap = n > 2 ? 9 : 12;   // 多人多 AI 时棋子间距收紧
  players.forEach((p, pi) => {
    const el = TOKENS[pi];
    if (!el) return;
    if (p.bankrupt){ el.style.display = 'none'; return; }
    const r = tileRect(p.pos);
    const off = (pi - (n-1)/2) * gap;
    let x, y;
    if (p.pos <= c1){ x = r.x + r.w/2 - 11 + off; y = r.y + r.h - 25; }
    else if (p.pos <= c2){ x = r.x + 2; y = r.y + r.h/2 - 11 + off; }
    else if (p.pos <= c3){ x = r.x + r.w/2 - 11 + off; y = r.y + 3; }
    else { x = r.x + r.w - 24; y = r.y + r.h/2 - 11 + off; }
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  });
}

// ================= 渲染 =================
function renderPlayers(){
  $('playersBar').innerHTML = players.map((p, pi) => {
    let suffix = '', badges = '';
    Game.nameSuffix.forEach(f => { try { suffix += f(pi) || ''; } catch(e){} });
    if (!p.bankrupt) Game.badges.forEach(f => { try { badges += f(pi) || ''; } catch(e){} });
    return `
    <div class="pcard${pi === turn && !gameOver ? ' current' : ''}${p.bankrupt ? ' broke' : ''}" id="pc${pi}">
      <div class="pname"><span class="pdot" style="background:${p.color}"></span><span class="pnm">${p.name}</span>${suffix}</div>
      <div class="pmoney${!p.bankrupt && p.money < riskLine(pi) ? ' danger' : ''}">${icon('dollar')}${p.money}${!p.bankrupt && p.money < riskLine(pi) ? ' ⚠️' : ''}</div>
      <div class="pcombos">${badges}</div>
      <div class="pprops">${p.props.length ? p.props.map(i => TILES[i].name +
        (tileMortgaged[i] ? '(抵押)' : (tileLevel[i] ? `(${LEVEL_NAME[tileLevel[i]]})` : ''))).join('、') : '暂无地产'}</div>
    </div>`;
  }).join('');
  Game.afterRender.forEach(f => { try { f(); } catch(e){} });
  updateBuildBtn();
}

function log(msg, cls = ''){
  const d = document.createElement('div');
  if (cls) d.className = cls;
  d.textContent = msg;
  const box = $('log');
  box.appendChild(d);
  if (box.children.length > 80) box.removeChild(box.firstChild);
  box.scrollTop = 1e6;
}

function floatMoney(pi, delta){
  const card = $('pc'+pi);
  if (!card) return;
  const r = card.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'float-money';
  el.style.position = 'fixed';
  el.style.left = (r.right - 62) + 'px';
  el.style.top = (r.top + 26) + 'px';
  el.style.color = delta > 0 ? '#4F7A5E' : '#A05752';
  el.textContent = (delta > 0 ? '+' : '−') + '¥' + Math.abs(delta);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

function flashTile(i){
  const el = $('tile'+i);
  if (!el) return;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 700);
}

function highlightTile(i, on){
  document.querySelectorAll('.tile.active').forEach(e => e.classList.remove('active'));
  if (on) $('tile'+i).classList.add('active');
}

function updateRound(){ $('roundInfo').textContent = `第 ${round} / ${MAX_ROUNDS} 回合`; }

// ================= 骰子（CSS 3D 立方体） =================
const PIP_MAP = {
  1: [4], 2: [0,8], 3: [0,4,8], 4: [0,2,6,8], 5: [0,2,4,6,8], 6: [0,2,3,5,6,8]
};
// 各点数面在立方体上的摆放（先摆放，转动立方体让目标面朝向玩家）
const DIE_FACES = [
  ['rotateY(0deg)',    1], ['rotateY(180deg)',  6],
  ['rotateY(90deg)',   3], ['rotateY(-90deg)',  4],
  ['rotateX(90deg)',   2], ['rotateX(-90deg)',  5],
];
// 俯视倾角放在 CSS 的 .die 上（屏幕坐标系），这里只负责「哪个点数面朝向玩家」
function buildDieFace(v){
  const f = document.createElement('div');
  f.className = 'f';
  const pips = PIP_MAP[v] || [];
  for (let k = 0; k < 9; k++){
    const p = document.createElement('span');
    p.className = pips.includes(k) ? 'p' : 'p empty';
    f.appendChild(p);
  }
  return f;
}
function makeDie(el){
  el.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'die-box';
  DIE_FACES.forEach(([tf, v]) => {
    const f = buildDieFace(v);
    f.style.transform = tf + ' translateZ(26px)';
    box.appendChild(f);
  });
  el.appendChild(box);
}
// 让点数 n 朝向玩家的两个轴角度（拆成 rx/ry 便于连续插值）
const ANGLE_OF = { 1:[0,0], 2:[-90,0], 3:[0,-90], 4:[0,90], 5:[90,0], 6:[0,180] };
const dieSpin = new WeakMap();   // el -> {rx, ry} 累计角度：下一次接着这个角度继续转，不会倒回去

function dieBox(el){ return el.firstElementChild; }

function paintDie(el, rx, ry){
  dieBox(el).style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
}

function setDie(el, n){
  const [rx, ry] = ANGLE_OF[n] || ANGLE_OF[1];
  dieSpin.set(el, { rx, ry });
  const box = dieBox(el);
  if (!box) return;
  const keep = box.style.transition;
  box.style.transition = 'none';    // 初始化/读档时直接就位，不要慢慢转过去
  paintDie(el, rx, ry);
  void box.offsetWidth;
  box.style.transition = keep;
}

// 一次翻滚 = 一次 CSS transition（合成器跑，60fps 稳），落地角度正好是目标面。
// 旧做法是每 80ms 硬切 6 个离散姿态、又没有中间帧，视觉上等于频闪，所以"看着不舒服"。
function spinDie(el, n, dur = 880, delay = 0){
  const [trx, tryA] = ANGLE_OF[n] || ANGLE_OF[1];
  const cur = dieSpin.get(el) || { rx: 0, ry: 0 };
  // 终点 = 目标角度 + 若干个整圈：既不会停在半路，又保证每次至少转两圈
  const rxEnd = trx + 360 * Math.ceil((cur.rx + 700 - trx) / 360);
  const ryEnd = tryA + 360 * Math.ceil((cur.ry + 520 - tryA) / 360);
  dieSpin.set(el, { rx: rxEnd, ry: ryEnd });

  const box = dieBox(el);
  el.classList.remove('rolling');
  void el.offsetWidth;                          // 重置抛起动画，让它能重复播放
  el.style.animationDelay = delay ? delay + 'ms' : '';
  el.classList.add('rolling');
  box.style.transition = `transform ${dur}ms cubic-bezier(.24,.62,.3,1) ${delay}ms`;
  void box.offsetWidth;                         // 先把起点提交下去，过渡才会真的跑起来
  paintDie(el, rxEnd, ryEnd);

  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      box.removeEventListener('transitionend', onEnd);
      el.classList.remove('rolling');
      box.style.transition = '';
      resolve();
    };
    const onEnd = e => { if (e.propertyName === 'transform') finish(); };
    box.addEventListener('transitionend', onEnd);
    setTimeout(finish, dur + delay + 160);      // 兜底：切到后台标签页时 transitionend 可能不来
  });
}

// 两颗骰子错开 70ms、时长不同，避免"齐步走"的机械感
async function spinDice(d1, d2){
  await Promise.all([
    spinDie($('die1'), d1, 860),
    spinDie($('die2'), d2, 940, 70),
  ]);
  lastRoll = d1 + d2;
  return [d1, d2];
}
function rollFace(){
  const d1 = 1 + Math.floor(Math.random()*6), d2 = 1 + Math.floor(Math.random()*6);
  return [d1, d2];
}

// ================= 经济 =================
function netWorth(p){
  return p.money + p.props.reduce((s, i) =>
    s + (tileMortgaged[i] ? Math.round(TILES[i].price * 0.5) : TILES[i].price + buildCost(i) * (tileLevel[i] || 0)), 0);
}
function ownsWholeGroup(pi, group){ return TILES.every((t, i) => t.type !== 'prop' || t.group !== group || tileOwner[i] === pi); }
function buildCost(i){
  const t = TILES[i];
  return t.type === 'prop' ? Math.round(t.price * 0.5) : 0;
}
function stationRent(ownerPi){
  const n = players[ownerPi].props.filter(i => TILES[i].type === 'station' && !tileMortgaged[i]).length;
  const R = [0, 100, 200, 400];
  return R[n] !== undefined ? R[n] : 400;   // 注意不能用 || 400：0 座时租金 0 会被假值吞掉
}

// ---- 均衡建设 & 抵押（经典规则） ----
function groupMates(i){
  const g = TILES[i].group;
  return TILES.map((t, k) => (t.type === 'prop' && t.group === g) ? k : -1).filter(k => k >= 0);
}
function mortgageValue(i){ return Math.round(TILES[i].price * 0.5); }
function unmortgageCost(i){ return Math.round(TILES[i].price * 0.55); }
// 均衡建设：必须集齐同组（垄断）才能加盖；目标地块须是组内等级最低的，且全组无抵押
function canBuildAt(pi, i){
  if (tileOwner[i] !== pi || (tileLevel[i] || 0) >= MAX_LEVEL) return false;
  if (players[pi].money < buildCost(i)) return false;
  if (!ownsWholeGroup(pi, TILES[i].group)) return false;   // 经典规则：垄断后才能建设
  const lv = tileLevel[i] || 0;
  return groupMates(i).every(j => tileOwner[j] !== pi || ((tileLevel[j] || 0) >= lv && !tileMortgaged[j]));
}
// 均衡拆除：只能拆同组（自己名下）等级最高的一栋
function canSellHouseAt(pi, i){
  if ((tileLevel[i] || 0) <= 0) return false;
  const lv = tileLevel[i];
  return groupMates(i).every(j => tileOwner[j] !== pi || (tileLevel[j] || 0) <= lv);
}
// 抵押：本组内所有建筑必须先拆光
function canMortgage(pi, i){
  return tileOwner[i] === pi && !tileMortgaged[i] &&
    groupMates(i).every(j => tileOwner[j] !== pi || (tileLevel[j] || 0) === 0);
}
function canUnmortgage(pi, i){
  return tileOwner[i] === pi && !!tileMortgaged[i] && players[pi].money >= unmortgageCost(i);
}

// 租金计算：默认只支持 prop/station；特殊公式由模块通过 rentOverrides 提供，
// 倍率类模块（组合）通过 rentFilters 叠加。
function rentOf(i){
  if (tileMortgaged[i]) return 0;   // 抵押中的地产不收租
  const t = TILES[i], owner = tileOwner[i];
  const ov = Game.rentOverrides[t.type];
  let r = ov ? ov(i)
    : t.type === 'station' ? stationRent(owner)
    : t.price * 0.1 * Math.pow(1.6, tileLevel[i] || 0) * (ownsWholeGroup(owner, t.group) ? 2 : 1);
  Game.rentFilters.forEach(f => { try { r = f(owner, i, t, r); } catch(e){} });
  return Math.round(r);
}

// 风险警戒线：所有存活对手的最高租金（至少 ¥120）。现金低于此线就有资不抵债风险
function riskLine(pi){
  let maxRent = 120;
  TILES.forEach((t, i) => {
    const o = tileOwner[i];
    if (o !== undefined && o !== pi && !players[o].bankrupt){
      try { maxRent = Math.max(maxRent, rentOf(i)); } catch(e){}
    }
  });
  return maxRent;
}

async function pay(from, to, amount, reason, silent = false){
  const p = players[from];
  // 免单钩子（保险模块用）：任何钩子返回 null 表示本次付款全额免除，返回值 0
  for (const f of Game.payWaivers){
    try {
      if (f(from, to, amount, reason) === null){
        log(`🛡️ ${players[from].name} 无需支付「${reason}」¥${amount}（由保险承担）`, 'good');
        return 0;
      }
    } catch(e){}
  }
  // AI 现金不够先变卖资产自救（卖房 → 卖地），避免无脑破产
  if (p.isAI && p.money < amount) aiRaiseCash(from, amount);
  // 人类玩家付不起：弹出明确的破产警告再扣款
  if (!p.isAI && !p.bankrupt && p.money < amount && !silent){
    await showNotice(from, '💸 资不抵债警告',
      `${reason}需支付 ¥${amount}，但你只有 ¥${p.money}！支付后将破产出局。`);
  }
  players[from].money -= amount;
  if (to !== null) players[to].money += amount;
  floatMoney(from, -amount);
  if (to !== null) floatMoney(to, amount);
  log(`${players[from].name} ${reason} ¥${amount}`, 'bad');
  renderPlayers();
  checkBankrupt(from, to);
  return amount;   // 返回实扣金额：入奖池的款项应以实际扣除数为准（保险免单时不入池）
}

function checkBankrupt(pi, creditor = null){
  const p = players[pi];
  if (p.money >= 0 || p.bankrupt) return;
  p.bankrupt = true;
  // 破产清算：全部地产（连房屋）与剩余现金移交债主；无债主则回归无主、建筑拆除
  const inherit = creditor !== null && creditor !== pi && !players[creditor].bankrupt;
  if (inherit){
    p.props.forEach(i => { tileOwner[i] = creditor; refreshTile(i); });
    if (p.money > 0){ players[creditor].money += p.money; floatMoney(creditor, p.money); p.money = 0; }
    log(`📦 ${p.name} 名下 ${p.props.length} 处地产及剩余现金全部移交 ${players[creditor].name}`, 'bad');
  } else {
    p.props.forEach(i => {
      delete tileOwner[i];
      tileLevel[i] = 0;
      delete tileMortgaged[i];
      refreshTile(i);
    });
  }
  p.props = [];
  log(`💥 ${p.name} 破产出局！`, 'bad');
  positionTokens();
  renderPlayers();
  if (players.filter(x => !x.bankrupt).length <= 1){ endGame(); return; }
  // 单机模式：玩家本人一旦破产，对局立即结束（AI 之间继续没有意义）
  if (GAME_MODE === 'ai' && players[0].bankrupt) endGame();
}

// ================= 建房 / 变卖 / 抵押 =================
// 均衡建设：垄断组内必须 1-1-1 → 2-2-2 → 3-3-3（canBuildAt 内部校验）
function buildProperty(pi, i){
  if (!canBuildAt(pi, i)) return false;
  const cost = buildCost(i);
  players[pi].money -= cost;
  tileLevel[i] = (tileLevel[i] || 0) + 1;
  log(`🏗️ ${players[pi].name} 花费 ¥${cost} 将「${TILES[i].name}」升级为${LEVEL_NAME[tileLevel[i]]}`, 'good');
  floatMoney(pi, -cost);
  refreshTile(i);
  flashTile(i);
  renderPlayers();
  return true;
}

// 出售：卖房每级退地价 25%；无房时可半价卖地给银行
function houseRefund(i){ return Math.round(TILES[i].price * 0.25); }
function landRefund(i){ return Math.round(TILES[i].price * 0.5); }

function sellHouseLevel(pi, i){
  const p = players[pi];
  if (!canSellHouseAt(pi, i)) return false;
  tileLevel[i]--;
  const amt = houseRefund(i);
  p.money += amt;
  floatMoney(pi, amt);
  log(`💸 ${p.name} 拆卖「${TILES[i].name}」一级建筑，回收 ¥${amt}`, 'good');
  refreshTile(i); renderPlayers();
  return true;
}

function sellLand(pi, i){
  const p = players[pi];
  if (tileOwner[i] !== pi || (tileLevel[i] || 0) > 0 || tileMortgaged[i]) return false;
  delete tileOwner[i];
  p.props = p.props.filter(x => x !== i);
  const amt = landRefund(i);
  p.money += amt;
  floatMoney(pi, amt);
  log(`💸 ${p.name} 以半价把「${TILES[i].name}」卖回银行，回收 ¥${amt}`, 'good');
  refreshTile(i); renderPlayers();
  return true;
}

// 抵押：拿半价套现，地产仍在名下但收租为 0、不能加盖；赎回付抵押价 + 10% 利息
function mortgageTile(pi, i){
  const p = players[pi];
  if (!canMortgage(pi, i)) return false;
  tileMortgaged[i] = true;
  const amt = mortgageValue(i);
  p.money += amt;
  floatMoney(pi, amt);
  log(`🏦 ${p.name} 把「${TILES[i].name}」抵押给银行，套现 ¥${amt}（赎回需 ¥${unmortgageCost(i)}）`, 'card');
  refreshTile(i); renderPlayers();
  return true;
}

function unmortgageTile(pi, i){
  const p = players[pi];
  if (!canUnmortgage(pi, i)) return false;
  tileMortgaged[i] = false;
  delete tileMortgaged[i];
  const cost = unmortgageCost(i);
  p.money -= cost;
  floatMoney(pi, -cost);
  log(`🏦 ${p.name} 花 ¥${cost}（含 10% 利息）赎回了「${TILES[i].name}」`, 'good');
  refreshTile(i); renderPlayers();
  return true;
}

// AI 破产边缘自救：拆房（从最高一栋拆，过均衡校验）→ 抵押地产 → 半价卖地（最后手段）
function aiRaiseCash(pi, need){
  const p = players[pi];
  let guard = 60;
  while (p.money < need && guard-- > 0){
    const houses = p.props.filter(i => canSellHouseAt(pi, i))
      .sort((a, b) => (tileLevel[b] || 0) - (tileLevel[a] || 0) || TILES[a].price - TILES[b].price);
    if (houses.length && sellHouseLevel(pi, houses[0])) continue;
    const mts = p.props.filter(i => canMortgage(pi, i))
      .sort((a, b) => TILES[a].price - TILES[b].price);
    if (mts.length && mortgageTile(pi, mts[0])) continue;
    const lands = p.props.filter(i => TILES[i].type === 'prop' && (tileLevel[i] || 0) === 0 && !tileMortgaged[i])
      .sort((a, b) => TILES[a].price - TILES[b].price);
    if (lands.length && sellLand(pi, lands[0])) continue;
    break;
  }
}

// AI 有闲钱时优先赎回抵押地产（恢复收租能力）
function aiMaybeUnmortgage(pi){
  const p = players[pi];
  const cands = p.props.filter(i => tileMortgaged[i] && p.money >= unmortgageCost(i) + 300)
    .sort((a, b) => TILES[b].price - TILES[a].price);
  if (cands.length) unmortgageTile(pi, cands[0]);
}

// ================= 资产管理弹窗 =================
function updateBuildBtn(){
  const btn = $('buildBtn');
  if (!btn) return;
  const p = players[turn];
  const canAct = !gameOver && !busy && p && !p.isAI && !p.bankrupt;
  const cands = p ? p.props.filter(i => TILES[i].type === 'prop' && canBuildAt(turn, i)) : [];
  const hasAssets = p && p.props.length > 0;   // 有资产就能进弹窗（抵押/赎回/卖房也算操作）
  btn.disabled = !canAct || (!cands.length && !hasAssets);
  btn.textContent = '🏗️ 资产管理';
}

function openBuildModal(pi, onClose){
  const render = () => {
    const p = players[pi];
    const list = p.props.filter(i => TILES[i].type === 'prop')
      .sort((a, b) => TILES[a].price - TILES[b].price);
    const risk = riskLine(pi);
    $('modalCash').textContent = `当前现金 ¥${p.money}${p.money < risk ? `（低于警戒线 ¥${risk}，注意破产风险）` : ''}`;
    $('modalCash').style.color = p.money < risk ? '#A9605A' : '';
    if (!list.length){
      $('buildList').innerHTML = '<p style="font-size:13px;color:#9C9789">你还没有地产，先去圈地吧。</p>';
      return;
    }
    $('buildList').innerHTML = list.map(i => {
      const lv = tileLevel[i] || 0, cost = buildCost(i);
      const mort = !!tileMortgaged[i];
      const mono = ownsWholeGroup(pi, TILES[i].group);
      const nowRent = mort ? 0 : Math.round(TILES[i].price * 0.1 * Math.pow(1.6, lv) * (mono ? 2 : 1));
      const nextRent = Math.round(TILES[i].price * 0.1 * Math.pow(1.6, lv + 1) * (mono ? 2 : 1));
      const matesLow = lv < MAX_LEVEL && groupMates(i).some(j => tileOwner[j] === pi && (tileLevel[j] || 0) < lv);
      const mateMort = groupMates(i).some(j => tileMortgaged[j]);
      let buildNote = '';
      if (mort) buildNote = ' <span style="color:#8B8779">🔒 抵押中，免收租</span>';
      else if (lv >= MAX_LEVEL) buildNote = '（已满级）';
      else if (!ownsWholeGroup(pi, TILES[i].group)) buildNote = ' <span style="color:#9A7442">⚠️ 需集齐同组地产（垄断）才能加盖</span>';
      else if (matesLow) buildNote = ' <span style="color:#9A7442">⚠️ 均衡建设：需先升级同组其他地块</span>';
      else if (mateMort) buildNote = ' <span style="color:#9A7442">⚠️ 同组有抵押地产，不能加盖</span>';
      const riskNote = !mort && lv < MAX_LEVEL && canBuildAt(pi, i) && p.money - cost < risk
        ? ` <span style="color:#A9605A">⚠️ 升级后仅剩 ¥${p.money - cost}，有资不抵债风险</span>` : '';
      const sellNote = lv > 0 && !canSellHouseAt(pi, i)
        ? ' <span style="color:#9A7442">⚠️ 均衡拆除：需先拆同组其他建筑</span>' : '';
      // 资产按钮：抵押中 → 赎回；有房 → 卖房；空地 → 抵押 + 卖地
      const assetBtns = mort
        ? `<button class="mtg" data-i="${i}" ${p.money < unmortgageCost(i) ? 'disabled' : ''}>赎回 ¥${unmortgageCost(i)}</button>`
        : lv > 0
          ? `<button class="sell" data-i="${i}" ${canSellHouseAt(pi, i) ? '' : 'disabled'}>卖房 +¥${houseRefund(i)}</button>`
          : `<button class="mtg" data-i="${i}">抵押 +¥${mortgageValue(i)}</button>
             <button class="sell" data-i="${i}">卖地 +¥${landRefund(i)}</button>`;
      return `<div class="build-row">
        <div class="meta"><b>${TILES[i].name}</b> · ${LEVEL_NAME[lv]}${mort ? '（抵押）' : ''}<br>
          租金 ¥${nowRent}${!mort && lv < MAX_LEVEL ? ` → ¥${nextRent}` : ''}　升级费 ¥${cost}${buildNote}${riskNote}${sellNote}</div>
        <div style="display:flex;gap:6px">
          ${assetBtns}
          <button data-i="${i}" ${mort || !canBuildAt(pi, i) ? 'disabled' : ''}>${lv >= MAX_LEVEL ? '已满级' : '升级'}</button>
        </div>
      </div>`;
    }).join('');
    $('buildList').querySelectorAll('button[data-i]').forEach(b => {
      b.onclick = () => {
        const i = +b.dataset.i;
        if (b.classList.contains('sell')){
          if ((tileLevel[i] || 0) > 0) sellHouseLevel(pi, i); else sellLand(pi, i);
        } else if (b.classList.contains('mtg')){
          if (tileMortgaged[i]) unmortgageTile(pi, i); else mortgageTile(pi, i);
        } else {
          buildProperty(pi, i);
        }
        render();
      };
    });
  };
  $('buildClose').onclick = () => { $('buildModal').classList.add('hidden'); updateBuildBtn(); if (onClose) onClose(); };
  render();
  $('buildModal').classList.remove('hidden');
}

// ================= 移动 =================
async function moveSteps(pi, steps, animate = true){
  const p = players[pi];
  for (let s = 0; s < steps; s++){
    p.pos = (p.pos + 1) % TILES.length;
    positionTokens();
    if (animate) await sleep(150);
    if (p.pos === 0){
      let salary = SALARY;
      Game.salaryFilters.forEach(f => { try { salary = f(pi, salary); } catch(e){} });
      p.money += salary;
      floatMoney(pi, salary);
      log(`${p.name} 经过起点，领取工资 ¥${salary}`, 'good');
      renderPlayers();
    }
  }
  const el = TOKENS[pi];
  if (el){ el.classList.add('hop'); setTimeout(() => el.classList.remove('hop'), 320); }
  renderPlayers();
  positionTokens();
}

async function teleportTo(pi, pos){
  players[pi].pos = pos;
  positionTokens();
  const el = TOKENS[pi];
  if (el){ el.classList.add('hop'); setTimeout(() => el.classList.remove('hop'), 320); }
  await sleep(250);
}

// ================= 落格结算 =================
// 可购买地块（prop/station 由核心处理；utility 等由模块复用此流程）
async function ownableLanding(pi, i){
  const p = players[pi], t = TILES[i];
  if (tileOwner[i] === undefined){
    if (p.isAI){
      await sleep(550);
      await aiBuy(pi, i);
    } else {
      const yes = await waitBuyChoice(i, pi);
      if (yes && p.money >= t.price){
        p.money -= t.price;
        p.props.push(i);
        tileOwner[i] = pi;
        floatMoney(pi, -t.price);
        log(`${p.name} 以 ¥${t.price} 买下了「${t.name}」`, 'good');
        refreshTile(i); renderPlayers();
      } else {
        log(`${p.name} 放弃了购买「${t.name}」`);
        await runAuction(i, pi);
      }
    }
  } else if (tileOwner[i] !== pi){
    const owner = tileOwner[i];
    const rent = rentOf(i);
    if (rent === 0){
      log(`🔒 「${t.name}」处于抵押中，本次免租`);
    } else {
      const why = Game.rentReason ? Game.rentReason(i, owner) : `向 ${players[owner].name} 支付「${t.name}」租金`;
      if (!p.isAI && p.money < rent){
        // 人类玩家付不起租金：先给「变卖凑钱 / 宣告破产」的选择
        const bust = await waitDebtChoice(rent, owner, why);
        if (bust){ await pay(pi, owner, rent, why, true); return; }
      }
      await pay(pi, owner, rent, why);
    }
  } else {
    log(`${p.name} 回到了自己的「${t.name}」`);
    if (t.type === 'prop' && p.isAI && !gameOver){
      aiMaybeUnmortgage(pi);
      Game.ai.build(pi, i);
    }
  }
}
Game.tileHandlers.prop = (pi, i) => ownableLanding(pi, i);
Game.tileHandlers.station = (pi, i) => ownableLanding(pi, i);

async function resolveLanding(pi, depth = 0){
  const p = players[pi];
  const i = p.pos, t = TILES[i];
  highlightTile(i, true);
  flashTile(i);
  positionTokens();

  const h = Game.tileHandlers[t.type];
  if (h){
    await h(pi, i, t, depth);
  } else {
    log(`🚶 ${p.name} 停在「${t.name}」歇脚`);   // 未装载对应模块：该地块无害无效果
  }

  renderPlayers();
  checkBankrupt(pi);
  if (players.every(x => x.bankrupt)) endGame();
  saveGame();
}

// ================= 拍卖（经典规则：放弃购买的地块由全体玩家竞价） =================
const BID_STEP = 10, MIN_BID = 10;

function aucHumanTurn(pi, highBid){
  return new Promise(resolve => {
    const base = Math.max(highBid + BID_STEP, MIN_BID);
    const p = players[pi];
    $('aucB10').textContent = `出价 ¥${base}`;
    $('aucB50').textContent = `加价 ¥50（至 ¥${highBid + 50}）`;
    $('aucB100').textContent = `加价 ¥100（至 ¥${highBid + 100}）`;
    $('aucB10').disabled = base > p.money;
    $('aucB50').disabled = highBid + 50 > p.money;
    $('aucB100').disabled = highBid + 100 > p.money;
    $('aucPass').disabled = false;
    const done = v => {
      ['aucB10','aucB50','aucB100','aucPass'].forEach(id => $(id).onclick = null);
      resolve(v);
    };
    $('aucB10').onclick = () => done(base);
    $('aucB50').onclick = () => done(highBid + 50);
    $('aucB100').onclick = () => done(highBid + 100);
    $('aucPass').onclick = () => done(null);
  });
}

async function runAuction(i, lander){
  const t = TILES[i];
  let remaining = players.map((p, pi) => p.bankrupt ? null : pi).filter(x => x !== null);
  if (remaining.length < 2){ log(`🔨 场上可竞拍玩家不足，「${t.name}」流拍`); return; }
  let highBid = 0, leader = null;
  let pos = Math.max(0, remaining.indexOf(lander));
  $('aucTitle').textContent = `🔨 拍卖「${t.name}」`;
  $('auctionModal').classList.remove('hidden');
  log(`🔨 「${t.name}」（标价 ¥${t.price}）无人购买，进入全体拍卖！`, 'card');

  while (true){
    if (remaining.length === 0) break;                                             // 全体弃拍 → 流拍
    if (leader !== null && remaining.length === 1 && remaining[0] === leader) break; // 只剩领先者 → 成交
    const pi = remaining[pos % remaining.length];
    $('aucInfo').innerHTML =
      `标价 ¥${t.price}　当前最高：<b>${leader === null ? '暂无出价' : `¥${highBid}（${players[leader].name}）`}</b><br>` +
      `<span style="font-size:12px;color:#9C9789">仍在竞拍：${remaining.map(x => players[x].name).join('、')}</span>`;
    $('aucCur').textContent = `轮到 ${players[pi].name}（现金 ¥${players[pi].money}）`;

    let bid = null;
    if (players[pi].isAI){
      ['aucB10','aucB50','aucB100','aucPass'].forEach(id => $(id).disabled = true);
      $('aucCur').textContent = `${players[pi].name} 思考中…`;
      await sleep(650 + Math.random()*450);
      const cap = Game.ai.bidValue ? Game.ai.bidValue(pi, i) : Math.min(Math.round(t.price * 0.6), players[pi].money - 100);
      if (highBid === 0){
        const open = Math.max(MIN_BID, Math.round(t.price * 0.3 / BID_STEP) * BID_STEP);
        if (cap >= open) bid = open;
      } else {
        const next = highBid + BID_STEP;
        if (cap >= next && Math.random() < 0.75) bid = next;   // 75% 概率跟进
      }
    } else {
      bid = await aucHumanTurn(pi, highBid);
    }

    if (bid === null){
      log(`🔨 ${players[pi].name} 弃拍`);
      remaining.splice(pos % remaining.length, 1);
      if (pos >= remaining.length) pos = 0;
    } else {
      highBid = bid; leader = pi;
      log(`🔨 ${players[pi].name} 出价 ¥${bid}`);
      pos++;
    }
  }
  $('auctionModal').classList.add('hidden');

  if (leader === null){
    log(`🔨 「${t.name}」无人出价，流拍，保持无主状态`);
    saveGame();
    return;
  }
  const w = players[leader];
  w.money -= highBid;
  w.props.push(i);
  tileOwner[i] = leader;
  floatMoney(leader, -highBid);
  log(`🔨 ${w.name} 以 ¥${highBid} 拍得「${t.name}」！`, 'good');
  refreshTile(i);
  renderPlayers();
  saveGame();
}

// ================= 弹窗交互 =================
function waitBuyChoice(i, pi){
  return new Promise(resolve => {
    const t = TILES[i], p = players[pi];
    const rentNote = Game.rentNote ? Game.rentNote(i) : `基础租金 ¥${Math.round(t.price*0.1)}`;
    const remain = p.money - t.price;
    $('buyTitle').textContent = `购买「${t.name}」？`;
    let warn = '';
    if (remain < 0){
      $('buyYes').disabled = true;
      $('buyYes').textContent = '现金不足';
      warn = '<div class="risk-warn">⛔ 买下会立刻扣成负数并破产出局，不能购买！</div>';
    } else {
      $('buyYes').disabled = false;
      $('buyYes').textContent = '买下它';
      const risk = riskLine(pi);
      if (remain < risk){
        warn = `<div class="risk-warn">⚠️ 买下后仅剩 ¥${remain}，低于对手最高租金（¥${risk}），随时可能资不抵债！</div>`;
      } else if (remain < risk * 2){
        warn = `<div class="risk-warn soft">🟡 买下后剩余 ¥${remain}，建议留足现金防高额租金。</div>`;
      }
    }
    $('buyDesc').innerHTML = `${p.name}：价格 ¥${t.price}，${rentNote}。买下后剩余 <b>¥${remain}</b>。${warn}`;
    $('buyModal').classList.remove('hidden');
    $('buyYes').onclick = () => { $('buyModal').classList.add('hidden'); resolve(true); };
    $('buyNo').onclick  = () => { $('buyModal').classList.add('hidden'); resolve(false); };
  });
}

// 资不抵债抉择：变卖资产凑钱（循环直到够），或宣告破产（返回 true）
function waitDebtChoice(rent, owner, why){
  return new Promise(resolve => {
    const render = () => {
      $('debtDesc').innerHTML =
        `${why}需支付 <b style="color:#A9605A">¥${rent}</b>，但现金只有 <b>¥${players[turn].money}</b>。` +
        `<br><span style="font-size:12px;color:#9C9789">变卖资产凑够钱，或宣告破产——名下地产与剩余现金将全部移交 ${players[owner].name}。</span>`;
      $('debtModal').classList.remove('hidden');
    };
    $('debtSell').onclick = () => {
      $('debtModal').classList.add('hidden');
      openBuildModal(turn, () => {
        if (players[turn].money >= rent) resolve(false);
        else render();
      });
    };
    $('debtBust').onclick = () => {
      $('debtModal').classList.add('hidden');
      log(`🚫 ${players[turn].name} 宣告破产`, 'bad');
      resolve(true);
    };
    render();
  });
}
function waitCardOk(){
  return new Promise(resolve => {
    $('cardOk').onclick = () => { $('cardModal').classList.add('hidden'); resolve(); };
  });
}
function showNotice(pi, title, text){
  return new Promise(resolve => {
    $('noticeTitle').textContent = title;
    $('noticeDesc').textContent = text;
    $('noticeModal').classList.remove('hidden');
    const done = () => { $('noticeModal').classList.add('hidden'); resolve(); };
    if (players[pi].isAI){ setTimeout(done, 1500); }
    else { $('noticeOk').onclick = done; }
  });
}

// ================= 监狱（经典规则：保释 / 双数出狱 / 3 回合上限 / 免狱卡） =================
const BAIL = 50;   // 保释金（入奖池，见 payBail）
function payBail(pi, why){
  if (Game.poolApi) Game.poolApi.add(BAIL);   // 保释金进奖池，落「免费停车」可卷走
  return pay(pi, null, BAIL, why);
}

// 入狱统一入口：自动使用免狱卡，否则蹲监 3 回合
async function sendToJail(pi, reason){
  const p = players[pi];
  await teleportTo(pi, CORNER_IDX[1]);
  positionTokens();
  if (p.jailCard > 0){
    p.jailCard--;
    log(`🎟️ ${p.name} 出示「出狱许可证」，免于入狱！`, 'good');
    await showNotice(pi, '🎟️ 出狱许可证', `${p.name} 使用了出狱许可证，免于入狱！`);
    renderPlayers();
    return;
  }
  p.jail = 3;
  log(`⛓️ ${p.name} ${reason}，入狱（可保释 / 掷双数出狱，最多蹲 3 回合）`, 'bad');
  renderPlayers();
}

function waitJailChoice(pi){
  const p = players[pi];
  return new Promise(resolve => {
    $('jailTitle').textContent = '⛓️ 你在监狱中';
    $('jailDesc').innerHTML = `这是你第 <b>${4 - p.jail}</b> 次尝试（最多 3 次）。<br>` +
      `选择：<b>缴纳保释金 ¥${BAIL}</b> 立即出狱正常行动；或<b>掷骰碰双数</b>——掷出双数免费出狱并按点数前进，失败则继续蹲监（第 3 次失败将强制缴纳保释金）。` +
      (p.money < BAIL ? `<div class="risk-warn">⚠️ 现金不足 ¥${BAIL}，只能赌双数（若第 3 次失败将变卖资产抵扣）。</div>` : '');
    $('jailModal').classList.remove('hidden');
    $('jailBail').disabled = p.money < BAIL;
    $('jailBail').onclick = () => { $('jailModal').classList.add('hidden'); resolve('bail'); };
    $('jailRoll').onclick = () => { $('jailModal').classList.add('hidden'); resolve('roll'); };
  });
}

async function rollAnim(){
  const [d1, d2] = rollFace();
  await spinDice(d1, d2);
  return [d1, d2];
}

async function bailAndRoll(pi){
  const p = players[pi];
  await payBail(pi, '缴纳保释金');
  if (gameOver || p.bankrupt){ busy = false; if (!gameOver) nextStep(false); return; }
  p.jail = 0;
  log(`🔓 ${p.name} 缴纳保释金 ¥${BAIL}，出狱！`, 'good');
  renderPlayers();
  busy = false;
  rollDice();   // 正常掷骰行动（由 rollDice 收尾并交棒下一位）
}

async function tryJailRoll(pi){
  const p = players[pi];
  const [d1, d2] = await rollAnim();
  log(`🎲 ${p.name} 狱中掷出 ${d1} + ${d2}${d1 === d2 ? '（双数！）' : ''}`);
  if (d1 === d2){
    p.jail = 0;
    log(`🔓 ${p.name} 掷出双数，出狱并前进！`, 'good');
    await moveSteps(pi, d1 + d2);
    await sleep(180);
    await resolveLanding(pi);
    busy = false;
    if (!gameOver) nextStep(false);
    return;
  }
  p.jail--;
  if (p.jail > 0){
    log(`⛓️ ${p.name} 未掷出双数，继续蹲监（还剩 ${p.jail} 次机会）`, 'bad');
    renderPlayers();
    saveGame();
    busy = false;
    nextStep(false);
    return;
  }
  // 第 3 次失败：强制缴纳保释金，并按本次点数出狱移动
  log(`⛓️ ${p.name} 三次都未掷出双数，强制缴纳保释金 ¥${BAIL} 出狱`, 'bad');
  await payBail(pi, '缴纳强制保释金');
  if (gameOver || p.bankrupt){ busy = false; if (!gameOver) nextStep(false); return; }
  await moveSteps(pi, d1 + d2);
  await sleep(180);
  await resolveLanding(pi);
  busy = false;
  if (!gameOver) nextStep(false);
}

async function handleJailTurn(pi){
  const p = players[pi];
  if (p.isAI){
    await sleep(700);
    const policy = Game.ai.jailPolicy ? Game.ai.jailPolicy(pi) : (p.money >= 300 ? 'bail' : 'roll');
    if (policy === 'bail') await bailAndRoll(pi);
    else await tryJailRoll(pi);
  } else {
    const choice = await waitJailChoice(pi);
    if (choice === 'bail') await bailAndRoll(pi);
    else await tryJailRoll(pi);
  }
}

// ================= 回合驱动 =================
async function rollDice(){
  if (busy || gameOver) return;
  busy = true;
  $('rollBtn').disabled = true;
  updateBuildBtn();
  const p = players[turn];

  const [d1, d2] = await spinDice(...rollFace());
  log(`🎲 ${p.name} 掷出 ${d1} + ${d2} = ${d1+d2}${d1===d2 ? '（双数，再来一次）' : ''}`);

  await moveSteps(turn, d1 + d2);
  await sleep(180);
  await resolveLanding(turn);

  if (gameOver){ busy = false; return; }

  if (d1 === d2 && !p.bankrupt){
    doubleStreak++;
    if (doubleStreak >= 3){
      // 连续三次双数：超速行驶，直接押送监狱
      doubleStreak = 0;
      log(`🚔 ${p.name} 连续三次掷出双数，超速被扣，押送监狱！`, 'bad');
      await showNotice(turn, '🚔 超速拘捕', `${p.name} 连续三次掷出双数，因超速被押送监狱！`);
      await sendToJail(turn, '连续超速');
      busy = false;
      nextStep(false);
      return;
    }
    $('turnInfo').textContent = `${p.name} 掷出双数，继续行动`;
    await sleep(600);
    busy = false;
    nextStep(true);
    return;
  }
  doubleStreak = 0;
  busy = false;
  nextStep(false);
}

function nextStep(samePlayer){
  if (gameOver) return;
  if (!samePlayer){
    doubleStreak = 0;   // 轮到下一位玩家，双数连击计数清零
    if (turn === players.length - 1){
      turn = 0; round++;
      updateRound();
      Game.onRound.forEach(f => { try { f(round); } catch(e){} });   // 统计面板在此做每回合快照
      if (round > MAX_ROUNDS){ endGame(); return; }
    } else turn++;
  }
  const p = players[turn];
  if (p.bankrupt){ nextStep(false); return; }
  if (p.jail > 0){
    busy = true;
    updateBuildBtn();
    handleJailTurn(turn);
    return;
  }
  saveGame();
  renderPlayers();
  $('turnInfo').textContent = p.isAI ? `${p.name} 思考中…` : `轮到 ${p.name} 行动`;
  if (p.isAI){
    busy = true;
    updateBuildBtn();
    setTimeout(() => { busy = false; rollDice(); }, 800);
  } else {
    $('rollBtn').disabled = false;
    updateBuildBtn();
  }
}

// ================= 结束 =================
function endGame(){
  if (gameOver) return;
  gameOver = true;
  clearSave();
  const alive = players.map((p, i) => p.bankrupt ? null : i).filter(i => i !== null);
  let title, desc;
  if (GAME_MODE === 'ai' && players[0].bankrupt && alive.length >= 1){
    // 单机模式下玩家本人破产出局
    const winner = alive.sort((a, b) => netWorth(players[b]) - netWorth(players[a]))[0];
    title = `${players[winner].name} 获胜！`;
    desc = '很遗憾，你已破产出局，本局结束。';
  } else if (alive.length === 1){
    title = `${players[alive[0]].name} 获胜！`;
    desc = `对手全部破产出局，总资产 ¥${netWorth(players[alive[0]])}。`;
  } else {
    const sorted = [...players.keys()].sort((a, b) => netWorth(players[b]) - netWorth(players[a]));
    title = sorted[0] === 0 ? '期限已到，你赢了！' : `期限已到，${players[sorted[0]].name} 获胜`;
    desc = players.map((p, i) => `${p.name} ¥${netWorth(p)}`).join('　|　');
  }
  $('goTitle').textContent = '🏆 ' + title;
  $('goDesc').textContent = desc;
  $('gameOverModal').classList.remove('hidden');
  updateBuildBtn();
  confetti();
}

function confetti(){
  const colors = ['#8E86A0','#B08968','#B5806F','#8FA6B8','#98A99B'];
  for (let k = 0; k < 40; k++){
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random()*100 + 'vw';
    c.style.background = colors[k % colors.length];
    c.style.animationDuration = (2 + Math.random()*1.8) + 's';
    c.style.animationDelay = (Math.random()*0.6) + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 4200);
  }
}

// ================= AI（核心默认策略：普通水平） =================
// 难度系统由 ai-diff 模块整体替换 Game.ai；模块关闭时用这最朴素的一版
Game.ai = {
  wantsBuy(pi, i){ return players[pi].money >= TILES[i].price; },
  build(pi, preferIdx){
    const p = players[pi];
    aiMaybeUnmortgage(pi);
    // 均衡建设：只在 canBuildAt 允许的地块上加盖，优先垄断组、再挑等级最低的地
    const cands = p.props.filter(i => TILES[i].type === 'prop' && canBuildAt(pi, i) && p.money - buildCost(i) >= 400);
    if (!cands.length) return;
    const target = cands.includes(preferIdx) ? preferIdx : cands.sort((a, b) => {
      const ma = ownsWholeGroup(pi, TILES[a].group) ? 1 : 0, mb = ownsWholeGroup(pi, TILES[b].group) ? 1 : 0;
      return mb - ma || (tileLevel[a] || 0) - (tileLevel[b] || 0) || TILES[a].price - TILES[b].price;
    })[0];
    buildProperty(pi, target);
  },
};

async function aiBuy(pi, i){
  const p = players[pi], t = TILES[i];
  if (!Game.ai.wantsBuy(pi, i)){
    log(`${p.name} 放弃购买「${t.name}」`);
    await runAuction(i, pi);
    return;
  }
  p.money -= t.price;
  p.props.push(i);
  tileOwner[i] = pi;
  floatMoney(pi, -t.price);
  log(`${p.name} 以 ¥${t.price} 买下了「${t.name}」`, 'good');
  refreshTile(i); renderPlayers();
}
