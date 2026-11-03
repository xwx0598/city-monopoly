// ================================================================
// 模块：扩展地块（m-extra-tiles）
// 保险代理 🛡️：缴保费 ¥80（入奖池）投保；之后第一次「被动损失」
//   （税款 / 维修费 / 赌场罚金）全额免单。可叠加，随存档保存。
// 拍卖行 🔨：落格即随机抽一块无主地产（含车站/电站）进入全体拍卖，
//   复用核心 runAuction（人类可出价，AI 按难度估价）；场上无无主地则歇脚。
// 模块关闭时两类地块落格即歇脚（核心按 emoji 通用渲染）。
// ================================================================
Game.use('extra-tiles', () => {
  const PREMIUM = 80;
  // 覆盖的「被动损失」：税款 / 维修费 / 赌场罚金（保释金、主动消费不在内）
  const COVERED = /税|维修|赌场/;

  // ---- 免单钩子：注册在核心 pay() 里，命中即免并扣减保险次数 ----
  Game.payWaivers.push((from, to, amount, reason) => {
    const p = players[from];
    if (to !== null || amount <= 0) return amount;         // 只保付给银行的被动损失
    if (!p.insured || !COVERED.test(reason)) return amount;
    p.insured--;
    renderPlayers();
    return null;                                           // 返回 null = 本次全额免除
  });

  // ---- 保险代理 ----
  Game.tileHandlers.insurance = async (pi) => {
    const p = players[pi];
    if (p.insured > 0){
      await showNotice(pi, '🛡️ 保险代理',
        `${p.name} 已有保险在身（还能免赔 ${p.insured} 次），本次无需续保。`);
      log(`🛡️ ${p.name} 路过保险代理，保险仍生效`);
      return;
    }
    if (p.money < PREMIUM){
      await showNotice(pi, '🛡️ 保险代理', `保费 ¥${PREMIUM}，但 ${p.name} 现金不足，无法投保。`);
      log(`🛡️ ${p.name} 现金不足，未投保`);
      return;
    }
    let buy;
    if (p.isAI){
      await sleep(500);
      buy = p.money >= 300;   // AI：留足 ¥300 现金垫才投保
    } else {
      buy = await waitChoice('🛡️ 购买保险？',
        `支付保费 <b>¥${PREMIUM}</b>（计入奖池），之后<b>第一次</b>「税款 / 维修费 / 赌场罚金」损失将<b>全额免单</b>。<br>` +
        `<span style="font-size:12px;color:#9C9789">当前现金 ¥${p.money}，投保后剩余 ¥${p.money - PREMIUM}。</span>`,
        '投保 ¥80', '不用了');
    }
    if (!buy){
      log(`🛡️ ${p.name} 放弃投保`);
      return;
    }
    const paid = await pay(pi, null, PREMIUM, '缴纳保险保费');
    if (paid > 0){
      p.insured = (p.insured || 0) + 1;
      if (Game.poolApi) Game.poolApi.add(paid);   // 保费进奖池，落「免费停车」可卷走
      log(`🛡️ ${p.name} 投保成功！下次税款/维修费/赌场罚金将免单`, 'good');
    }
  };

  // ---- 拍卖行 ----
  Game.tileHandlers.auction = async (pi) => {
    // 联机：拍卖只在落格者浏览器里跑，其他人类玩家看不到弹窗也没法出价，直接歇脚
    if (GAME_MODE === 'mp'){
      log(`🔨 ${players[pi].name} 落在拍卖行，联机模式暂不开放拍卖，歇脚`);
      return;
    }
    const pickable = TILES.map((t, k) => (t.type === 'prop' || t.type === 'station' || t.type === 'utility') ? k : -1)
      .filter(k => k >= 0 && tileOwner[k] === undefined);
    if (!pickable.length){
      log(`🔨 ${players[pi].name} 落在拍卖行，场上已无可拍地产，歇脚`);
      await showNotice(pi, '🔨 拍卖行', '场上已没有无主地产，本轮无拍卖。');
      return;
    }
    const pick = pickable[Math.floor(Math.random() * pickable.length)];
    log(`🔨 ${players[pi].name} 落在拍卖行，随机拍品：「${TILES[pick].name}」（标价 ¥${TILES[pick].price}）！`, 'card');
    await showNotice(pi, '🔨 拍卖行', `今日拍品：「${TILES[pick].name}」，全体玩家立即竞价！`);
    await runAuction(pick, pi);
  };

  // ---- 人类玩家的通用二选一弹窗（复用 buyModal 结构，样式一致） ----
  function waitChoice(title, descHtml, yesText, noText){
    return new Promise(resolve => {
      $('buyTitle').textContent = title;
      $('buyDesc').innerHTML = descHtml;
      $('buyYes').textContent = yesText;
      $('buyYes').disabled = false;
      $('buyNo').textContent = noText;
      $('buyModal').classList.remove('hidden');
      $('buyYes').onclick = () => { $('buyModal').classList.add('hidden'); resolve(true); };
      $('buyNo').onclick = () => { $('buyModal').classList.add('hidden'); resolve(false); };
    });
  }

  // ---- 存档：保险次数随玩家字段保存（core saveGame 已带 insured），奖池由 special-tiles 管 ----
});
