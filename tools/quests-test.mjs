// ================================================================
// 悬赏任务模块单元演练（不参与游戏运行）
// node tools/quests-test.mjs
// ================================================================
import fs from 'fs';

const SRC = new URL('../game/js/modules/m-quests.js', import.meta.url);
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond){ pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '　' + extra : ''}`); }
};

function makeEnv(){
  const players = [
    { name:'你',      money:1000, props:[], isAI:false, bankrupt:false, pos:2, color:'#000' },
    { name:'AI 阿豪', money:1000, props:[], isAI:true,  bankrupt:false, pos:6, color:'#111' },
  ];
  const TILES = Array.from({ length: 20 }, (_, i) => ({ type:'prop', name:'地' + i, price:300, group:'A' }));
  TILES[0] = { type:'go', name:'起点' };
  const logs = [];
  const G = {
    use(n, fn){ fn(G); }, modEnabled(){ return true; },
    tileHandlers:{}, rentFilters:[], salaryFilters:[], nameSuffix:[], badges:[], afterRender:[],
    saveExtras:[], loadExtras:[], beforeBoard:[], onStart:[], onRound:[], onPay:[], onLand:[], turnStart:[],
    payWaivers:[], payFilters:[], buildCostFilters:[], cardMoneyFilters:[], rollFilters:[], stepBlockers:[], netWorthExtras:[],
  };
  const g = globalThis;
  g.Game = G; g.players = players; g.TILES = TILES;
  g.round = 1; g.gameOver = false; g.busy = false; g.turn = 0;
  g.log = m => logs.push(m);
  g.renderPlayers = () => {}; g.saveGame = () => {}; g.floatMoney = () => {};
  g.document = { querySelectorAll: () => [], querySelector: () => null, getElementById: () => null };
  g.location = { search: '' };
  new Function(fs.readFileSync(SRC, 'utf8'))();
  return { G, players, TILES, logs };
}

console.log('悬赏任务模块演练');

// 1. 开局各领一张
{
  const { G, players } = makeEnv();
  G.onStart[0]();
  ok(!!G.questsApi.questOf(0) && !!G.questsApi.questOf(1), '开局：两名玩家各领一张悬赏令');
  ok(G.questsApi.questOf(0).deadline === 6, '开局：期限为 5 回合后', `deadline=${G.questsApi.questOf(0).deadline}`);
}

// 2. 抵达目标：落格即完成、发奖金、隔 3 回合再领
{
  const { G, players, logs } = makeEnv();
  G.onStart[0]();
  // 强造一张「抵达地5」的任务
  G.questsApi.makeQuest && (players[0].money = 1000);
  const q = { type:'land', target:5, goal:1, progress:0, deadline:6, reward:320 };
  // 直接通过存档回读注入，避免依赖内部随机
  G.loadExtras[0]({ mods: { quests: { quest: [q, null], nextAt: [1, 1] } } });
  ok(G.questsApi.questOf(0).target === 5, '回读：注入的任务保留');
  const before = players[0].money;
  G.onLand[0](0, 5);
  ok(players[0].money === before + 320, '抵达目标：奖金到账', `+${players[0].money - before}`);
  ok(G.questsApi.questOf(0) === null, '抵达目标：任务清空');
  ok(logs.some(x => x.includes('完成悬赏令')), '抵达目标：写入日志');
  // 未到再领回合不发新任务
  g_round(1);
  G.onRound[0](2);
  ok(G.questsApi.questOf(0) === null, '冷却期内不重复发任务');
  // 回合到位后补发
  G.onRound[0](4);
  ok(!!G.questsApi.questOf(0), '冷却结束自动发新任务');
  function g_round(){}
}

// 3. 收租达标：只认「租金」且只认到自己手里的钱
{
  const { G, players, logs } = makeEnv();
  const q = { type:'rent', target:300, goal:300, progress:0, deadline:8, reward:300 };
  G.loadExtras[0]({ mods: { quests: { quest: [null, q], nextAt: [1, 1] } } });
  G.onPay[0](0, 1, 150, '支付「金融街」的租金');
  ok(G.questsApi.questOf(1).progress === 150 && G.questsApi.questOf(1) !== null, '收租达标：进度累计');
  G.onPay[0](1, null, 100, '缴纳税款');
  ok(G.questsApi.questOf(1).progress === 150, '收租达标：税款不计入');
  G.onPay[0](0, 1, 200, '支付「机场快线」的租金');   // 0 付租给 1，1 是收租方
  ok(G.questsApi.questOf(1) === null, '收租达标：达标即完成');
  ok(players[1].money === 1000 + 300, '收租达标：奖金到账', `money=${players[1].money}`);
  ok(logs.some(x => x.includes('完成悬赏令')), '收租达标：写入日志');
}

// 4. 超期作废 + 破产清任务
{
  const { G, players, logs } = makeEnv();
  const q = { type:'land', target:5, goal:1, progress:0, deadline:6, reward:320 };
  G.loadExtras[0]({ mods: { quests: { quest: [q, null], nextAt: [1, 1] } } });
  G.onRound[0](7);   // deadline=6，第 7 回合已超期
  ok(G.questsApi.questOf(0) === null, '超期：任务作废');
  ok(logs.some(x => x.includes('超期作废')), '超期：写入日志');

  const q2 = { type:'rent', target:300, goal:300, progress:100, deadline:9, reward:300 };
  G.loadExtras[0]({ mods: { quests: { quest: [q2, null], nextAt: [1, 1] } } });
  players[0].bankrupt = true;
  G.onRound[0](8);
  ok(G.questsApi.questOf(0) === null, '破产：任务清空');
  G.onRound[0](20);
  ok(G.questsApi.questOf(0) === null, '破产：不再发新任务');
}

// 5. 徽章与存档
{
  const { G } = makeEnv();
  const q = { type:'rent', target:300, goal:300, progress:120, deadline:8, reward:300 };
  G.loadExtras[0]({ mods: { quests: { quest: [q, null], nextAt: [1, 1] } } });
  const badge = G.badges[0](0);
  ok(badge.includes('收租 120/300'), '徽章：显示收租进度', badge);
  const saved = G.saveExtras[0]();
  ok(saved.quests.quest[0].progress === 120 && saved.quests.nextAt.length === 2, '存档：任务与再领时间一起保存');
}

console.log(`\n${fail === 0 ? '✓ 全部通过' : '✗ 有失败项'}　通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
