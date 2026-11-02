// ================================================================
// 模块：对局统计（m-stats）
// 顶栏「📊 统计」随时打开：
//   1. 资产曲线 —— 每回合开始时快照各玩家净资产（现金+地价+建筑），SVG 折线图
//   2. 最长垄断纪录 —— 连续持有同一整组的回合数（按回合粒度跟踪，破功即定格）
//   3. 当前资产排行
// 数据随存档保存（mods.stats），读档后曲线无缝续记。
// ================================================================
Game.use('stats', () => {
  const W = 470, H = 200, ML = 52, MR = 12, MT = 14, MB = 26;   // 图表尺寸与边距
  let curve = [];        // curve[k] = 第 k+1 回合开始时各玩家净资产快照
  let monoBest = {};     // pi -> { group, len, from, to }
  let monoCur = {};      // group -> { pi, from }（当前连续持有中）

  // ---------- 数据采集 ----------
  function snapshot(){
    curve.push(players.map(p => p.bankrupt ? 0 : netWorth(p)));
  }

  function groupOwner(g){
    const mates = TILES.map((t, k) => (t.type === 'prop' && t.group === g) ? k : -1).filter(k => k >= 0);
    if (!mates.length) return null;
    const o = tileOwner[mates[0]];
    if (o === undefined || players[o].bankrupt) return null;
    return mates.every(k => tileOwner[k] === o) ? o : null;
  }

  // roundNo = 刚结束的完整回合编号
  function trackMonopoly(roundNo){
    const groups = [...new Set(TILES.filter(t => t.type === 'prop').map(t => t.group))];
    groups.forEach(g => {
      const o = groupOwner(g);
      if (o !== null){
        if (!monoCur[g] || monoCur[g].pi !== o) monoCur[g] = { pi: o, from: roundNo };
        const len = roundNo - monoCur[g].from + 1;
        const b = monoBest[o];
        if (!b || len > b.len) monoBest[o] = { group: g, len, from: monoCur[g].from, to: roundNo };
      } else {
        delete monoCur[g];
      }
    });
  }

  // 第 1 回合开始时记初始快照；之后每推进一回合：快照新回合 + 结算上一回合垄断
  Game.onStart.push(() => snapshot());
  Game.onRound.push(r => { trackMonopoly(r - 1); snapshot(); });

  // ---------- 图表渲染 ----------
  function chartSVG(){
    const n = curve.length;
    if (!n) return '<p style="font-size:12px;color:#9C9789">暂无曲线数据，本局从下一回合开始记录。</p>';
    const iw = W - ML - MR, ih = H - MT - MB;
    const maxY = Math.max(2000, ...curve.flat()) * 1.08;
    const px = r => ML + (n === 1 ? iw / 2 : (r / (n - 1)) * iw);
    const py = v => MT + ih - (v / maxY) * ih;

    let grid = '';
    for (let k = 0; k <= 4; k++){
      const v = Math.round(maxY * k / 4);
      const y = py(v);
      grid += `<line x1="${ML}" y1="${y}" x2="${W - MR}" y2="${y}" stroke="#DCD4C3" stroke-width="1"/>` +
        `<text x="${ML - 6}" y="${y + 3.5}" text-anchor="end" font-size="9.5" fill="#9C9789">¥${v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k' : v}</text>`;
    }
    // x 轴回合刻度：回合多时隔 5 标一个
    const step = n > 12 ? 5 : 1;
    for (let r = 1; r <= n; r += step){
      grid += `<text x="${px(r - 1)}" y="${H - 8}" text-anchor="middle" font-size="9.5" fill="#9C9789">${r}</text>`;
    }
    let lines = '';
    players.forEach((p, pi) => {
      const pts = curve.map((row, k) => `${px(k)},${py(row[pi] || 0)}`).join(' ');
      lines += `<polyline points="${pts}" fill="none" stroke="${p.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;background:#F5F2E9;border:1px solid #DCD4C3;border-radius:10px">
      ${grid}${lines}
      <text x="${ML}" y="${MT - 3}" font-size="9.5" fill="#9C9789">净资产（¥）→</text>
    </svg>`;
  }

  // ---------- 面板 ----------
  function rankHTML(){
    const rows = players.map((p, pi) => ({ pi, p, worth: p.bankrupt ? 0 : netWorth(p) }))
      .sort((a, b) => b.worth - a.worth);
    const max = Math.max(1, ...rows.map(r => r.worth));
    return rows.map(r => `
      <div class="rank-row${r.p.bankrupt ? ' broke' : ''}">
        <span class="pdot" style="background:${r.p.color}"></span>
        <span class="rank-name">${r.p.name}${r.p.bankrupt ? '（破产）' : ''}</span>
        <div class="rank-track"><div class="rank-bar" style="width:${Math.round(r.worth / max * 100)}%;background:${r.p.color}"></div></div>
        <span class="rank-val">¥${r.worth}</span>
      </div>`).join('');
  }

  function monoHTML(){
    const entries = Object.entries(monoBest)
      .map(([pi, b]) => ({ pi, ...b }))
      .sort((a, b) => b.len - a.len);
    if (!entries.length) return '<p style="font-size:12px;color:#9C9789">本局还没有人达成垄断纪录（连续整回合持有同一组全部地产）。</p>';
    return entries.map(e => `
      <div class="mono-row">
        <span class="pdot" style="background:${players[e.pi].color}"></span>
        <b>${players[e.pi].name}</b>
        <span class="mono-group" style="background:${GROUP_COLORS[e.group] || '#B4B2A9'}">${e.group} 组</span>
        连续 <b>${e.len}</b> 回合<span style="color:#9C9789">（第 ${e.from}–${e.to} 回合）</span>
      </div>`).join('');
  }

  function openStats(){
    const legend = players.map(p =>
      `<span class="legend-item"><span class="pdot" style="background:${p.color}"></span>${p.name}</span>`).join('');
    $('statsBody').innerHTML = `
      <div class="stat-sec">资产曲线</div>
      <div class="legend">${legend}</div>
      ${chartSVG()}
      <div class="stat-sec">当前资产排行</div>
      ${rankHTML()}
      <div class="stat-sec">最长垄断纪录</div>
      ${monoHTML()}
      <p style="font-size:11px;color:#9C9789;margin-top:10px">数据在每个回合开始时自动记录，随存档保存。</p>`;
    $('statsModal').classList.remove('hidden');
  }

  // ---------- 存档 ----------
  Game.saveExtras.push(() => ({ stats: { curve, monoBest } }));
  Game.loadExtras.push(sv => {
    const m = sv.mods && sv.mods.stats;
    curve = (m && Array.isArray(m.curve)) ? m.curve : [];
    monoBest = (m && m.monoBest && typeof m.monoBest === 'object') ? m.monoBest : {};
    monoCur = {};
  });

  // ---------- 绑定（顶栏按钮，随时可看） ----------
  const btn = $('statsBtn');
  if (btn) btn.onclick = openStats;
  $('statsClose').onclick = () => $('statsModal').classList.add('hidden');

  // 测试钩子
  Game.statsApi = { snapshot, trackMonopoly, openStats, get curve(){ return curve; }, get monoBest(){ return monoBest; } };
});
