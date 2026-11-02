// ================================================================
// 模块：城市建设项目（m-vote）
// 第 15 回合起每隔几回合全体表决一个公共项目：同意者平摊建设费，
// 得票过半即动工，效益全城共享直到终局。热座时有当面拉票的乐趣。
//   🚇 地铁延伸：车站租金 ×1.5
//   🌳 城市公园：地产租金 +10%
//   🏙️ 商圈升级：过起点工资 +25%
// 随存档保存（mods.vote）。
// 核心钩子：onRound / rentFilters / salaryFilters。
// ================================================================
Game.use('vote', () => {
  const FIRST_ROUND = 15;    // 首次表决回合
  const EVERY = 4;           // 之后每隔几回合表决一次
  const COST = 240;          // 项目建设费（同意者平摊）

  const PROJECTS = [
    { id:'metro',  icon:'🚇', name:'地铁延伸', desc:'车站租金 ×1.5',
      tip:'把地铁线修到郊区：所有「车站」地块的租金变为 1.5 倍（含站台组合加成后）' },
    { id:'park',   icon:'🌳', name:'城市公园', desc:'地产租金 +10%',
      tip:'在城市中心修公园：所有「地产」地块租金 +10%' },
    { id:'mall',   icon:'🏙️', name:'商圈升级', desc:'过起点工资 +25%',
      tip:'打造核心商圈：任何人经过起点领工资时 +25%' },
  ];

  let active = [];           // 已动工的项目 id
  let proposed = [];         // 已表决过的项目 id（不再重复提）

  const isActive = id => active.includes(id);

  // ---------------- 效益 ----------------
  Game.rentFilters.push((owner, i, t, r) => {
    if (t.type === 'station' && isActive('metro')) return r * 1.5;
    if (t.type === 'prop' && isActive('park')) return r * 1.1;
    return r;
  });
  Game.salaryFilters.push((pi, s) => isActive('mall') ? Math.round(s * 1.25) : s);

  // ---------------- 表决 ----------------
  Game.onRound.push(r => {
    if (r < FIRST_ROUND || (r - FIRST_ROUND) % EVERY !== 0 || gameOver) return;
    const alive = players.map((p, i) => ({ p, i })).filter(o => !o.p.bankrupt);
    if (alive.length < 2) return;
    const pool = PROJECTS.filter(pr => !proposed.includes(pr.id) && !isActive(pr.id));
    if (!pool.length) return;
    const proj = pool[Math.floor(Math.random() * pool.length)];
    proposed.push(proj.id);
    startVote(proj, alive);
  });

  function startVote(proj, alive){
    log(`🏛️ 城市议案：「${proj.icon} ${proj.name}」——${proj.desc}。建设费 ¥${COST} 由赞成者平摊，进入表决…`, 'card');
    const votes = {};   // pi -> true/false
    let pending = alive.length;

    const finish = () => {
      const yes = alive.filter(o => votes[o.i]);
      if (yes.length * 2 > alive.length){
        const share = Math.ceil(COST / yes.length);
        yes.forEach(o => { o.p.money = Math.max(0, o.p.money - share); floatMoney(o.i, -share); });
        active.push(proj.id);
        log(`✅ 议案通过：「${proj.icon} ${proj.name}」动工！${yes.length} 名赞成者各出资 ¥${share}，${proj.desc}（直至终局）`, 'good');
      } else {
        log(`❌ 议案否决：「${proj.icon} ${proj.name}」未获过半赞成（${yes.length}/${alive.length}），城市维持现状`, 'bad');
      }
      renderPlayers();
      saveGame();
    };

    alive.forEach(o => {
      const p = o.p;
      if (p.isAI){
        // AI：净资产越高越愿意投资公共设施（领先者想锁住优势，但穷的时候投不起票）
        votes[o.i] = p.money >= 400 && (Math.random() < 0.75 || netWorth(p) >= 3000);
        pending--;
        if (pending === 0) finish();
      } else {
        waitVote(o.i, proj, choice => {
          votes[o.i] = choice;
          pending--;
          if (pending === 0) finish();
        });
      }
    });
  }

  function waitVote(pi, proj, cb){
    const p = players[pi];
    $('voteTitle').textContent = `🏛️ 城市议案：${proj.icon} ${proj.name}`;
    $('voteDesc').innerHTML =
      `<b>${proj.tip}</b><br>建设费 <b>¥${COST}</b> 由赞成者平摊（通过后生效直至终局）。<br>` +
      `<span style="font-size:12px;color:#9C9789">${p.name} 的现金 ¥${p.money}</span>`;
    $('voteYes').onclick = () => { $('voteModal').classList.add('hidden'); cb(true); };
    $('voteNo').onclick  = () => { $('voteModal').classList.add('hidden'); cb(false); };
    $('voteModal').classList.remove('hidden');
  }

  // ---------------- 中央徽章：已生效项目 ----------------
  function drawChip(){
    if (!active.length) return;
    let chip = document.getElementById('projChip');
    if (!chip){
      chip = document.createElement('div');
      chip.id = 'projChip';
      const anchor = document.getElementById('weatherChip') || document.getElementById('roundInfo');
      if (anchor) anchor.insertAdjacentElement(anchor.id === 'roundInfo' ? 'beforebegin' : 'afterend', chip);
      else return;
    }
    chip.textContent = active.map(id => PROJECTS.find(x => x.id === id).icon).join('') + ' 城建';
    chip.title = '已生效的城市项目：\n' +
      active.map(id => { const x = PROJECTS.find(y => y.id === id); return `${x.icon} ${x.name}：${x.desc}`; }).join('\n');
  }

  // ---------------- 存档 ----------------
  Game.saveExtras.push(() => ({ vote: { active: active.slice(), proposed: proposed.slice() } }));
  Game.loadExtras.push(sv => {
    const m = sv.mods && sv.mods.vote;
    if (!m) return;
    active = (m.active || []).filter(id => PROJECTS.some(x => x.id === id));
    proposed = (m.proposed || []).filter(id => PROJECTS.some(x => x.id === id));
    setTimeout(drawChip, 60);
  });

  Game.onStart.push(() => {
    active = [];
    proposed = [];
    log(`🏛️ 城市建设已上线：第 ${FIRST_ROUND} 回合起每隔 ${EVERY} 回合表决一项公共项目，赞成者平摊 ¥${COST}`);
  });

  Game.voteApi = { isActive, active: () => active.slice(), proposed: () => proposed.slice() };
});
