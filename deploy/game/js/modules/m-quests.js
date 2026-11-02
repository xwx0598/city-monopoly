// ================================================================
// 模块：悬赏任务卡（m-quests）
// 每位玩家同一时间至多一张悬赏令，完成领赏 / 超期作废，隔 3 回合再发新的。
//   🎯 抵达目标 —— 「X 回合内抵达『地块名』」（落格即成，onLand 监听）
//   💰 收租达标 —— 「X 回合内累计向对手收租 ¥Y」（onPay 监听真实付款）
// 奖金按剩余时间越紧越高；进度显示在玩家卡 📋 徽章（悬停看全文）。
// 随存档保存（mods.quests）。
// ================================================================
Game.use('quests', () => {
  const SPAN_ROUNDS = 5;      // 任务期限（回合数）
  const REISSUE_AFTER = 3;    // 作废/完成后隔几回合发新任务
  const LAND_REWARD = 320;
  const RENT_REWARD = 300;

  let quests = [];            // pi -> null | { type, target, goal, progress, deadline, reward }
  let nextAt = [];            // pi -> 最早可再领任务的回合

  // ---------------- 生成任务 ----------------
  function makeQuest(pi, round){
    const p = players[pi];
    if (Math.random() < 0.55){
      // 抵达目标：挑一块 3~12 步开外的具名地块（车站/地产都行）
      const named = TILES.map((t, i) => ({ t, i }))
        .filter(o => o.t.name && o.t.type !== 'go' && o.i !== 0);
      const pick = named[Math.floor(Math.random() * named.length)];
      return { type:'land', target: pick.i, goal: 1, progress: 0,
               deadline: round + SPAN_ROUNDS, reward: LAND_REWARD };
    }
    // 收租达标：目标金额约等于两三笔普通租金
    const goal = 200 + Math.floor(Math.random() * 3) * 100;
    return { type:'rent', target: goal, goal, progress: 0,
             deadline: round + SPAN_ROUNDS, reward: RENT_REWARD };
  }

  function questText(q){
    const left = Math.max(0, q.deadline - round);
    return q.type === 'land'
      ? `在 ${left} 回合内抵达「${TILES[q.target].name}」`
      : `在 ${left} 回合内累计向对手收租 ¥${q.goal - q.progress}`;
  }

  function assign(pi){
    const q = makeQuest(pi, round);
    quests[pi] = q;
    log(`📋 ${players[pi].name} 接到悬赏令：${questText(q)}——奖金 ¥${q.reward}`, 'card');
    renderPlayers();
  }

  function complete(pi){
    const q = quests[pi];
    players[pi].money += q.reward;
    floatMoney(pi, q.reward);
    log(`✅ ${players[pi].name} 完成悬赏令（${questText(q)}），领取奖金 ¥${q.reward}！`, 'good');
    quests[pi] = null;
    nextAt[pi] = round + REISSUE_AFTER;
    renderPlayers();
  }

  function expire(pi){
    const q = quests[pi];
    log(`⌛ ${players[pi].name} 的悬赏令超期作废（${questText(q)}）`, 'bad');
    quests[pi] = null;
    nextAt[pi] = round + REISSUE_AFTER;
  }

  // ---------------- 监听 ----------------
  Game.onRound.push(r => {
    players.forEach((p, pi) => {
      if (p.bankrupt){ if (quests[pi]) quests[pi] = null; return; }
      const q = quests[pi];
      if (q && r > q.deadline){ expire(pi); return; }
      if (!q && r >= (nextAt[pi] || 1)) assign(pi);
    });
  });

  Game.onLand.push((pi, i) => {
    const q = quests[pi];
    if (!q || players[pi].bankrupt) return;
    if (q.type === 'land' && i === q.target) complete(pi);
  });

  Game.onPay.push((from, to, amount, reason) => {
    if (to === null || !/租金/.test(reason)) return;
    const q = quests[to];
    if (!q || q.type !== 'rent' || players[to].bankrupt) return;
    q.progress += amount;
    if (q.progress >= q.goal) complete(to);
  });

  // ---------------- 玩家卡徽章 ----------------
  Game.badges.push(pi => {
    const q = quests[pi];
    if (!q || players[pi].bankrupt) return '';
    const label = q.type === 'land'
      ? `📋 抵达「${TILES[q.target].name}」`
      : `📋 收租 ${q.progress}/${q.goal}`;
    return `<span class="quest-chip" title="悬赏令：${questText(q)}（奖金 ¥${q.reward}）">${label}</span>`;
  });

  // ---------------- 存档 ----------------
  Game.saveExtras.push(() => ({ quests: { quest: quests.map(q => q ? { ...q } : null), nextAt: nextAt.slice() } }));
  Game.loadExtras.push(sv => {
    const m = sv.mods && sv.mods.quests;
    if (!m) return;
    quests = players.map((_, pi) => (m.quest && m.quest[pi]) || null);
    nextAt = players.map((_, pi) => (m.nextAt && m.nextAt[pi]) || 1);
  });

  Game.onStart.push(() => {
    quests = players.map(() => null);
    nextAt = players.map(() => 1);
    log('📋 悬赏任务已上线：完成悬赏令领奖金，超期作废，玩家卡 📋 徽章可看进度');
    players.forEach((_, pi) => { if (!players[pi].bankrupt) assign(pi); });
  });

  Game.questsApi = { questOf: pi => quests[pi] || null, makeQuest, questText };
});
