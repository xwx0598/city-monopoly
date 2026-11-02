// ================================================================
// 探监放贷模块单元演练（不参与游戏运行）
// node tools/visit-test.mjs
// ================================================================
import fs from 'fs';

const SRC = new URL('../game/js/modules/m-visit.js', import.meta.url);
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond){ pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '　' + extra : ''}`); }
};

function makeEnv(){
  const players = [
    { name:'你',      money:1000, props:[], isAI:false, bankrupt:false, pos:2, jail:0, color:'#000' },
    { name:'AI 阿豪', money:1000, props:['a','b'], isAI:true, bankrupt:false, pos:6, jail:0, color:'#111' },
    { name:'AI 小柔', money:1000, props:[], isAI:true, bankrupt:false, pos:9, jail:0, color:'#222' },
  ];
  const TILES = Array.from({ length: 20 }, (_, i) => ({ type:'prop', name:'地' + i, price:300, group:'A' }));
  const logs = [];
  const G = {
    use(n, fn){ fn(G); }, modEnabled(){ return true; },
    tileHandlers:{}, rentFilters:[], salaryFilters:[], nameSuffix:[], badges:[], afterRender:[],
    saveExtras:[], loadExtras:[], beforeBoard:[], onStart:[], onRound:[], onPay:[], onLand:[], turnStart:[],
    payWaivers:[], payFilters:[], buildCostFilters:[], cardMoneyFilters:[], rollFilters:[], stepBlockers:[], netWorthExtras:[],
    poolApi: { added: 0, add(n){ this.added += n; } },
  };
  const g = globalThis;
  g.Game = G; g.players = players; g.TILES = TILES;
  g.round = 1; g.gameOver = false; g.busy = false; g.turn = 0;
  g.log = m => logs.push(m);
  g.renderPlayers = () => {}; g.saveGame = () => {}; g.floatMoney = () => {};
  g.sleep = async () => {};
  // 探监不依赖真实 pay()：这里用极简替身（直接扣钱、返回实扣）
  g.pay = async (from, to, amount, reason) => { players[from].money -= amount; return amount; };
  g.document = { querySelectorAll: () => [], querySelector: () => null, getElementById: () => null };
  g.location = { search: '' };
  new Function(fs.readFileSync(SRC, 'utf8'))();
  return { G, players, logs };
}

console.log('探监放贷模块演练');

// 1. 捞人：出狱 + 建立提成关系 + 保释金入池
{
  const { G, players, logs } = makeEnv();
  players[1].jail = 3;
  const before = players[0].money;
  await G.visitApi.doBail(0, 1);
  ok(players[1].jail === 0, '捞人：囚犯立刻出狱', `jail=${players[1].jail}`);
  ok(players[0].money === before - 50, '捞人：替付保释金 ¥50', `扣了 ${before - players[0].money}`);
  ok(G.poolApi.added === 50, '捞人：保释金入奖池');
  const s = G.visitApi.shareOf(1);
  ok(s && s.to === 0 && s.rate === 0.5, '捞人：建立 50% 提成关系', JSON.stringify(s));
  ok(logs.some(x => x.includes('探监捞人')), '捞人：写入日志');
}

// 2. 提成：囚犯收租时一半归债主、一次结清
{
  const { G, players, logs } = makeEnv();
  players[1].jail = 3;
  await G.visitApi.doBail(0, 1);
  const m1 = players[1].money, m0 = players[0].money;
  // 真实 pay() 会先把全额记给收款方，onPay 是事后通知——这里先补上这一步再触发
  players[1].money += 200;
  G.onPay[0](2, 1, 200, '支付「金融街」的租金');   // 2 付租给 1
  ok(players[1].money === m1 + 200 - 100, '提成：囚犯实得一半', `money=${players[1].money}`);
  ok(players[0].money === m0 + 100, '提成：债主抽成 ¥100', `money=${players[0].money}`);
  ok(G.visitApi.shareOf(1) === null, '提成：一次结清后关系解除');
  ok(logs.some(x => x.includes('收探监提成')), '提成：写入日志');
  // 非租金不触发
  players[1].jail = 3;
  await G.visitApi.doBail(0, 1);
  players[1].money += 100;
  const m1b = players[1].money;
  G.onPay[0](2, 1, 100, '缴纳税款');
  ok(players[1].money === m1b && G.visitApi.shareOf(1), '提成：税款不触发、关系保留');
}

// 3. 债权人破产：关系作废，囚犯不用还
{
  const { G, players } = makeEnv();
  players[1].jail = 3;
  await G.visitApi.doBail(0, 1);
  players[0].bankrupt = true;
  G.onRound[0](2);
  ok(G.visitApi.shareOf(1) === null, '债权人破产：提成关系作废');
}

// 4. 徽章 + 存档回读
{
  const { G, players } = makeEnv();
  players[1].jail = 3;
  await G.visitApi.doBail(0, 1);
  const badge = G.badges[0](1);
  ok(badge.includes('欠提成') && badge.includes('50%'), '徽章：囚犯卡显示欠提成', badge);
  const saved = G.saveExtras[0]();
  ok(saved.visit.shares[1].to === 0, '存档：提成关系保存');
  G.loadExtras[0]({ mods: saved });
  ok(G.visitApi.shareOf(1) && G.visitApi.shareOf(1).to === 0, '存档：回读一致');
  // 坏数据回读安全
  G.loadExtras[0]({ mods: { visit: { shares: [null, { to: 99, rate: 0.5 }] } } });
  ok(G.visitApi.shareOf(1) === null, '存档：非法债权人序号被丢弃');
}

// 5. 没人蹲监时落监狱角无事发生
{
  const { G, players, logs } = makeEnv();
  const before = players[0].money;
  await G.tileHandlers.jail(0);
  ok(players[0].money === before && !G.visitApi.shareOf(0), '无人蹲监：落监狱角无副作用');
}

console.log(`\n${fail === 0 ? '✓ 全部通过' : '✗ 有失败项'}　通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
