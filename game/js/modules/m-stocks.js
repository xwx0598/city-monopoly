// ================================================================
// 模块：城市股票（m-stocks）
// 4 家虚构公司，股价每回合随机漫步（±8%，偶发新闻 ±20%），
// 顶栏「📈 股市」随时可买卖（限自己回合），持仓计入净资产
// ——给落后者留翻盘窗口，领先者也得留防守仓位。
// 持仓随存档保存（mods.stocks）；破产即清仓。
// 核心钩子：netWorthExtras / onRound / turnStart / onStart。
// ================================================================
Game.use('stocks', () => {
  const COMPANIES = [
    { name:'星辰科技', icon:'📡' },
    { name:'蓝海航运', icon:'🚢' },
    { name:'云帆地产', icon:'🏗️' },
    { name:'铁港物流', icon:'🚂' },
  ];
  const BASE = 100, MIN_PRICE = 20, WAVE = 0.08, NEWS_CHANCE = 0.1, NEWS_AMP = 0.2;

  let prices = COMPANIES.map(() => BASE);
  let prev   = COMPANIES.map(() => BASE);
  let holdings = [];   // pi -> [n, n, n, n]

  const rowsOf = pi => {
    if (!holdings[pi]) holdings[pi] = COMPANIES.map(() => 0);
    return holdings[pi];
  };
  const valueOf = pi => rowsOf(pi).reduce((s, n, k) => s + n * prices[k], 0);
  const idxOf = p => players.indexOf(p);

  // ---------------- 行情推进（每回合） ----------------
  Game.onRound.push(() => {
    prev = prices.slice();
    prices = prices.map((v, k) => {
      let nv = Math.round(v * (1 + (Math.random() * 2 - 1) * WAVE));
      if (Math.random() < NEWS_CHANCE){                 // 偶发新闻：大涨大跌
        const up = Math.random() < 0.5;
        nv = Math.round(v * (1 + (up ? 1 : -1) * NEWS_AMP));
        log(`📰 新闻冲击：「${COMPANIES[k].name}」${up ? '利好' : '利空'}，股价${up ? '大涨' : '暴跌'}至 ¥${Math.max(MIN_PRICE, nv)}`, 'card');
      }
      return Math.max(MIN_PRICE, nv);
    });
    // 破产即清仓，避免破产者还挂着股票资产
    players.forEach((p, pi) => { if (p.bankrupt) rowsOf(pi).fill(0); });
    renderPlayers();
  });

  // ---------------- 净资产 ----------------
  Game.netWorthExtras.push(p => p.bankrupt ? 0 : valueOf(idxOf(p)));

  // ---------------- 交易 ----------------
  function canTrade(pi){
    return !gameOver && !busy && turn === pi && !players[pi].isAI && !players[pi].bankrupt;
  }

  function openStocks(pi){
    const render = () => {
      const p = players[pi];
      $('stockDesc').innerHTML =
        `现金 <b>¥${p.money}</b>　·　持仓市值 <b>¥${valueOf(pi)}</b>　·　每回合 ±8% 随机波动`;
      $('stockList').innerHTML = COMPANIES.map((c, k) => {
        const chg = prices[k] - prev[k];
        const pct = prev[k] ? (chg / prev[k] * 100) : 0;
        const arrow = chg > 0 ? '▲' : chg < 0 ? '▼' : '—';
        const col = chg > 0 ? '#A05752' : chg < 0 ? '#4F7A5E' : '#9C9789';   // 涨红跌绿
        const have = rowsOf(pi)[k];
        return `<div class="shop-item">
          <div class="si-ico">${c.icon}</div>
          <div class="si-main">
            <div class="si-name">${c.name}${have ? `<span class="si-have">持有 ${have} 股</span>` : ''}</div>
            <div class="si-desc">¥${prices[k]}　<span style="color:${col};font-weight:700">${arrow} ${chg > 0 ? '+' : ''}${chg}（${pct.toFixed(1)}%）</span></div>
          </div>
          <div class="si-btns">
            <button class="si-buy" data-k="${k}" data-act="buy" ${p.money >= prices[k] ? '' : 'disabled'}>买</button>
            <button class="si-buy" data-k="${k}" data-act="sell" ${have > 0 ? '' : 'disabled'}>卖</button>
          </div>
        </div>`;
      }).join('');
      $('stockList').querySelectorAll('.si-buy').forEach(btn => {
        btn.onclick = () => {
          const k = +btn.dataset.k, act = btn.dataset.act, p = players[pi];
          if (act === 'buy'){
            if (p.money < prices[k]) return;
            p.money -= prices[k];
            rowsOf(pi)[k]++;
            log(`📈 ${p.name} 买入「${COMPANIES[k].name}」1 股 @¥${prices[k]}`, 'card');
          } else {
            if (rowsOf(pi)[k] <= 0) return;
            rowsOf(pi)[k]--;
            p.money += prices[k];
            log(`📉 ${p.name} 卖出「${COMPANIES[k].name}」1 股 @¥${prices[k]}`, 'card');
          }
          renderPlayers();
          saveGame();
          render();
        };
      });
    };
    render();
    $('stockModal').classList.remove('hidden');
    $('stockClose').onclick = () => $('stockModal').classList.add('hidden');
  }

  function ensureBtn(){
    if (document.getElementById('stockBtn')) return;
    const host = document.querySelector('.topbar .actions');
    if (!host) return;
    const b = document.createElement('button');
    b.className = 'btn-ghost';
    b.id = 'stockBtn';
    b.textContent = '📈 股市';
    b.title = '买卖 4 家公司股票，持仓计入净资产；限自己回合交易';
    b.onclick = () => {
      if (gameOver) return;
      const open = document.getElementById('stockModal');
      if (open && !open.classList.contains('hidden')) return;
      if (!canTrade(turn)){ log('📈 只能在自己回合交易股票'); return; }
      openStocks(turn);
    };
    host.insertBefore(b, host.firstChild);
  }

  // ---------------- AI ----------------
  Game.turnStart.push(pi => {
    const p = players[pi];
    if (!p.isAI || p.bankrupt || gameOver) return;
    const rows = rowsOf(pi);
    // 止盈：股价 ≥ ¥150 分批卖
    rows.forEach((n, k) => {
      while (n > 0 && prices[k] >= 150){
        rows[k]--; n--;
        p.money += prices[k];
        log(`📉 ${p.name} 止盈卖出「${COMPANIES[k].name}」@¥${prices[k]}`, 'card');
      }
    });
    // 闲钱入股：现金 > ¥800 时拿出一部分买 1~3 股
    if (p.money > 800){
      const k = Math.floor(Math.random() * COMPANIES.length);
      const n = Math.min(3, Math.floor((p.money - 500) / prices[k]));
      if (n > 0){
        rows[k] += n;
        p.money -= n * prices[k];
        log(`📈 ${p.name} 买入「${COMPANIES[k].name}」×${n} @¥${prices[k]}`, 'card');
      }
    }
  });

  // ---------------- 存档 ----------------
  Game.saveExtras.push(() => ({ stocks: { prices: prices.slice(), prev: prev.slice(), holdings: holdings.map(r => (r || []).slice()) } }));
  Game.loadExtras.push(sv => {
    const m = sv.mods && sv.mods.stocks;
    if (!m || !Array.isArray(m.prices) || m.prices.length !== COMPANIES.length) return;
    prices = m.prices.map(v => Math.max(MIN_PRICE, +v || BASE));
    prev = (m.prev || prices).map(v => Math.max(MIN_PRICE, +v || BASE));
    holdings = players.map((_, pi) =>
      COMPANIES.map((_, k) => Math.max(0, Math.floor((m.holdings && m.holdings[pi] && m.holdings[pi][k]) || 0))));
  });

  Game.onStart.push(() => {
    prices = COMPANIES.map(() => BASE);
    prev = COMPANIES.map(() => BASE);
    holdings = players.map(() => COMPANIES.map(() => 0));
    ensureBtn();
    log('📈 城市股市开市：星辰科技 / 蓝海航运 / 云帆地产 / 铁港物流，发行价 ¥100，持仓计入净资产');
  });

  Game.stocksApi = { COMPANIES, prices: () => prices.slice(), rowsOf, valueOf, openStocks };
});
