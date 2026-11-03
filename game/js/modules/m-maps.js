// ================================================================
// 模块：多地图 + 随机岛屿（m-maps）
// 提供迷你快棋 / 经典小城 / 繁华都会 三张预设图和每局随机的随机岛屿。
// 模块关闭时核心自动使用内置的「经典小城」。
// ================================================================
Game.use('maps', () => {
  const PROP_NAMES = ['樱花大道','甜心小巷','阳光公寓','码头仓库','海风旅馆','灯塔广场','中心百货','天际大厦','金融街','科技园','电视塔','王朝酒店','翡翠湾','月光湾','梧桐街区','云顶花园','琥珀庄园','风车小镇','玫瑰大道','银滩别墅','青石板巷','星光码头','凤凰城','紫藤花苑'];
  const STATION_NAMES = ['中央车站','地铁2号线','机场快线','港口码头'];
  const GROUP_LETTERS = ['A','B','C','D','E'];

  const MAP_PRESETS = {
    mini: { id:'mini', name:'迷你快棋', desc:'20 格 · 4 组地产 · 15 分局',
      tiles: [
        { type:'go',      name:'起点' },
        { type:'prop',    name:'樱花大道', group:'A', price:600 },
        { type:'utility', name:'电力公司', price:700 },
        { type:'chance',  name:'机会' },
        { type:'prop',    name:'甜心小巷', group:'A', price:600 },
        { type:'jail',    name:'监狱' },
        { type:'prop',    name:'码头仓库', group:'B', price:800 },
        { type:'casino',  name:'幸运赌场' },
        { type:'prop',    name:'海风旅馆', group:'B', price:800 },
        { type:'parking', name:'免费停车' },
        { type:'prop',    name:'中心百货', group:'C', price:1000 },
        { type:'police',  name:'交警临检' },
        { type:'prop',    name:'天际大厦', group:'C', price:1000 },
        { type:'auction', name:'拍卖行', emoji:'🔨' },
        { type:'station', name:'中央车站', price:800 },
        { type:'prop',    name:'金融街',   group:'C', price:1100 },
        { type:'bonus',   name:'奖励格' },
        { type:'prop',    name:'科技园',   group:'D', price:1200 },
        { type:'insurance', name:'保险代理', emoji:'🛡️' },
        { type:'prop',    name:'王朝酒店', group:'D', price:1400 },
      ]},
    classic: { id:'classic', name:'经典小城', desc:'24 格 · 4 组地产 · 25 分局',
      tiles: [
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
        { type:'auction', name:'拍卖行', emoji:'🔨' },
        { type:'prop',    name:'灯塔广场', group:'B', price:900 },
        { type:'parking', name:'免费停车' },
        { type:'prop',    name:'中心百货', group:'C', price:1000 },
        { type:'station', name:'地铁2号线', price:800 },
        { type:'prop',    name:'天际大厦', group:'C', price:1000 },
        { type:'chance',  name:'机会' },
        { type:'prop',    name:'金融街', group:'C', price:1100 },
        { type:'bonus',   name:'奖励格' },
        { type:'prop',    name:'科技园', group:'D', price:1200 },
        { type:'insurance', name:'保险代理', emoji:'🛡️' },
        { type:'prop',    name:'电视塔', group:'D', price:1200 },
        { type:'station', name:'机场快线', price:800 },
        { type:'prop',    name:'王朝酒店', group:'D', price:1400 },
      ]},
    metro: { id:'metro', name:'繁华都会', desc:'32 格 · 5 组地产 · 完全体',
      tiles: [
        { type:'go',      name:'起点' },
        { type:'prop',    name:'樱花大道', group:'A', price:600 },
        { type:'chance',  name:'机会' },
        { type:'prop',    name:'甜心小巷', group:'A', price:650 },
        { type:'station', name:'中央车站', price:800 },
        { type:'prop',    name:'阳光公寓', group:'A', price:700 },
        { type:'utility', name:'电力公司', price:750 },
        { type:'tax',     name:'税收' },
        { type:'jail',    name:'监狱' },
        { type:'prop',    name:'码头仓库', group:'B', price:800 },
        { type:'prop',    name:'海风旅馆', group:'B', price:800 },
        { type:'station', name:'地铁2号线', price:800 },
        { type:'chance',  name:'机会' },
        { type:'prop',    name:'灯塔广场', group:'B', price:900 },
        { type:'utility', name:'自来水厂', price:750 },
        { type:'casino',  name:'幸运赌场' },
        { type:'parking', name:'免费停车' },
        { type:'prop',    name:'中心百货', group:'C', price:1000 },
        { type:'police',  name:'交警临检' },
        { type:'prop',    name:'天际大厦', group:'C', price:1000 },
        { type:'auction', name:'拍卖行', emoji:'🔨' },
        { type:'prop',    name:'金融街',   group:'C', price:1100 },
        { type:'bonus',   name:'奖励格' },
        { type:'prop',    name:'科技园',   group:'D', price:1200 },
        { type:'insurance', name:'保险代理', emoji:'🛡️' },
        { type:'prop',    name:'电视塔',   group:'D', price:1200 },
        { type:'station', name:'机场快线', price:800 },
        { type:'prop',    name:'王朝酒店', group:'D', price:1400 },
        { type:'casino',  name:'幸运赌场' },
        { type:'prop',    name:'翡翠湾',   group:'E', price:1500 },
        { type:'chance',  name:'机会' },
        { type:'prop',    name:'紫藤花苑', group:'E', price:1600 },
      ]},
  };

  // 随机岛屿：种子化生成——同一 mseed 必出同一张图（分享码玩法）。
  // 种子只接管地图生成，对局内的骰子/事件卡仍走全局 Math.random，互不影响。
  function mulberry32(a){
    return function(){
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function genRandomMap(){
    const seedQS = parseInt(new URLSearchParams(location.search).get('mseed'), 10);
    const shared = Number.isFinite(seedQS) && seedQS > 0;
    const seed = shared ? seedQS : 10000 + Math.floor(Math.random() * 90000);   // 每局现摇一个 5 位分享码
    const R = mulberry32(seed);
    const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--){ const j = Math.floor(R() * (i + 1)); const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp; } return arr; };
    const EDGE = [4, 5, 6, 7][Math.floor(R()*4)];   // 20/24/28/32 格
    const TOTAL = (EDGE + 1) * 4;
    const groups = GROUP_LETTERS.slice(0, Math.min(5, Math.max(3, Math.round(TOTAL / 8))));
    const names = shuffle([...PROP_NAMES]);
    const stations = shuffle([...STATION_NAMES]);
    const tiles = new Array(TOTAL);
    tiles[0] = { type:'go', name:'起点' };
    tiles[EDGE + 1] = { type:'jail', name:'监狱' };
    tiles[2 * (EDGE + 1)] = { type:'parking', name:'免费停车' };
    tiles[3 * (EDGE + 1)] = { type:'bonus', name:'奖励格' };
    const corners = [0, EDGE + 1, 2 * (EDGE + 1), 3 * (EDGE + 1)];

    // 边上的格子：约 6 成为地产，剩余分给机会/车站/税/电站/赌场/交警
    const edgeIdx = [];
    for (let i = 1; i < TOTAL; i++) if (!corners.includes(i)) edgeIdx.push(i);
    const specials = [];
    const nStation = Math.min(2, Math.floor(edgeIdx.length * 0.12) + 1);
    for (let k = 0; k < nStation; k++) specials.push({ type:'station', name:stations[k], price:800 });
    specials.push({ type:'chance', name:'机会' });
    if (TOTAL >= 24) specials.push({ type:'chance', name:'机会' });
    specials.push({ type:'tax', name:'税收' });
    if (TOTAL >= 24){ specials.push({ type:'utility', name:R() < 0.5 ? '电力公司' : '自来水厂', price:700 }); }
    if (TOTAL >= 28){ specials.push({ type:'utility', name:R() < 0.5 ? '电力公司' : '自来水厂', price:700 }); }
    const nCasino = TOTAL >= 28 ? 2 : 1;
    for (let k = 0; k < nCasino; k++) specials.push({ type:'casino', name:'幸运赌场' });
    const nPolice = Math.max(1, Math.floor(TOTAL / 28));
    for (let k = 0; k < nPolice; k++) specials.push({ type:'police', name:'交警临检' });
    if (TOTAL >= 24){
      specials.push({ type:'insurance', name:'保险代理', emoji:'🛡️' });
      specials.push({ type:'auction',   name:'拍卖行',   emoji:'🔨' });
    }

    const nProps = edgeIdx.length - specials.length;
    const perGroup = Math.floor(nProps / groups.length);
    const propTiles = [];
    groups.forEach((g, gi) => {
      const cnt = gi === groups.length - 1 ? nProps - perGroup * (groups.length - 1) : perGroup;
      const base = 600 + gi * 200;
      for (let k = 0; k < cnt; k++) propTiles.push({ type:'prop', name:names.pop(), group:g, price:base + k * 50 });
    });

    const bag = shuffle([...propTiles, ...specials]);
    let bi = 0;
    edgeIdx.forEach(i => { tiles[i] = bag[bi++]; });
    log(`🗺️ 随机岛屿分享码：${seed}${shared ? '（来自分享）' : '——大厅「随机岛屿」旁输入它，可复现同一张图'}`, 'card');
    return { id:'random', name:`随机岛屿 #${seed}`, tiles };
  }

  // ---- 自定义地图（地图编辑器产出）：URL 传 mc=分享码，或 mid=本机存图 id ----
  // 分享码 = URL 安全 base64(JSON)。解码逻辑在 lobby/js/editor.js 有一份对应的编码侧；
  // 两边刻意不共享文件（编辑器不加载游戏模块），改动时记得同步。
  function decodeMapCode(code){
    try {
      let s = String(code || '').trim().replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      const obj = JSON.parse(decodeURIComponent(escape(atob(s))));
      if (!obj || !Array.isArray(obj.tiles) || obj.tiles.length < 10 || obj.tiles.length > 64) return null;
      const T = ['go','prop','station','utility','chance','tax','jail','parking','bonus','casino','police','insurance','auction'];
      if (!obj.tiles.every(t => t && T.includes(t.type))) return null;
      if (!obj.tiles[0] || obj.tiles[0].type !== 'go') return null;   // 起点必须在第 0 格
      return obj;
    } catch(e){ return null; }
  }

  // 启动时决定用哪张地图：存档里的地图 > URL 参数 > 预设默认
  Game.beforeBoard.push(bootSave => {
    const qs = new URLSearchParams(location.search);
    const mapQS = qs.get('map');
    const sm = bootSave && bootSave.mods && bootSave.mods.maps;
    if (sm && sm.map && Array.isArray(sm.map.tiles)){
      Game.applyMap({ id: sm.map.id || 'random', name: sm.map.name || '随机岛屿', tiles: sm.map.tiles });
    } else if (mapQS === 'custom'){
      const mc = qs.get('mc'), mid = qs.get('mid');
      let cm = null;
      if (mc){
        const decoded = decodeMapCode(mc);
        if (decoded) cm = { name: decoded.name || '自定义地图', tiles: decoded.tiles };
      } else if (mid){
        try {
          const store = JSON.parse(localStorage.getItem('cm_custom_maps') || '{}');
          const m = store[mid];
          if (m && Array.isArray(m.tiles)) cm = { name: m.name || '自定义地图', tiles: m.tiles };
        } catch(e){}
      }
      if (cm) Game.applyMap({ id: 'custom', name: cm.name, tiles: cm.tiles });
      else {
        log('⚠️ 自定义地图加载失败（分享码无效或本机地图已删），已回退经典小城', 'bad');
        Game.applyMap(MAP_PRESETS.classic);
      }
    } else {
      Game.applyMap(MAP_PRESETS[mapQS] || MAP_PRESETS.classic);
    }
  });

  Game.saveExtras.push(() => ({ maps: { map: { id: MAP.id, name: MAP.name, tiles: MAP.tiles } } }));
});
