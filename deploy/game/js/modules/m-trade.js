// ================================================================
// 模块：玩家交易（m-trade）
// 经典规则核心一环：自己的回合可与任意玩家交换空地与现金。
// AI 按难度估价应答（easy 好说话 / normal 精明 / hard 抠门且懂垄断价值）。
// 仅限无建筑的地块参与交易（有建筑先拆卖）。
// ================================================================
Game.use('trade', () => {
  const ACCEPT_RATIO = { easy: 0.95, normal: 1.15, hard: 1.35, custom: 1.15 };
  const MONO_FACTOR = 1.6;     // 对对方而言凑齐垄断的地块溢价
  const LOSE_MONO_FACTOR = 1.8; // 对方把"你差一块就垄断"的地让给你时的心理加价

  const myDiff = () => (Game.aiDiffStyle ? Game.aiDiffStyle() : 'normal');

  // 地块对 pi 的价值（凑垄断的溢价；抵押地打 45 折——接手要先花钱赎回）
  function propValFor(pi, i){
    const t = TILES[i];
    let v = tileMortgaged[i] ? Math.round(t.price * 0.45) : t.price;
    if (t.type !== 'prop') return Math.round(v);   // 车站/电站无同组垄断溢价
    const g = t.group;
    const mates = TILES.map((tt, k) => (tt.type === 'prop' && tt.group === g) ? k : -1).filter(k => k >= 0);
    const mine = mates.filter(k => tileOwner[k] === pi).length;
    if (mine === mates.length - 1) v *= MONO_FACTOR;   // 拿到它就凑齐垄断
    return Math.round(v);
  }

  // AI 评估：received（AI 收到的：对方出的地+现金）vs gives（AI 付出的）
  function aiEvaluate(aiPi, getProps, getCash, giveProps, giveCash, proposer){
    let received = 0;
    getProps.forEach(i => { received += propValFor(aiPi, i); });
    received += getCash;
    let gives = 0;
    giveProps.forEach(i => {
      const t = TILES[i];
      let v = tileMortgaged[i] ? Math.round(t.price * 0.45) : t.price;
      if (t.type !== 'prop'){ gives += Math.round(v); return; }   // 车站/电站无垄断加价
      // 若这块地正好凑齐【提议者】的垄断，AI 知道它对你价值更高（让出更心疼）
      const g = t.group;
      const mates = TILES.map((tt, k) => (tt.type === 'prop' && tt.group === g) ? k : -1).filter(k => k >= 0);
      const propOwn = mates.filter(k => tileOwner[k] === proposer).length;
      if (propOwn === mates.length - 1) v *= LOSE_MONO_FACTOR;
      gives += Math.round(v);
    });
    gives += giveCash;
    const style = Game.aiDiffStyle ? Game.aiDiffStyle() : 'normal';
    const ratio = ACCEPT_RATIO[style] || ACCEPT_RATIO.normal;
    return received >= gives * ratio;
  }

  // 执行交易：a 付出 aProps + aCash，b 付出 bProps + bCash
  function execTrade(a, b, aProps, bProps, aCash, bCash){
    aProps.forEach(i => {
      tileOwner[i] = b;
      players[a].props = players[a].props.filter(x => x !== i);
      players[b].props.push(i);
      refreshTile(i);
    });
    bProps.forEach(i => {
      tileOwner[i] = a;
      players[b].props = players[b].props.filter(x => x !== i);
      players[a].props.push(i);
      refreshTile(i);
    });
    players[a].money += bCash - aCash;
    players[b].money += aCash - bCash;
    floatMoney(a, bCash - aCash);
    floatMoney(b, aCash - bCash);
    log(`🤝 ${players[a].name} 与 ${players[b].name} 达成交易`, 'good');
    renderPlayers();
    saveGame();
  }

  // ---------- UI ----------
  let state = null;   // { partner } 或 { partner, aProps, bProps } 等

  function tradableProps(pi){
    // 经典规则：地产（无建筑）、车站、电站均可交易
    return players[pi].props.filter(i => {
      const t = TILES[i];
      if (t.type === 'prop') return (tileLevel[i] || 0) === 0;
      return t.type === 'station' || t.type === 'utility';
    }).sort((a, b) => TILES[a].price - TILES[b].price);
  }

  function openModal(){
    state = { step: 'pick' };
    renderPick();
    $('tradeModal').classList.remove('hidden');
  }

  function renderPick(){
    $('tradeTitle').textContent = '🤝 玩家交易';
    const others = players.map((p, pi) => ({ pi, p }))
      .filter(x => x.pi !== turn && !x.p.bankrupt);
    $('tradeBody').innerHTML =
      '<p style="font-size:13px;color:#9C9789;margin-bottom:8px">选择交易对象（用自己的空地/现金，换对方的地或现金）：</p>' +
      others.map(x => `<button class="trade-partner" data-pi="${x.pi}" style="display:block;width:100%;margin-bottom:6px;padding:8px;border-radius:8px;border:1px solid #DFD9CB;background:#fff;cursor:pointer;font-size:13px">
        <span class="pdot" style="background:${x.p.color}"></span> ${x.p.name}　<span style="color:#9C9789">现金 ¥${x.p.money} · ${x.p.props.length} 处地产</span>
      </button>`).join('');
    $('tradeBtns').innerHTML = '<button class="btn-no" id="tradeCancel">取消</button>';
    $('tradeBody').querySelectorAll('.trade-partner').forEach(btn => {
      btn.onclick = () => { state = { step:'compose', partner:+btn.dataset.pi }; renderCompose(); };
    });
    $('tradeCancel').onclick = closeModal;
  }

  function propList(pi, name, boxId){
    const list = tradableProps(pi);
    if (!list.length) return `<p style="font-size:12px;color:#9C9789">${name}没有可交易的地（带建筑的地需先拆卖）</p>`;
    return `<div id="${boxId}">` + list.map(i => {
      const t = TILES[i];
      const tag = t.type !== 'prop' ? ' · ' + (t.type === 'station' ? '车站' : '电站')
        : (ownsWholeGroup(pi, t.group) ? ' · 垄断组' : '');
      return `<label style="display:block;font-size:12px;margin:3px 0;cursor:pointer">
      <input type="checkbox" data-i="${i}"> ${t.name}（¥${t.price}${tileMortgaged[i] ? ' · 抵押中' : ''}${tag}）
    </label>`;
    }).join('') + '</div>';
  }

  function renderCompose(){
    const partner = state.partner, me = turn;
    $('tradeTitle').textContent = `🤝 与 ${players[partner].name} 交易`;
    $('tradeBody').innerHTML = `
      <div style="display:flex;gap:12px;font-size:12px">
        <div style="flex:1">
          <b>你给出</b>（现金余额 ¥${players[me].money}）
          <div style="margin:4px 0 8px">${propList(me, '你', 'tradeMyList')}</div>
          现金 ¥<input type="number" id="tradeMyCash" min="0" max="${players[me].money}" value="0" style="width:70px">
        </div>
        <div style="flex:1">
          <b>你想要</b>（对方现金 ¥${players[partner].money}）
          <div style="margin:4px 0 8px">${propList(partner, '对方', 'tradeTheirList')}</div>
          现金 ¥<input type="number" id="tradeTheirCash" min="0" max="${players[partner].money}" value="0" style="width:70px">
        </div>
      </div>
      <p style="font-size:11px;color:#9C9789;margin-top:6px">无建筑的地产、车站、电站均可交易；凑齐垄断组的地对方会开价更高；抵押中的地按 45% 估价（接手方需自行赎回）。</p>`;
    $('tradeBtns').innerHTML = '<button class="btn-yes" id="tradePropose">发起提议</button><button class="btn-no" id="tradeCancel">取消</button>';
    $('tradePropose').onclick = propose;
    $('tradeCancel').onclick = closeModal;
  }

  function collectSide(pi, listId, cashId){
    const props = [];
    const box = $(listId);
    if (box) box.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
      const i = +cb.dataset.i;
      if (tileOwner[i] === pi) props.push(i);
    });
    const cash = Math.max(0, Math.min(parseInt($(cashId).value) || 0, players[pi].money));
    return { props, cash };
  }

  async function propose(){
    const me = turn, partner = state.partner;
    const mine = collectSide(me, 'tradeMyList', 'tradeMyCash');
    const theirs = collectSide(partner, 'tradeTheirList', 'tradeTheirCash');
    if (!mine.props.length && !mine.cash && !theirs.props.length && !theirs.cash){
      alert('提议不能是空的：给出至少一项东西。');
      return;
    }
    $('tradeModal').classList.add('hidden');
    const describe = () => {
      const part = (props, cash) => {
        const a = [];
        if (props.length) a.push(props.map(i => `「${TILES[i].name}」`).join('、'));
        if (cash) a.push(`现金 ¥${cash}`);
        return a.length ? a.join(' + ') : '（无）';
      };
      return `${players[me].name} 出 ${describe(mine.props, mine.cash)}，换 ${players[partner].name} 的 ${describe(theirs.props, theirs.cash)}`;
    };
    log(`🤝 ${describe()}`, 'card');

    if (players[partner].isAI){
      await sleep(800);
      const ok = aiEvaluate(partner, mine.props, mine.cash, theirs.props, theirs.cash);
      if (ok){
        execTrade(me, partner, mine.props, theirs.props, mine.cash, theirs.cash);
        log(`🤝 ${players[partner].name} 接受了交易！`, 'good');
        await showNotice(me, '🤝 交易成功', `${players[partner].name} 接受了你的提议，交易完成！`);
      } else {
        log(`🤝 ${players[partner].name} 摇头拒绝了这个提议`);
        await showNotice(me, '🤝 交易被拒', `${players[partner].name} 觉得条件不够诱人，拒绝了交易。`);
      }
    } else {
      // 热座：对方玩家看提议并决定
      $('tradeTitle').textContent = `🤝 ${players[me].name} 的交易提议`;
      const part = (props, cash) => {
        const a = [];
        if (props.length) a.push(props.map(i => `「${TILES[i].name}」`).join('、'));
        if (cash) a.push(`现金 ¥${cash}`);
        return a.length ? a.join(' + ') : '（无）';
      };
      $('tradeBody').innerHTML = `<p style="font-size:13px;line-height:1.8">${players[me].name} 给出：${part(mine.props, mine.cash)}<br>
        换取你（${players[partner].name}）的：${part(theirs.props, theirs.cash)}</p>`;
      $('tradeBtns').innerHTML = '<button class="btn-yes" id="tradeAccept">接受交易</button><button class="btn-no" id="tradeReject">拒绝</button>';
      $('tradeModal').classList.remove('hidden');
      const done = (accept) => {
        $('tradeModal').classList.add('hidden');
        if (accept){
          execTrade(me, partner, mine.props, theirs.props, mine.cash, theirs.cash);
          log(`🤝 ${players[partner].name} 接受了交易！`, 'good');
        } else {
          log(`🤝 ${players[partner].name} 拒绝了交易提议`);
        }
      };
      $('tradeAccept').onclick = () => done(true);
      $('tradeReject').onclick = () => done(false);
    }
  }

  function closeModal(){
    $('tradeModal').classList.add('hidden');
    state = null;
  }

  // 按钮状态：只能在自己回合、非破产后发起
  Game.afterRender.push(() => {
    const btn = $('tradeBtn');
    if (!btn) return;
    const p = players[turn];
    const can = !gameOver && !busy && p && !p.isAI && !p.bankrupt &&
      players.filter(x => !x.bankrupt).length >= 2;
    btn.disabled = !can;
  });

  // 存档：按钮事件在模块装载时直接绑定（DOM 已就绪），不依赖 onStart——
  // 续档路径过去不触发 onStart，导致读档后「交易」按钮完全无响应
  const tradeBtn = $('tradeBtn');
  if (tradeBtn) tradeBtn.onclick = () => { if (!tradeBtn.disabled) openModal(); };

  // 测试钩子
  Game.tradeApi = { execTrade, aiEvaluate, propValFor, openModal, closeModal };
});
