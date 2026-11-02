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
        { type:'chance',  name:'机会' },
        { type:'station', name:'中央车站', price:800 },
        { type:'prop',    name:'金融街',   group:'C', price:1100 },
        { type:'bonus',   name:'奖励格' },
        { type:'prop',    name:'科技园',   group:'D', price:1200 },
        { type:'tax',     name:'税收' },
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
        { type:'chance',  name:'机会' },
        { type:'prop',    name:'金融街',   group:'C', price:1100 },
        { type:'bonus',   name:'奖励格' },
        { type:'prop',    name:'科技园',   group:'D', price:1200 },
        { type:'tax',     name:'税收' },
        { type:'prop',    name:'电视塔',   group:'D', price:1200 },
        { type:'station', name:'机场快线', price:800 },
        { type:'prop',    name:'王朝酒店', group:'D', price:1400 },
        { type:'casino',  name:'幸运赌场' },
        { type:'prop',    name:'翡翠湾',   group:'E', price:1500 },
        { type:'chance',  name:'机会' },
        { type:'prop',    name:'紫藤花苑', group:'E', price:1600 },
      ]},
  };

  // 随机岛屿：随机边数 + 随机分组 + 随机特殊格，60 次生成校验均可用
  function genRandomMap(){
    const EDGE = [4, 5, 6, 7][Math.floor(Math.random()*4)];   // 20/24/28/32 格
    const TOTAL = (EDGE + 1) * 4;
    const groups = GROUP_LETTERS.slice(0, Math.min(5, Math.max(3, Math.round(TOTAL / 8))));
    const names = [...PROP_NAMES].sort(() => Math.random() - 0.5);
    const stations = [...STATION_NAMES].sort(() => Math.random() - 0.5);
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
    if (TOTAL >= 24){ specials.push({ type:'utility', name:Math.random() < 0.5 ? '电力公司' : '自来水厂', price:700 }); }
    if (TOTAL >= 28){ specials.push({ type:'utility', name:Math.random() < 0.5 ? '电力公司' : '自来水厂', price:700 }); }
    const nCasino = TOTAL >= 28 ? 2 : 1;
    for (let k = 0; k < nCasino; k++) specials.push({ type:'casino', name:'幸运赌场' });
    const nPolice = Math.max(1, Math.floor(TOTAL / 28));
    for (let k = 0; k < nPolice; k++) specials.push({ type:'police', name:'交警临检' });

    const nProps = edgeIdx.length - specials.length;
    const perGroup = Math.floor(nProps / groups.length);
    const propTiles = [];
    groups.forEach((g, gi) => {
      const cnt = gi === groups.length - 1 ? nProps - perGroup * (groups.length - 1) : perGroup;
      const base = 600 + gi * 200;
      for (let k = 0; k < cnt; k++) propTiles.push({ type:'prop', name:names.pop(), group:g, price:base + k * 50 });
    });

    const bag = [...propTiles, ...specials].sort(() => Math.random() - 0.5);
    let bi = 0;
    edgeIdx.forEach(i => { tiles[i] = bag[bi++]; });
    return { id:'random', name:'随机岛屿', tiles };
  }

  // 启动时决定用哪张地图：存档里的地图 > URL 参数 > 预设默认
  Game.beforeBoard.push(bootSave => {
    const mapQS = new URLSearchParams(location.search).get('map');
    const sm = bootSave && bootSave.mods && bootSave.mods.maps;
    if (sm && sm.map && Array.isArray(sm.map.tiles)){
      Game.applyMap({ id: sm.map.id || 'random', name: sm.map.name || '随机岛屿', tiles: sm.map.tiles });
    } else if (mapQS === 'random'){
      Game.applyMap(genRandomMap());
    } else {
      Game.applyMap(MAP_PRESETS[mapQS] || MAP_PRESETS.classic);
    }
  });

  Game.saveExtras.push(() => ({ maps: { map: { id: MAP.id, name: MAP.name, tiles: MAP.tiles } } }));
});
