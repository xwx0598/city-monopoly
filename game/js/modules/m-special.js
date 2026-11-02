// ================================================================
// 模块：特殊地块（m-special-tiles）
// 电站/水厂（骰点租金）、幸运赌场、交警临检、奖池停车格、税收。
// 模块关闭时这些地块落格即歇脚，不产生任何收支。
// ================================================================
Game.use('special-tiles', () => {
  let pool = 0;   // 奖池：税款与赌场罚金入池，免费停车格卷走

  // ---- 税收：资产 10%（上限 ¥100）入奖池（保险免单时按实扣金额入池） ----
  Game.tileHandlers.tax = async (pi) => {
    const p = players[pi];
    const amt = Math.min(100, Math.floor(netWorth(p) * 0.1), p.money);
    const paid = await pay(pi, null, amt, '缴纳税款');
    pool += paid;
  };

  // ---- 幸运赌场：40% +100 / 32% 输150入池 / 28% 平（期望略负，小赌怡情） ----
  Game.tileHandlers.casino = async (pi) => {
    const p = players[pi];
    await sleep(350);
    const r = Math.random();
    if (r < 0.40){
      p.money += 100;
      floatMoney(pi, 100);
      renderPlayers();
      await showNotice(pi, '🎰 幸运赌场', '手气爆棚！中了大奖 ¥100！');
      log(`🎰 ${p.name} 在赌场中了大奖，+¥100`, 'good');
    } else if (r < 0.72){
      const loss = Math.min(150, Math.max(0, p.money));
      const paid = await pay(pi, null, loss, '赌场失利，损失');
      pool += paid;   // 保险免单时 paid=0，奖池不凭空进钱
      await showNotice(pi, '🎰 幸运赌场', `运气不佳，输了 ¥${loss}（罚金计入奖池）。`);
    } else {
      await showNotice(pi, '🎰 幸运赌场', '不输不赢，全身而退。');
      log(`🎰 ${p.name} 在赌场全身而退`);
    }
  };

  // ---- 交警临检：押送监狱（可保释/掷双数/免狱卡脱身） ----
  Game.tileHandlers.police = async (pi) => {
    await showNotice(pi, '🚨 交警临检', `${players[pi].name} 被查出违规，立即押送监狱！`);
    await sendToJail(pi, '违规驾驶被临检');
  };

  // ---- 免费停车：卷走整池 ----
  Game.tileHandlers.parking = async (pi) => {
    const p = players[pi];
    if (pool > 0){
      const win = pool; pool = 0;
      p.money += win;
      floatMoney(pi, win);
      renderPlayers();
      log(`🅿️ ${p.name} 落在免费停车，卷走奖池 ¥${win}！`, 'good');
    } else {
      log(`🅿️ ${p.name} 在免费停车场歇脚`);
    }
  };

  // ---- 电站/水厂：可购买，租金 = 骰子总点 × 倍率（一座 ×8，两座 ×20） ----
  Game.tileHandlers.utility = (pi, i) => ownableLanding(pi, i);
  Game.rentOverrides.utility = (i) => {
    const owner = tileOwner[i];
    const owned = players[owner].props.filter(x => TILES[x].type === 'utility' && !tileMortgaged[x]).length;
    return lastRoll * (owned >= 2 ? 20 : 8);
  };
  // 文案里带「租金」：其它模块（如实业联盟的付租减免）按 reason 匹配租金类支出
  Game.rentReason = (i, owner) => `使用「${TILES[i].name}」的租金（骰子 ${lastRoll} 点）`;
  Game.rentNote = (i) => '租金按每次骰子点数计算（×8，集齐两座 ×20）';

  // ---- 奖池：供其他模块（如事件卡维修费）存取 ----
  Game.poolApi = {
    get: () => pool,
    add: amt => { pool += amt; },
  };
  Game.afterRender.push(() => {
    const ph = $('poolHint');
    if (ph) ph.textContent = pool > 0 ? `奖池 ¥${pool}` : '奖池';
  });

  // ---- 存档 ----
  Game.saveExtras.push(() => ({ 'special-tiles': { pool } }));
  Game.loadExtras.push(sv => {
    const m = sv.mods && sv.mods['special-tiles'];
    pool = (m && typeof m.pool === 'number') ? m.pool : (typeof sv.pool === 'number' ? sv.pool : 0);
  });
});
