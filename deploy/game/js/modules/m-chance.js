// ================================================================
// 模块：机会事件卡（m-chance）
// 19 种事件卡。移动类卡片带递归深度保护（最多连转 3 层）。
// ================================================================
Game.use('chance', () => {
  const CHANCE_CARDS = [
    { text:'中了社区彩票，获得 ¥300！', money:300 },
    { text:'股票大跌，损失 ¥200。', money:-200 },
    { text:'参加技能培训，缴纳学费 ¥150。', money:-150 },
    { text:'银行发放利息，获得 ¥100。', money:100 },
    { text:'今天你生日，每位玩家送你 ¥50！', money:0, effect:'birthday' },
    { text:'搭乘直通车，前进 3 格！', money:0, effect:'move3' },
    { text:'打车直达起点，领取工资 ¥200。', money:0, effect:'toStart' },
    { text:'台风过境，每栋建筑支付维修费 ¥40。', money:0, effect:'repair' },
    { text:'酒后驾驶被查，立即移入监狱！', money:0, effect:'toJail' },
    { text:'走错了路，后退 3 格。', money:0, effect:'back3' },
    { text:'赶飞机！立即前往最近的车站。', money:0, effect:'toStation' },
    { text:'街头演出大受欢迎，每位玩家付你 ¥40！', money:0, effect:'collect', amt:40, why:'买演出门票' },
    { text:'双十一退款到账，获得 ¥120。', money:120 },
    { text:'手机摔碎了，维修花费 ¥180。', money:-180 },
    { text:'律师朋友送你一张「出狱许可证」，下次入狱可免罪释放！', money:0, effect:'jailCard' },
    // ---- 2026-11-02 新增 4 张 ----
    { text:'之前投保的财产出险，保险公司理赔到账 ¥150！', money:150 },
    { text:'在景区被宰，纪念品买贵了，损失 ¥120。', money:-120 },
    { text:'名下物业收租日到，每位玩家付你 ¥30！', money:0, effect:'collect', amt:30, why:'支付物业租金' },
    { text:'顺风快递一路绿灯，前进 5 格！', money:0, effect:'move5' },
  ];

  Game.tileHandlers.chance = async (pi, i, t, depth) => {
    const p = players[pi];
    const card = CHANCE_CARDS[Math.floor(Math.random()*CHANCE_CARDS.length)];
    $('cardDesc').textContent = card.text;
    const box = $('cardBox');
    box.classList.remove('flip'); void box.offsetWidth; box.classList.add('flip');
    $('cardModal').classList.remove('hidden');
    if (!p.isAI) await waitCardOk();
    else { await sleep(1100); $('cardModal').classList.add('hidden'); }
    log(`⚡ ${p.name} 抽到机会卡：${card.text}`, 'card');

    if (card.money){
      let m = card.money;
      // 金额调整钩子（羁绊模块的事件卡减免等）
      Game.cardMoneyFilters.forEach(f => { try { const v = f(pi, m); if (typeof v === 'number') m = Math.round(v); } catch(e){} });
      p.money += m;
      floatMoney(pi, m);
      renderPlayers();
    }
    if (card.effect === 'birthday'){
      for (let qi = 0; qi < players.length; qi++){
        if (qi === pi || players[qi].bankrupt) continue;
        const gift = Math.min(50, players[qi].money);
        await pay(qi, pi, gift, `给 ${p.name} 送生日礼物`);
        if (gameOver) break;
      }
    }
    if (card.effect === 'collect'){
      for (let qi = 0; qi < players.length; qi++){
        if (qi === pi || players[qi].bankrupt) continue;
        const fee = Math.min(card.amt, players[qi].money);
        await pay(qi, pi, fee, `${card.why}`);
        if (gameOver) break;
      }
    }
    if (card.effect === 'repair'){
      const n = p.props.reduce((s, idx) => s + (tileLevel[idx] || 0), 0);
      if (n > 0){
        const cost = n * 40;
        // 以实扣金额入奖池：若保险免单（pay 返回 0），奖池不应凭空多钱
        const paid = await pay(pi, null, cost, `支付 ${n} 栋建筑维修费`);
        if (Game.poolApi) Game.poolApi.add(paid);
      } else {
        log(`🏠 ${p.name} 名下没有建筑，躲过维修费`);
      }
    }
    if (card.effect === 'jailCard'){
      p.jailCard = (p.jailCard || 0) + 1;
      log(`🎟️ ${p.name} 获得一张「出狱许可证」（下次入狱自动使用）`, 'good');
    }
    if (card.effect === 'toJail'){
      await sendToJail(pi, '酒后驾驶被查');
    }
    const canChain = depth < 3;   // 防止连续触发移动类卡片造成无限嵌套
    if (card.effect === 'back3' && canChain){
      p.pos = (p.pos - 3 + TILES.length) % TILES.length;
      positionTokens();
      await sleep(280);
      await resolveLanding(pi, depth + 1);
      return;
    }
    if (card.effect === 'toStation' && canChain){
      let idx = p.pos;
      for (let k = 1; k <= TILES.length; k++){
        const cand = (p.pos + k) % TILES.length;
        if (TILES[cand].type === 'station'){ idx = cand; break; }
      }
      await teleportTo(pi, idx);
      await sleep(200);
      await resolveLanding(pi, depth + 1);
      return;
    }
    if (card.effect === 'move3' && canChain){
      await moveSteps(pi, 3);
      await resolveLanding(pi, depth + 1);
      return;
    }
    if (card.effect === 'move5' && canChain){
      await moveSteps(pi, 5);
      await resolveLanding(pi, depth + 1);
      return;
    }
    if (card.effect === 'toStart'){
      let salary = SALARY;
      Game.salaryFilters.forEach(f => { try { salary = f(pi, salary); } catch(e){} });
      p.money += salary;
      floatMoney(pi, salary);
      log(`${p.name} 到达起点，领工资 ¥${salary}`, 'good');
      await teleportTo(pi, 0);
      renderPlayers();
    }
  };
});
