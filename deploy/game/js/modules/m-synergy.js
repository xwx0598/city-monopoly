// ================================================================
// 模块：金铲铲式羁绊（m-synergy）——可选玩法，大厅开关后经 ?mods=synergy 启用
// 数据驱动：往 SYNERGY_DEFS 加一条定义 = 加一个羁绊，效果钩子按 kind 分发。
// 颜色羁绊：同组地块 2 块达成一阶、垄断全组达成二阶（组大小自适应）；
// 跨类羁绊：按持有数量 / 建筑等级触发。
// 倍率与加成全部通过 Game.*Filters / onRound 钩子叠加，不侵入核心。
// ================================================================
Game.use('synergy', () => {
  const CROSS_COLOR = { tycoon:'#B5806F', landlord:'#AD8A55', traveler:'#6E7C88' };

  // ---- 羁绊定义 ----
  // kind=group  : 颜色羁绊，tiers 阈值按组大小自适应（t1=size-1 至少 1，t2=size 垄断）
  // kind=count  : 持有指定类型地块达到 n 个
  // kind=levels : 名下建筑总等级达到 n
  const SYNERGY_DEFS = [
    { id:'synA', kind:'group', group:'A', name:'紫金商会', icon:'🏢',
      tiers:[
        { text:'A 组（紫）租金 +30%' },
        { text:'A 组（紫）租金 +75%' },
      ] },
    { id:'synB', kind:'group', group:'B', name:'海滨客商', icon:'⛵',
      tiers:[
        { text:'经过起点时工资额外 +¥60' },
        { text:'经过起点时工资额外 +¥150' },
      ] },
    { id:'synC', kind:'group', group:'C', name:'营造行会', icon:'🧱',
      tiers:[
        { text:'全部建造费 -15%' },
        { text:'全部建造费 -35%' },
      ] },
    { id:'synD', kind:'group', group:'D', name:'实业联盟', icon:'🏭',
      tiers:[
        { text:'支付他人租金 -15%' },
        { text:'支付他人租金 -30%' },
      ] },
    { id:'synE', kind:'group', group:'E', name:'市井人情', icon:'🎭',
      tiers:[
        { text:'事件卡损失减半' },
        { text:'事件卡损失免除' },
      ] },
    { id:'tycoon',   kind:'count',  type:'prop',    n:6, name:'地产大亨', icon:'👑',
      tiers:[{ text:'名下地产 ≥6 → 全部租金 +20%' }] },
    { id:'landlord', kind:'levels', n:5, name:'包租公', icon:'🔑',
      tiers:[{ text:'建筑总等级 ≥5 → 每轮开始收租 +¥50' }] },
    { id:'traveler', kind:'count',  type:'station', n:2, name:'出行大师', icon:'🚉',
      tiers:[{ text:'车站 ≥2 → 车站租金 +40%' }] },
  ];

  // ---- 组大小与阶级阈值（随机地图的组可能是 2~3 块） ----
  function groupSize(group){
    return TILES.filter(t => t.type === 'prop' && t.group === group).length;
  }
  function tierThresholds(def){
    if (def.kind !== 'group') return [def.n];
    const size = groupSize(def.group);
    return [Math.max(1, size - 1), size];
  }

  // ---- 计数与阶级：tierOf 返回 0/1/2（0 = 未达成） ----
  function countOf(pi, def){
    const p = players[pi];
    if (def.kind === 'group')
      return p.props.filter(i => TILES[i].type === 'prop' && TILES[i].group === def.group).length;
    if (def.kind === 'count')
      return p.props.filter(i => TILES[i].type === def.type).length;
    if (def.kind === 'levels')
      return p.props.reduce((s, i) => s + (tileLevel[i] || 0), 0);
    return 0;
  }
  function tierOf(pi, def){
    if (players[pi].bankrupt) return 0;
    if (def.kind === 'group' && groupSize(def.group) === 0) return 0;   // 本图没有该色组 → 羁绊不可达成
    const th = tierThresholds(def);
    const n = countOf(pi, def);
    let tier = 0;
    th.forEach((need, ti) => { if (n >= need) tier = ti + 1; });
    return tier;
  }
  // 该图上可用的羁绊（颜色羁绊要求图上存在该色组）
  function activeDefs(){
    return SYNERGY_DEFS.filter(d => d.kind !== 'group' || groupSize(d.group) > 0);
  }

  // ---- 效果挂钩 ----
  // A：组内租金加成；tycoon：全部租金 +20%
  Game.rentFilters.push((ownerPi, i, t, rent) => {
    let r = rent;
    if (t.type === 'prop' && t.group === 'A'){
      const tier = tierOf(ownerPi, SYNERGY_DEFS[0]);
      if (tier === 1) r *= 1.3;
      if (tier >= 2) r *= 1.75;
    }
    if (t.type === 'station'){
      const tier = tierOf(ownerPi, SYNERGY_DEFS.find(d => d.id === 'traveler'));
      if (tier) r *= 1.4;
    }
    if (tierOf(ownerPi, SYNERGY_DEFS.find(d => d.id === 'tycoon'))) r *= 1.2;
    return r;
  });

  // B：过起点额外工资
  Game.salaryFilters.push((pi, salary) => {
    const tier = tierOf(pi, SYNERGY_DEFS[1]);
    if (tier === 1) return salary + 60;
    if (tier >= 2) return salary + 150;
    return salary;
  });

  // C：建造费折扣
  Game.buildCostFilters.push((pi, cost) => {
    const tier = tierOf(pi, SYNERGY_DEFS[2]);
    if (tier === 1) return cost * 0.85;
    if (tier >= 2) return cost * 0.65;
    return cost;
  });

  // D：支付租金减免（只减租金，税款/保释金等不受影响）
  Game.payFilters.push((from, to, amount, reason) => {
    if (to === null || !/租金/.test(reason || '')) return amount;
    const tier = tierOf(from, SYNERGY_DEFS[3]);
    if (tier === 1) return amount * 0.85;
    if (tier >= 2) return amount * 0.7;
    return amount;
  });

  // E：事件卡损失减免
  Game.cardMoneyFilters.push((pi, money) => {
    if (money >= 0) return money;
    const tier = tierOf(pi, SYNERGY_DEFS[4]);
    if (tier === 1) return money * 0.5;
    if (tier >= 2) return 0;
    return money;
  });

  // 包租公：每轮开始收租
  Game.onRound.push(() => {
    const def = SYNERGY_DEFS.find(d => d.id === 'landlord');
    players.forEach((p, pi) => {
      if (p.bankrupt || !tierOf(pi, def)) return;
      p.money += 50;
      floatMoney(pi, 50);
      log(`🔑 ${p.name} 触发羁绊「包租公」，收到租金 ¥50`, 'good');
    });
    renderPlayers();
  });

  // ---- 玩家卡徽章：已达成的羁绊（含阶级） ----
  Game.badges.push(pi => SYNERGY_DEFS.map(def => {
    const tier = tierOf(pi, def);
    if (!tier) return '';
    const th = tierThresholds(def);
    const color = def.kind === 'group' ? GROUP_COLORS[def.group] : CROSS_COLOR[def.id];
    const tname = th.length > 1 ? (tier === 1 ? '一阶' : '二阶') : '';
    return `<span class="combo-tag" style="background:${color}">${def.icon} ${def.name}${tname ? '·' + tname : ''}</span>`;
  }).join(''));

  // ---- 达成播报：首次渲染静默登记，之后升级才提示 ----
  const seenTier = {};
  Game.afterRender.push(() => {
    players.forEach((p, pi) => {
      SYNERGY_DEFS.forEach(def => {
        const key = pi + ':' + def.id;
        const now = tierOf(pi, def);
        if (seenTier[key] === undefined){ seenTier[key] = now; return; }
        if (now > seenTier[key]){
          const th = tierThresholds(def);
          const tname = th.length > 1 ? (now === 1 ? '一阶' : '二阶') : '';
          log(`✨ ${p.name} 达成羁绊「${def.name}${tname ? '·' + tname : ''}」：${def.tiers[now - 1].text}`, 'good');
        }
        seenTier[key] = now;
      });
    });
  });

  // ---- 羁绊图鉴面板：顶栏按钮 + 弹窗（模块自注入，不占用核心 HTML） ----
  function renderPanel(){
    const body = $('synBody');
    body.innerHTML = activeDefs().map(def => {
      const th = tierThresholds(def);
      const color = def.kind === 'group' ? GROUP_COLORS[def.group] : CROSS_COLOR[def.id];
      const rows = players.map((p, pi) => {
        if (p.bankrupt) return '';
        const n = countOf(pi, def);
        const tier = tierOf(pi, def);
        const goal = th[th.length - 1];
        const label = def.kind === 'group' ? `${def.group} 组地块` :
                      def.kind === 'count' ? ({prop:'地产', station:'车站', utility:'电站'})[def.type] : '建筑等级';
        const tierText = tier ? (th.length > 1 ? `（${tier === 1 ? '一阶' : '二阶'}）` : '（已达成）') : '';
        return `<div class="syn-prog${tier ? ' on' : ''}">
            <span class="syn-pname">${p.isAI ? '🤖 ' : '👤 '}${p.name}</span>
            <span class="syn-track"><span class="syn-bar" style="width:${Math.min(100, n / goal * 100)}%;background:${color}"></span></span>
            <span class="syn-num">${n}/${goal} ${tierText}</span>
          </div>`;
      }).join('');
      const tiers = def.tiers.map((t, ti) =>
        `<div class="syn-tier${players.some((p, pi) => !p.bankrupt && tierOf(pi, def) > ti) ? ' on' : ''}">
          <b>${th.length > 1 ? ['一阶', '二阶'][ti] : '效果'}</b><span>${t.text}</span>
          <i>需 ${label(def, th[ti])}</i>
        </div>`).join('');
      return `<div class="syn-card">
          <div class="syn-head" style="border-left-color:${color}">${def.icon} <b>${def.name}</b>
            <small>${def.kind === 'group' ? '颜色羁绊 · ' + def.group + ' 组' : '组合羁绊'}</small></div>
          <div class="syn-tiers">${tiers}</div>
          ${rows}
        </div>`;
    }).join('');

    // 阈值说明：group 用块数，count 用个数，levels 用等级数
    function label(def, need){
      if (def.kind === 'group') return need + ' 块';
      if (def.kind === 'count') return need + ' 个';
      return '总等级 ' + need;
    }
  }

  const btn = document.createElement('button');
  btn.id = 'synBtn'; btn.className = 'btn-ghost'; btn.textContent = '🧩 羁绊';
  btn.onclick = () => { renderPanel(); $('synModal').classList.remove('hidden'); };
  const actions = document.querySelector('.topbar .actions');
  if (actions) actions.insertBefore(btn, actions.querySelector('#newGameBtn'));

  const modal = document.createElement('div');
  modal.className = 'overlay hidden'; modal.id = 'synModal';
  modal.innerHTML = `<div class="modal" style="width:min(520px,94vw)">
      <h3>🧩 羁绊图鉴</h3>
      <p style="margin-bottom:10px">同色地块凑够数量、或达成特殊组合即可激活羁绊，效果全自动生效。</p>
      <div id="synBody"></div>
      <div class="btns" style="margin-top:14px"><button class="btn-no" id="synClose">关闭</button></div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
  document.getElementById('synClose').onclick = () => modal.classList.add('hidden');

  // 测试钩子
  Game.synApi = { defs: SYNERGY_DEFS, tierOf, countOf };
});
