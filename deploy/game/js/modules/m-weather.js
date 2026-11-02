// ================================================================
// 模块：天气/新闻系统（m-weather）——可选玩法，大厅开关后经 ?mods=weather 启用
// 每 3 回合全城换一次天气，效果通过既有钩子按「时间窗」叠加：
//   连绵雨季：全城租金 -20%
//   旅游旺季：经过起点工资 +50%
//   全城停电：有建筑的地产租金 -40%（空地照常，停电只能省电费）
//   施工季　：全城建造费 +25%
//   城市庆典：全城租金 +20%
// 晴朗为兜底状态。开局前 3 回合强制晴朗，保证开局公平。
// 状态存 mods.weather；模块关闭时棋盘不显示徽章、钩子不注册，零影响。
// ================================================================
Game.use('weather', () => {
  const DURATION = 3;                       // 每种天气持续的回合数
  const CALM_UNTIL = 4;                     // 第 4 回合起才开始变天
  const WEATHERS = [
    { id:'sunny',    icon:'☀️', name:'晴朗',     desc:'风和日丽，一切照常',          weight:34 },
    { id:'rain',     icon:'🌧️', name:'连绵雨季', desc:'全城租金 -20%',               weight:12 },
    { id:'peak',     icon:'🏖️', name:'旅游旺季', desc:'经过起点工资 +50%',           weight:12 },
    { id:'blackout', icon:'🔌', name:'全城停电', desc:'有建筑的地产租金 -40%',       weight:12 },
    { id:'rebuild',  icon:'🚧', name:'施工季',   desc:'全城建造费 +25%',             weight:12 },
    { id:'carnival', icon:'🎪', name:'城市庆典', desc:'全城租金 +20%，趁势收租吧',   weight:12 },
  ];
  const byId = id => WEATHERS.find(w => w.id === id) || WEATHERS[0];

  // ---- 状态（可从存档恢复）----
  let state = { id:'sunny', until: CALM_UNTIL };
  const cur = () => byId(state.id);

  // ---- 抽取下一种天气：按权重，且不与当前重复 ----
  function pick(){
    const pool = WEATHERS.filter(w => w.id !== state.id);
    const total = pool.reduce((s, w) => s + w.weight, 0);
    let r = Math.random() * total;
    for (const w of pool){ r -= w.weight; if (r <= 0) return w; }
    return pool[0];
  }

  // ---- 效果钩子（时间窗内才生效）----
  Game.rentFilters.push((o, i, t, r) => {
    const w = cur();
    if (w.id === 'rain') return Math.round(r * 0.8);
    if (w.id === 'carnival') return Math.round(r * 1.2);
    if (w.id === 'blackout' && (tileLevel[i] || 0) > 0) return Math.round(r * 0.6);
    return r;
  });
  Game.salaryFilters.push((pi, s) => cur().id === 'peak' ? Math.round(s * 1.5) : s);
  Game.buildCostFilters.push((pi, c) => cur().id === 'rebuild' ? Math.round(c * 1.25) : c);

  // ---- 回合推进：到点换天气 ----
  Game.onRound.push(r => {
    if (r < state.until) { render(); return; }
    const w = pick();
    state = { id: w.id, until: r + DURATION };
    log(`${w.icon} 天气播报：${w.name}——${w.desc}（持续 ${DURATION} 回合）`, 'card');
    render();
  });

  // ---- 棋盘徽章 ----
  function render(){
    const w = cur();
    const left = Math.max(0, state.until - round);
    let chip = document.getElementById('weatherChip');
    if (!chip){
      chip = document.createElement('div');
      chip.id = 'weatherChip';
      const anchor = document.getElementById('roundInfo');
      if (anchor) anchor.insertAdjacentElement('beforebegin', chip);
      else return;                      // 棋盘未就绪，下次再插
    }
    chip.textContent = `${w.icon} ${w.name}`;
    chip.title = `${w.desc}\n${w.id === 'sunny' ? '' : `还剩 ${left} 回合`}`;
  }

  // ---- 存档（saveExtras 契约：返回要并入 sv.mods 的对象）----
  Game.saveExtras.push(() => ({ weather: state }));
  Game.loadExtras.push(sv => {
    if (sv.mods && sv.mods.weather && byId(sv.mods.weather.id).id === sv.mods.weather.id){
      state = sv.mods.weather;
    }
  });

  Game.onStart.push(render);
  log('🌦️ 天气系统已启用：每 3 回合全城换一次天气，留意播报把握收租与施工时机');
});
