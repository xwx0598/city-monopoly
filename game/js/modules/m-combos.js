// ================================================================
// 模块：地块组合效果（m-combos）
// 基础组合只看持有数量与建筑等级；后期可在此拓展触发型/事件型组合。
// 倍率全部通过 Game.rentFilters / Game.salaryFilters 叠加，不侵入核心。
// ================================================================
Game.use('combos', () => {
  const COMBO_DEFS = {
    airline: { name:'航线',      color:'#6E8598', desc:'拥有棋盘上全部车站 → 车站租金 ×2' },
    grid:    { name:'电网',      color:'#C79E6E', desc:'拥有全部电站/水厂 → 电力租金倍率 +4' },
    mall:    { name:'商业中心',  color:'#8E86A0', desc:'垄断某组且组内全部满级 → 组内租金再 ×1.5' },
    infra:   { name:'基建大亨',  color:'#5F6C78', desc:'同时拥有全部车站和全部电站 → 过起点工资 +¥100' },
  };
  function countType(pi, type){ return players[pi].props.filter(i => TILES[i].type === type).length; }
  function totalType(type){ return TILES.filter(t => t.type === type).length; }
  function playerCombos(pi){
    const c = [];
    const nSta = totalType('station'), nUti = totalType('utility');
    if (nSta > 0 && countType(pi, 'station') === nSta) c.push('airline');
    if (nUti > 0 && countType(pi, 'utility') === nUti) c.push('grid');
    // 商业中心：任意一组，垄断且全满级
    const groups = [...new Set(TILES.filter(t => t.type === 'prop').map(t => t.group))];
    if (groups.some(g => ownsWholeGroup(pi, g) &&
        TILES.every((t, i) => t.type !== 'prop' || t.group !== g || (tileLevel[i] || 0) === MAX_LEVEL))) c.push('mall');
    if (c.includes('airline') && c.includes('grid')) c.push('infra');
    return c;
  }

  // ---- 组合达成播报：首次渲染静默登记，之后新增才提示 ----
  const comboSeen = {};
  Game.afterRender.push(() => {
    players.forEach((p, pi) => {
      const now = p.bankrupt ? [] : playerCombos(pi);
      const seen = comboSeen[pi];
      if (seen === undefined){ comboSeen[pi] = now; return; }
      now.filter(id => !seen.includes(id)).forEach(id => {
        log(`✨ ${p.name} 达成组合「${COMBO_DEFS[id].name}」：${COMBO_DEFS[id].desc}`, 'good');
      });
      comboSeen[pi] = now;
    });
  });

  // ---- 玩家卡徽章 ----
  Game.badges.push(pi => playerCombos(pi).map(id =>
    `<span class="combo-tag" style="background:${COMBO_DEFS[id].color}">✦ ${COMBO_DEFS[id].name}</span>`).join(''));

  // ---- 租金倍率 ----
  Game.rentFilters.push((ownerPi, i, t, rent) => {
    const combos = playerCombos(ownerPi);
    let r = rent;
    if (t.type === 'station' && combos.includes('airline')) r *= 2;
    if (t.type === 'utility' && combos.includes('grid')) r += lastRoll * 4;   // 倍率 +4
    if (t.type === 'prop' && combos.includes('mall') &&
        TILES.every((tt, ii) => tt.type !== 'prop' || tt.group !== t.group || (tileLevel[ii] || 0) === MAX_LEVEL)) r *= 1.5;
    return r;
  });

  // ---- 工资加成（基建大亨） ----
  Game.salaryFilters.push((pi, salary) =>
    playerCombos(pi).includes('infra') ? salary + 100 : salary);
});
