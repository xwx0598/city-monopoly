// ================================================================
// 道具模块单元演练（不参与游戏运行）
// 目的：整局自检里很难稳定触发「被动道具命中」「遥控骰子改点数」
//       「路障拦人」「拆迁卡降级」这些分支（要凑齐买地+落格+付租），
//       所以这里用最小桩环境直接调用模块注册的钩子，逐条断言效果。
// 用法：node tools/items-test.mjs
// ================================================================
import fs from 'fs';

const SRC = new URL('../game/js/modules/m-items.js', import.meta.url);
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond){ pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '　' + extra : ''}`); }
};

// ---------------- 最小桩环境 ----------------
function makeEnv(){
  const mkInv = () => ({ rent:0, double:0, block:0, dice:0, demo:0 });
  const players = [
    { name:'你',     money:1000, props:[], isAI:false, bankrupt:false, pos:3, color:'#000' },
    { name:'AI 阿豪', money:1000, props:[], isAI:true,  bankrupt:false, pos:10, color:'#111' },
  ];
  const TILES = Array.from({ length: 20 }, (_, i) => ({ type:'prop', name:'地' + i, price:300, group:'A', level:0 }));
  TILES[0] = { type:'go', name:'起点' };
  const tileOwner = {}, tileLevel = {}, tileMortgaged = {};

  const logs = [];
  const G = {
    use(name, fn){ fn(G); },
    modEnabled(){ return true; },
    tileHandlers:{}, rentFilters:[], salaryFilters:[], nameSuffix:[], badges:[], afterRender:[],
    saveExtras:[], loadExtras:[], beforeBoard:[], onStart:[], onRound:[],
    payWaivers:[], payFilters:[], buildCostFilters:[], cardMoneyFilters:[],
    rollFilters:[], stepBlockers:[], turnStart:[],
  };

  const g = globalThis;
  g.Game = G; g.players = players; g.TILES = TILES; g.tileOwner = tileOwner; g.tileLevel = tileLevel;
  g.tileMortgaged = tileMortgaged; g.gameOver = false; g.busy = false; g.turn = 0;
  g.log = m => logs.push(m);
  g.renderPlayers = () => {};
  g.saveGame = () => {};
  g.refreshTile = () => {};
  g.rentOf = i => (tileOwner[i] === undefined ? 0 : 200 + (tileLevel[i] || 0) * 100);
  g.LEVEL_NAME = [null, '小屋', '大楼', '地标'];
  g.$ = () => null;
  g.document = {
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    createElement: () => ({ style:{}, classList:{ add(){}, remove(){} } }),
  };
  g.URLSearchParams = URLSearchParams;
  g.location = { search: '' };

  new Function(fs.readFileSync(SRC, 'utf8'))();
  return { G, players, TILES, tileOwner, tileLevel, logs };
}

// ---------------- 断言 ----------------
console.log('道具模块演练');

// 1. 免租卡：付租时全额免除，且只消耗一张
{
  const { G, players, logs } = makeEnv();
  const api = G.itemsApi;
  ok(!!api, '模块装载并暴露 itemsApi');
  api.invOf(0).rent = 2;
  const r = G.payWaivers[0](0, 1, 320, '支付「金融街」的租金');
  ok(r === null, '免租卡：付租金全额免除', `返回值 ${r}`);
  ok(api.invOf(0).rent === 1, '免租卡：消耗一张（2→1）', `剩 ${api.invOf(0).rent}`);
  ok(logs.some(x => x.includes('免租卡')), '免租卡：写入日志');

  // 非租金不免、无卡不免
  api.invOf(0).rent = 0;
  ok(G.payWaivers[0](0, null, 100, '缴纳税款') === 100, '免租卡：不管税款');
  ok(G.payWaivers[0](0, 1, 100, '租金') === 100, '免租卡：没卡时正常付款');
}

// 2. 加倍卡：收租时翻倍（从收租方库存扣）
{
  const { G, players } = makeEnv();
  const api = G.itemsApi;
  api.invOf(1).double = 1;
  const v = G.payFilters[0](0, 1, 300, '支付「金融街」的租金');   // 买家 0 → 房东 1
  ok(v === 600, '加倍卡：收租翻倍 300→600', `实际 ${v}`);
  ok(api.invOf(1).double === 0, '加倍卡：消耗房东的一张');
  ok(G.payFilters[0](0, 1, 300, '支付「金融街」的租金') === 300, '加倍卡：没卡时正常');
  ok(G.payFilters[0](0, null, 300, '缴纳税款') === 300, '加倍卡：不管付给银行的款项');
}

// 3. 遥控骰子：AI 回合开始锁定落点，掷骰按锁定值走
{
  const { G, players, TILES, tileOwner } = makeEnv();
  const api = G.itemsApi;
  const ai = 1; players[ai].pos = 3;
  api.invOf(ai).dice = 1;
  // 前方除了 +3 格全是别人的地，AI 应瞄准唯一那块无主地
  for (let i = 4; i <= 14; i++) if (i !== 6) tileOwner[i] = 0;
  G.turnStart[0](ai);
  ok(api.invOf(ai).dice === 0, '遥控骰子：AI 回合开始消耗一张');
  const faces = G.rollFilters[0](ai, [1, 1]);
  const sum = faces[0] + faces[1];
  const target = (players[ai].pos + sum) % TILES.length;
  ok(sum >= 2 && sum <= 12, '遥控骰子：点数和合法', `得到 ${sum}`);
  ok(faces[0] !== faces[1] || sum === 2 || sum === 12, '遥控骰子：尽量不掷出双数', `${faces}`);
  ok(target === 6, '遥控骰子：落在预设目标格', `落点 ${target}`);
  ok(G.rollFilters[0](ai, [2, 5]).join(',') === '2,5', '遥控骰子：用完即失效');
}

// 4. 路障：只拦别人、拦一次就消失
{
  const { G, players, logs } = makeEnv();
  const api = G.itemsApi;
  const ai = 1; players[ai].pos = 2;
  api.invOf(ai).block = 1;
  const orig = Math.random;
  Math.random = () => 0;                        // 固定放在 +3 格
  G.turnStart[0](ai);
  Math.random = orig;
  const blocks = api.getBlocks();
  ok(blocks.length === 1, '路障：AI 放下一个', `场上 ${blocks.length}`);
  const pos = blocks[0].pos;
  ok(G.stepBlockers[0](0, pos) === true, '路障：拦住对手（放的人是自己不算）');
  ok(api.getBlocks().length === 0, '路障：拦一次后消失');
  ok(logs.some(x => x.includes('路障')), '路障：写入日志');
  // 自己放的路障不拦自己
  api.invOf(ai).block = 1;
  Math.random = () => 0;
  G.turnStart[0](ai);
  Math.random = orig;
  const p2 = api.getBlocks()[0].pos;
  ok(G.stepBlockers[0](ai, p2) === false, '路障：不拦自己');
}

// 5. 拆迁卡：拆掉对手最高租金地产的一级
{
  const { G, players, tileOwner, tileLevel, logs } = makeEnv();
  const api = G.itemsApi;
  const ai = 1;
  tileOwner[8] = 0; tileLevel[8] = 3;           // 对手 0 有一套地标
  tileOwner[12] = 0; tileLevel[12] = 1;
  api.invOf(ai).demo = 1;
  G.turnStart[0](ai);
  ok(api.invOf(ai).demo === 0, '拆迁卡：消耗一张');
  ok(tileLevel[8] === 2, '拆迁卡：拆的是租金最高那块（3→2）', `实际 ${tileLevel[8]}`);
  ok(tileLevel[12] === 1, '拆迁卡：不碰其他地块');
  ok(logs.some(x => x.includes('拆迁卡')), '拆迁卡：写入日志');
  // 没房可拆时不该空耗
  const api2 = makeEnv();
  api2.G.itemsApi.invOf(1).demo = 1;
  api2.G.turnStart[0](1);
  ok(api2.G.itemsApi.invOf(1).demo === 1, '拆迁卡：无目标时不空耗');
}

// 6. 存档回读
{
  const { G, players, TILES, tileOwner, tileLevel } = makeEnv();
  const api = G.itemsApi;
  api.invOf(0).rent = 2; api.invOf(0).demo = 1;
  const saved = G.saveExtras[0]();
  ok(saved && saved.items && Array.isArray(saved.items.inv), '存档：saveExtras 返回 items 状态');
  // 清空后回读
  api.invOf(0).rent = 0; api.invOf(0).demo = 0;
  G.loadExtras[0]({ mods: saved });
  ok(api.invOf(0).rent === 2 && api.invOf(0).demo === 1, '存档：回读后库存一致');
}

console.log(`\n${fail === 0 ? '✓ 全部通过' : '✗ 有失败项'}　通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
