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

  // ================================================================
  // 地块悬停卡片（pure UI）：不用开图鉴就能看到这块地的羁绊归属与双方进度
  // ================================================================
  const TIP = document.createElement('div');
  TIP.id = 'synTip'; TIP.className = 'hidden';
  document.body.appendChild(TIP);

  const TYPE_LABEL = { prop:'地产', station:'车站', utility:'电站', chance:'机会', tax:'税收',
    casino:'赌场', police:'交警', go:'起点', jail:'监狱', parking:'奖池停车', bonus:'奖励',
    insurance:'保险代理', auction:'拍卖行' };
  const TYPE_DESC = {
    prop:'可购买并建房升级，同组凑齐租金翻倍',
    station:'租金随持有车站数递增（¥100 / 200 / 400）',
    utility:'租金 = 骰点 ×8，双座齐收 ×20',
    chance:'抽一张事件卡，19 种效果随机',
    tax:'按总资产 10% 缴税（上限 ¥100），税款进奖池',
    casino:'押注一把：赢 ¥200 / 输 ¥150（罚金进奖池）',
    police:'被查违规直接押送监狱，下回合跳过',
    go:'经过领取工资，可被羁绊加成',
    jail:'服刑区，可保释或用出狱许可证',
    parking:'落格卷走奖池全部奖金',
    bonus:'直接领取 ¥200 奖励',
    insurance:'花 ¥80 投保，免一次税 / 维修 / 赌场罚金',
    auction:'随机抽一块无主地立刻公开拍卖',
  };
  const defOfGroup  = g => SYNERGY_DEFS.find(d => d.kind === 'group' && d.group === g);
  const defOfId     = id => SYNERGY_DEFS.find(d => d.id === id);
  function unitOf(def){ return def.kind === 'levels' ? '级' : (def.kind === 'count' ? '个' : '块'); }

  function playerRows(def){
    const th = tierThresholds(def);
    const goal = th[th.length - 1];
    const color = def.kind === 'group' ? GROUP_COLORS[def.group] : CROSS_COLOR[def.id];
    return players.map((p, pi) => {
      if (p.bankrupt) return '';
      const n = Math.min(countOf(pi, def), goal), tier = tierOf(pi, def);
      const tn = tier ? (th.length > 1 ? (tier === 1 ? '一阶' : '二阶') : '已达成') : '';
      return `<div class="tip-prog${tier ? ' on' : ''}">
          <span class="tip-pn">${p.isAI ? '🤖' : '👤'}${p.name}</span>
          <span class="tip-track"><span style="width:${n / goal * 100}%;background:${color}"></span></span>
          <span class="tip-pc">${n}/${goal}${tn ? ' ' + tn : ''}</span>
        </div>`;
    }).join('');
  }

  function synergyBlock(def, note){
    const th = tierThresholds(def);
    const color = def.kind === 'group' ? GROUP_COLORS[def.group] : CROSS_COLOR[def.id];
    const tiers = def.tiers.map((t, ti) =>
      `<div class="tip-tier"><b>${th.length > 1 ? (ti === 0 ? '一阶' : '二阶') : '效果'}</b>${t.text}` +
      `<i>需 ${th[ti]} ${unitOf(def)}</i></div>`).join('');
    return `<div class="tip-sec">
        <div class="tip-syn"><span class="tip-chip" style="background:${color}">${def.icon} ${def.name}</span>
          <small>${note || (def.kind === 'group' ? '颜色羁绊' : '组合羁绊')}</small></div>
        ${tiers}${playerRows(def)}
      </div>`;
  }

  function renderTip(i){
    const t = TILES[i];
    if (!t) return '';
    const owner = tileOwner[i], lv = tileLevel[i] || 0;
    const color = (typeof tileColor === 'function') ? tileColor(t) : (GROUP_COLORS[t.group] || GROUP_COLORS[t.type] || '#8B8779');
    const ownerTxt = owner === undefined ? '<span class="tip-nil">无主</span>'
      : `<b style="color:${players[owner].color}">${players[owner].name}</b>`;
    const room = t.type === 'prop' ? (lv ? ` · ${lv} 级房` : ' · 空地') : '';

    let html = `<div class="tip-head"><b>${t.name}</b>${t.price ? `<span class="tip-price">¥${t.price}</span>` : ''}</div>
      <div class="tip-meta"><span class="tip-g" style="background:${color}">${t.group || '·'}</span>${TYPE_LABEL[t.type] || '地块'}${room} · ${ownerTxt}</div>`;

    // 租金（含羁绊加成，直接给玩家一个“现在踩上去要付多少”的答案）
    if (owner !== undefined && ['prop', 'station', 'utility'].includes(t.type)){
      const r = rentOf(i);
      const mono = t.type === 'prop' && typeof ownsWholeGroup === 'function' && ownsWholeGroup(owner, t.group);
      html += `<div class="tip-rent">现租金 <b>¥${r}</b>${tileMortgaged[i] ? '（已抵押，暂不收租）' : ''}${mono ? ' · 已垄断整组 ×2' : ''}</div>`;
    }

    // 羁绊归属：地产看同色组，车站看出行大师
    if (t.type === 'prop' && t.group && defOfGroup(t.group)){
      html += synergyBlock(defOfGroup(t.group));
    } else if (t.type === 'station'){
      html += synergyBlock(defOfId('traveler'));
    } else if (TYPE_DESC[t.type]){
      html += `<div class="tip-note">${TYPE_DESC[t.type]}</div>`;
    }

    // 地产额外提示：地产大亨进度（只对持有者有意义，给持有者一行）
    if (t.type === 'prop' && owner !== undefined){
      const ty = defOfId('tycoon');
      const n = countOf(owner, ty);
      html += `<div class="tip-note">👑 地产大亨：${players[owner].name} ${Math.min(n, ty.n)}/${ty.n} 块地产${n >= ty.n ? '（已达成，租金 +20%）' : ''}</div>`;
    }
    return html;
  }

  function placeTip(ev){
    const w = TIP.offsetWidth, h = TIP.offsetHeight;
    let x = ev.clientX + 18, y = ev.clientY + 16;
    if (x + w > window.innerWidth - 8) x = Math.max(8, ev.clientX - w - 16);
    if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8);
    TIP.style.left = x + 'px'; TIP.style.top = y + 'px';
  }

  // 同组地块高亮：一眼看清“还差哪块”（车站则高亮全部车站）
  function hiGroup(i){
    document.querySelectorAll('.tile.syn-peer').forEach(el => el.classList.remove('syn-peer'));
    const t = TILES[i];
    if (!t) return;
    const key = t.group || (t.type === 'station' ? 'station' : null);
    if (!key) return;
    TILES.forEach((tt, j) => {
      if (j === i) return;
      if ((tt.group || (tt.type === 'station' ? 'station' : null)) === key){
        const el = $('tile' + j);
        if (el) el.classList.add('syn-peer');
      }
    });
  }
  function hideTip(){
    hoverIdx = -1;
    TIP.classList.add('hidden');
    document.querySelectorAll('.tile.syn-peer').forEach(el => el.classList.remove('syn-peer'));
  }

  let hoverIdx = -1;
  const boardEl = $('board');
  if (boardEl){
    boardEl.addEventListener('mouseover', e => {
      const el = e.target.closest && e.target.closest('.tile');
      if (!el || !/^tile\d+$/.test(el.id)) return;
      const i = +el.id.slice(4);
      if (i === hoverIdx) return;
      hoverIdx = i;
      if (document.querySelector('.overlay:not(.hidden)')){
        // 弹窗期间不打扰
        TIP.classList.add('hidden');
        return;
      }
      TIP.innerHTML = renderTip(i);
      TIP.classList.remove('hidden');
      placeTip(e);
      hiGroup(i);
    });
    boardEl.addEventListener('mousemove', e => {
      if (!TIP.classList.contains('hidden')) placeTip(e);
    });
    boardEl.addEventListener('mouseleave', hideTip);
  }
  document.addEventListener('mousedown', hideTip, true);

  // 测试钩子
  Game.synApi = { defs: SYNERGY_DEFS, tierOf, countOf, renderTip, hideTip };
});
