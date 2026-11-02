// ================================================================
// 模块：探监放贷（m-visit）
// 监狱角不再只是「路过」：落格时若有人蹲监，可以替他交保释金捞人，
// 换取他名下下一笔租金收入的 50% 提成（一次结清）。监狱从纯惩罚变博弈点。
// 人类落格弹选择面板；AI 按目标身价决定是否捞人。随存档保存（mods.visit）。
// 核心钩子：tileHandlers.jail / onPay / onRound / badges。
// ================================================================
Game.use('visit', () => {
  const RATE = 0.5;          // 提成比例
  const AI_MIN_CASH = 400;   // AI 探监的现金门槛

  let shares = [];           // pi -> null | { to: 债权人pi, rate }

  const shareOf = pi => shares[pi] || null;

  // ---------------- 落监狱角：探监 ----------------
  Game.tileHandlers.jail = async (pi) => {
    const p = players[pi];
    const jailed = players.map((q, k) => ({ q, k }))
      .filter(o => o.k !== pi && !o.q.bankrupt && o.q.jail > 0);
    if (!jailed.length || p.bankrupt || p.money < 50){
      if (jailed.length && p.money >= 50) log(`⛓️ ${p.name} 路过监狱探风，没捞人`);
      return;
    }

    if (p.isAI){
      await sleep(450);
      // AI：捞身价最高的（地产多的人出来后能产生更多提成）
      const target = jailed.sort((a, b) => b.q.props.length - a.q.props.length)[0];
      const worth = target.q.props.length;
      if (worth >= 2 && p.money >= AI_MIN_CASH && Math.random() < 0.7){
        await doBail(pi, target.k);
      } else {
        log(`⛓️ ${p.name} 路过监狱，权衡之后没捞人`);
      }
      return;
    }

    // 人类：弹选择面板
    await waitVisit(pi, jailed);
  };

  function doBail(pi, target){
    return new Promise(async resolve => {
      const visitor = players[pi], prisoner = players[target];
      const paid = await pay(pi, null, 50, `替${prisoner.name}缴纳保释金`);
      if (paid > 0){
        if (Game.poolApi) Game.poolApi.add(paid);
        prisoner.jail = 0;
        shares[target] = { to: pi, rate: RATE };
        log(`🤝 ${visitor.name} 探监捞人：替 ${prisoner.name} 交了保释金，换取其下一笔租金的 ${RATE * 100}% 提成！`, 'good');
        renderPlayers();
      }
      resolve();
    });
  }

  function waitVisit(pi, jailed){
    return new Promise(resolve => {
      const p = players[pi];
      $('visitTitle').textContent = '⛓️ 探监';
      $('visitDesc').innerHTML =
        `替狱中玩家缴纳保释金 <b>¥50</b>（计入奖池），他立刻出狱；` +
        `作为交换，你抽成他<b>下一笔租金收入的 50%</b>（一次结清）。<br>` +
        `<span style="font-size:12px;color:#9C9789">当前现金 ¥${p.money}</span>`;
      $('visitList').innerHTML = jailed.map(o => `
        <button class="tgt" data-k="${o.k}">
          <span class="tgt-d">捞</span>
          <span class="tgt-n">${o.q.name}</span>
          <span class="tgt-t">${o.q.props.length} 处地产 · 还剩 ${o.q.jail} 次出狱机会</span>
        </button>`).join('');
      $('visitList').querySelectorAll('.tgt').forEach(b => {
        b.onclick = async () => {
          $('visitModal').classList.add('hidden');
          await doBail(pi, +b.dataset.k);
          resolve();
        };
      });
      $('visitModal').classList.remove('hidden');
      $('visitClose').onclick = () => {
        $('visitModal').classList.add('hidden');
        log(`⛓️ ${p.name} 路过监狱，没捞人`);
        resolve();
      };
    });
  }

  // ---------------- 提成结算 ----------------
  Game.onPay.push((from, to, amount, reason) => {
    if (to === null || !/租金/.test(reason)) return;
    const s = shareOf(to);
    if (!s || players[to].bankrupt || players[s.to].bankrupt){
      if (players[to] && players[to].bankrupt) shares[to] = null;
      return;
    }
    const cut = Math.round(amount * s.rate);
    if (cut <= 0) return;
    players[to].money -= cut;
    players[s.to].money += cut;
    floatMoney(to, -cut);
    floatMoney(s.to, cut);
    log(`🏦 ${players[s.to].name} 收探监提成：${players[to].name} 租金 ¥${amount} 的 ${s.rate * 100}% = ¥${cut}`, 'card');
    shares[to] = null;   // 一次结清
    renderPlayers();
  });

  // 每回合兜底：破产的欠债人/债权人都清掉提成关系
  Game.onRound.push(() => {
    players.forEach((p, pi) => {
      const s = shareOf(pi);
      if (p.bankrupt || (s && players[s.to].bankrupt)) shares[pi] = null;
    });
  });

  // ---------------- 徽章 ----------------
  Game.badges.push(pi => {
    const s = shareOf(pi);
    if (!s) return '';
    return `<span class="quest-chip" title="欠 ${players[s.to].name} 一笔租金提成（${s.rate * 100}%）：下一笔收租时结清">🏦 欠提成 ${s.rate * 100}%</span>`;
  });

  // ---------------- 存档 ----------------
  Game.saveExtras.push(() => ({ visit: { shares: shares.map(s => s ? { ...s } : null) } }));
  Game.loadExtras.push(sv => {
    const m = sv.mods && sv.mods.visit;
    if (!m) return;
    shares = players.map((_, pi) => {
      const s = m.shares && m.shares[pi];
      return (s && Number.isFinite(s.to) && players[s.to]) ? { to: s.to, rate: +s.rate || RATE } : null;
    });
  });

  Game.onStart.push(() => {
    shares = players.map(() => null);
    log('🤝 探监玩法已上线：落「监狱」角可替狱中玩家交保释金，换取其下一笔租金 50% 提成');
  });

  Game.visitApi = { shareOf, doBail };
});
