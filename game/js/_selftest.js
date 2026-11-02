// ================================================================
// 城市大富翁 · 自检脚本（selftest）
// 只在 URL 带 ?selftest=1 时由 boot.js 按需注入，正常游玩不会加载这个文件。
//
// 它做三件事：
//   1. 托管「人类玩家」：自动点掉购买/机会卡/入狱/拍卖/资不抵债等弹窗，
//      该掷骰子时自动掷，把一局从头打到结束（AI 仍走自己的策略）。
//   2. 全程校验对局不变量：地产归属与 props 双向一致、等级/抵押合法、
//      破产者无资产、回合指针不落在破产者身上、存档可回读……
//   3. 把结果写成 <pre>SELFTESTBASE64:...</pre>，交给 tools/selftest.mjs 汇总。
//
// 手动用法：game.html?selftest=1&new=1&map=classic&mods=synergy&seed=7
//           （直接看页面右上角标题 PASS / FAIL，完整 JSON 在页面源码里）
// ================================================================
(function(){
  'use strict';
  const P = new URLSearchParams(location.search);
  if (P.get('selftest') !== '1') return;

  // ---------- 种子随机：同 seed 同结果，方便复现偶发 bug ----------
  // 注意：只接管 dice / 事件卡 / AI 决策；随机地图的布局在 beforeBoard 阶段已生成，
  //      要固定地图请显式传 map=classic|mini|metro。
  const SEED = parseInt(P.get('seed'), 10) || 0;
  if (SEED){
    let s = SEED >>> 0;
    Math.random = function(){
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- 结果收集 ----------
  const report = {
    cfg: { mode: GAME_MODE, ai: AI_COUNT, hotseat: HOTSEAT_N, map: MAP && MAP.name, tiles: TILES.length,
           mods: P.get('mods') || '', seed: SEED, loaded: Game._loaded.slice(), off: Game._off.slice() },
    ok: true, finished: false, endReason: '', round: 1, turns: 0,
    players: [], stats: { landing: {}, maxLevel: 0, clicks: 0, debts: 0, jails: 0, auctions: 0, buys: 0, items: 0, votes: 0, projects: 0, trail: [] },
    violations: [], warnings: [], errors: [], stall: null,
  };
  // 运行时错误（含异步链里被吞掉的 Promise 拒绝）是最隐蔽的一类 bug，必须抓
  window.addEventListener('error', e => {
    if (report.errors.length < 20) report.errors.push('error: ' + (e.message || e.type) + ' @' + (e.filename || '') + ':' + (e.lineno || ''));
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    if (report.errors.length < 20) report.errors.push('rejection: ' + ((r && (r.stack || r.message)) || String(r)).slice(0, 300));
  });
  const V = report.violations, W = report.warnings;
  const seenBad = new Set(), seenWarn = new Set(), countBad = {};
  // 同一类问题只留前 5 条：一处系统性错误不该刷屏把别的问题挤掉
  function pushUnique(list, seen, code, msg){
    countBad[code] = (countBad[code] || 0) + 1;
    const key = code + '|' + msg;
    if (seen.has(key) || countBad[code] > 5 || list.length >= 60) return;
    seen.add(key);
    list.push({ code, msg, round: round, turn: turn });
  }
  const bad  = (code, msg) => pushUnique(V, seenBad, code, msg);
  const warn = (code, msg) => pushUnique(W, seenWarn, code, msg);

  // ---------- 装载检查 ----------
  if (Game._failed.length) bad('MOD_FAILED', '模块装载失败：' + Game._failed.join(','));
  if ((P.get('mods') || '') === '0' && Game._loaded.length) bad('PURE_CORE_LEAK', '纯核心模式仍装载了：' + Game._loaded.join(','));
  if (P.get('mods') && P.get('mods').includes('synergy') && !Game.synApi) bad('SYN_MISSING', '请求了 synergy 但没拿到 synApi');

  // ---------- 落格覆盖率统计（包一层 handler 计数，不改变行为） ----------
  Object.keys(Game.tileHandlers).forEach(k => {
    const orig = Game.tileHandlers[k];
    if (typeof orig !== 'function') return;
    Game.tileHandlers[k] = function(){
      report.stats.landing[k] = (report.stats.landing[k] || 0) + 1;
      return orig.apply(this, arguments);
    };
  });

  // ---------- 不变量校验 ----------
  const OWNABLE = { prop: 1, station: 1, utility: 1 };

  function checkCore(){
    if (!Array.isArray(players) || !players.length) return bad('NO_PLAYERS', 'players 为空');

    players.forEach((p, pi) => {
      if (!Number.isFinite(p.money)) bad('MONEY_NAN', `${p.name} 现金非法：${p.money}`);
      if (!Number.isInteger(p.pos) || p.pos < 0 || p.pos >= TILES.length) bad('POS_RANGE', `${p.name} 位置越界：${p.pos}`);
      if (p.bankrupt){
        if (p.money !== 0) bad('BANKRUPT_CASH', `${p.name} 已破产但现金 ${p.money}`);
        if (p.props.length) bad('BANKRUPT_HAS_PROPS', `${p.name} 已破产但还挂着 ${p.props.length} 块地`);
      } else if (p.money < 0){
        bad('NEGATIVE_CASH', `${p.name} 现金为负 ${p.money}`);
      }
      const seen = new Set();
      p.props.forEach(i => {
        if (!TILES[i]) return bad('PROP_INDEX', `${p.name} 持有不存在的地块 ${i}`);
        if (seen.has(i)) bad('PROP_DUP', `${p.name} 重复持有「${TILES[i].name}」`);
        seen.add(i);
        if (tileOwner[i] !== pi) bad('OWNER_MISMATCH', `「${TILES[i].name}」在 ${p.name} 的 props 里，但 owner=${tileOwner[i]}`);
        if (!OWNABLE[TILES[i].type]) bad('PROP_NOT_OWNABLE', `${p.name} 持有不可购买的「${TILES[i].name}」`);
        const lv = tileLevel[i] || 0;
        if (!Number.isInteger(lv) || lv < 0 || lv > MAX_LEVEL) bad('LEVEL_RANGE', `「${TILES[i].name}」等级 ${lv}`);
        if (tileMortgaged[i] && lv > 0) bad('MORTGAGED_WITH_HOUSE', `「${TILES[i].name}」抵押中却还有 ${lv} 级建筑`);
        if (lv > report.stats.maxLevel) report.stats.maxLevel = lv;
      });
    });

    Object.keys(tileOwner).forEach(k => {
      const i = +k, o = tileOwner[k];
      if (!TILES[i]) return bad('OWNER_TILE_INVALID', `tileOwner 指向不存在的格 ${i}`);
      if (!OWNABLE[TILES[i].type]) bad('OWNER_NON_OWNABLE', `不可购买地块「${TILES[i].name}」被占`);
      const ow = players[o];
      if (!ow) return bad('OWNER_INVALID', `「${TILES[i].name}」owner=${o} 不存在`);
      if (ow.bankrupt) bad('BANKRUPT_OWNS', `破产的 ${ow.name} 仍持有「${TILES[i].name}」`);
      if (!ow.props.includes(i)) bad('OWNER_MISSING_IN_PROPS', `「${TILES[i].name}」owner=${ow.name} 但 props 里没有`);
    });

    Object.keys(tileMortgaged).forEach(k => {
      if (tileMortgaged[k] && tileOwner[k] === undefined) bad('MORTGAGED_UNOWNED', `「${TILES[k].name}」无主却处于抵押`);
    });

    if (!gameOver){
      if (!players[turn]) bad('TURN_INVALID', `turn=${turn} 越界`);
      else if (players[turn].bankrupt) bad('TURN_ON_BANKRUPT', `轮到已破产的 ${players[turn].name}`);
      if (round < 1 || round > MAX_ROUNDS) bad('ROUND_RANGE', `回合数 ${round} 越界`);
    }

    // 羁绊阶级合法性
    if (Game.synApi && Array.isArray(Game.synApi.defs)){
      Game.synApi.defs.forEach(d => {
        players.forEach((p, pi) => {
          const t = Game.synApi.tierOf(pi, d);
          if (!(t === 0 || t === 1 || t === 2)) bad('SYN_TIER_RANGE', `${p.name}·${d.name} 阶级 ${t}`);
          else if (t > (d.tiers || []).length) bad('SYN_TIER_OVERFLOW', `${p.name}·${d.name} 阶级 ${t} 超过定义 ${(d.tiers || []).length}`);
        });
      });
    }
  }

  // ---------- 存档回读（第 3 回合做一次，避免每回合写盘拖慢） ----------
  // 联机对局不落本地存档（状态走网络同步），跳过这一组断言
  let saveChecked = GAME_MODE === 'mp';
  const SAVE_KEY2 = 'monopoly_save_v3_' + (GAME_MODE === 'ai' ? 'ai' : 'hotseat' + HOTSEAT_N);
  function checkSave(){
    if (saveChecked || gameOver || round < 3) return;
    saveChecked = true;
    let sv = null;
    try {
      saveGame();
      const raw = localStorage.getItem(SAVE_KEY2);
      sv = raw ? JSON.parse(raw) : null;
    } catch(e){ return bad('SAVE_THROW', '写入存档异常：' + e.message); }
    if (!sv) return bad('SAVE_MISSING', '存档缺失');
    if (sv.players.length !== players.length) return bad('SAVE_PLAYER_COUNT', '存档玩家数与内存不一致');
    if (sv.round !== round) bad('SAVE_ROUND', `存档回合 ${sv.round} ≠ 内存 ${round}`);
    players.forEach((p, pi) => {
      if (sv.players[pi].money !== p.money) bad('SAVE_MONEY', `${p.name} 存档现金 ${sv.players[pi].money} ≠ ${p.money}`);
      if (sv.players[pi].pos !== p.pos) bad('SAVE_POS', `${p.name} 存档位置不一致`);
      if (sv.players[pi].props.length !== p.props.length) bad('SAVE_PROPS', `${p.name} 存档地产数不一致`);
    });
    Object.keys(tileOwner).forEach(k => {
      if (sv.tileOwner[k] !== tileOwner[k]) bad('SAVE_OWNER', `「${TILES[k].name}」存档归属不一致`);
    });
    if ((sv.opt || '') !== (P.get('mods') || '')) bad('SAVE_OPT', `存档 opt=${sv.opt} 与 URL mods 不一致`);
    // 有持久状态的玩法必须把状态写进存档（否则续档功能形同虚设）
    const SAVEFUL = { stats: 1, weather: 1, items: 1, stocks: 1, quests: 1, visit: 1, vote: 1 };
    (P.get('mods') || '').split(',').filter(m => m && m !== '0' && SAVEFUL[m]).forEach(m => {
      if (!sv.mods || sv.mods[m] === undefined) bad('SAVE_MOD_STATE', `存档缺少 ${m} 的模块状态`);
    });
  }

  // ---------- DOM 一致性（节流执行） ----------
  let domCount = 0;
  function checkDom(){
    TILES.forEach((t, i) => {
      if (!t.price) return;
      const el = document.getElementById('tile' + i);
      if (!el) return bad('TILE_MISSING', `第 ${i} 格「${t.name}」没有渲染出来`);
      if (!el.querySelector('.tprice')) bad('PRICE_HIDDEN', `「${t.name}」缺价格标签`);
    });
    const dots = document.querySelectorAll('.tile .owner-dot').length;
    const owned = Object.keys(tileOwner).length;
    if (dots !== owned) warn('DOT_MISMATCH', `归属圆点 ${dots} 个，实际归属 ${owned} 块`);
    const board = document.getElementById('board');
    const side = document.querySelector('.sidebar');
    if (board && side){
      // 只量棋盘本体：#boardWrap 的布局盒比 3D 投影后的可见棋盘大，拿它比会假报重叠
      const a = board.getBoundingClientRect(), b = side.getBoundingClientRect();
      if (a.right > b.left + 2 && a.bottom > b.top + 2) warn('LAYOUT_OVERLAP', `棋盘右边界 ${Math.round(a.right)} 压到面板左边界 ${Math.round(b.left)}`);
      if (a.width < 200) warn('BOARD_TOO_SMALL', `棋盘宽度只有 ${Math.round(a.width)}px`);
    }
  }

  // ---------- 自动操作：把人能点的都点掉 ----------
  const OVERLAYS = ['buyModal','cardModal','noticeModal','debtModal','jailModal','auctionModal',
                    'tradeModal','buildModal','resumeModal','statsModal','gameOverModal','synModal',
                    'shopModal','useModal','stockModal','visitModal','voteModal'];
  const lastAct = {};             // overlayId -> { sig, tick, ticks } 上一次操作的内容签名与时刻
  let drainGuard = false;
  let debtKey = '';
  let debtStage = 0;

  function sigOf(el){
    // 必须覆盖「会变的部分」：拍卖的叫价、玩家、按钮上的出价都在变；
    // 只看标题/长度会把「同一拍卖里又轮到我」误判成已处理过，直接把流程卡死。
    const parts = [];
    const h = el.querySelector('h3');
    if (h) parts.push(h.textContent);
    el.querySelectorAll('p').forEach(p => parts.push(p.textContent));
    const b10 = el.querySelector('#aucB10');
    if (b10) parts.push(b10.textContent);
    return parts.join('|');
  }
  function click(id){
    const el = document.getElementById(id);
    if (!el || el.disabled) return false;
    el.click();
    report.stats.clicks++;
    report.stats.trail.push(`${round}/${turn}:${id}`);
    if (report.stats.trail.length > 40) report.stats.trail.shift();
    return true;
  }
  // 资不抵债：先尝试变卖（覆盖 openBuildModal 分支），实在凑不出再破产
  function handleDebt(){
    const k = round + '/' + turn + '/' + (players[turn] ? players[turn].money : '?');
    if (k === debtKey && debtStage >= 1){
      report.stats.debts++;
      click('debtBust');
      return;
    }
    debtKey = k; debtStage = 1;
    if (!click('debtSell')) click('debtBust');
  }
  function handleBuildModal(){
    // 债务变卖：把能卖的房子/能抵押的地依次处理掉，卖无可卖再关窗。
    // 这个弹窗内部点一次就重渲染一次（文案不变），所以不能用内容签名去重，每次 tick 都进来推进一步。
    const btns = [...document.querySelectorAll('#buildList button[data-i]')]
      .filter(b => !b.disabled && (b.classList.contains('sell') || b.classList.contains('mtg')));
    if (btns.length){ btns[0].click(); report.stats.clicks++; return; }
    if (!click('buildClose')) bad('BUILD_CLOSE_DEAD', '资产管理弹窗关不掉');
  }

  function drain(){
    if (drainGuard) return;
    drainGuard = true;
    try {
      OVERLAYS.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.classList.contains('hidden')){ lastAct[id] = null; return; }
        // 资产管理弹窗点一次内部就重渲染一次、文案却不变，不能参与签名去重，每 tick 推进一步
        if (id === 'buildModal'){ handleBuildModal(); return; }
        if (id === 'gameOverModal'){ finalize('gameover'); return; }
        const s = sigOf(el);
        // 冷却式去重：同一内容 3 个 tick（约 120ms 虚拟时间）内不重复点，避免连点。
        // 但不能像以前那样「点过一次就永久跳过」——债务弹窗会在同一个 tick 内隐藏又重现，
        // 永久去重会把流程锁死（这种情况其实还等着我们再点一次「宣告破产」）。
        let rec = lastAct[id];
        if (!rec || rec.sig !== s) rec = lastAct[id] = { sig: s, tick: -99, ticks: 0 };
        rec.ticks++;
        if (rec.ticks === 300) bad('MODAL_STUCK', `「${id}」弹窗 12 秒内容未变，可能流程走不下去`);
        if (tickCount - rec.tick < 3) return;
        rec.tick = tickCount;
        switch (id){
          case 'gameOverModal': finalize('gameover'); break;
          case 'buyModal': {
            const box = document.getElementById('buyDesc');
            const txt = box ? box.textContent : '';
            const m = txt.match(/买下后剩余\s*¥(-?\d+)/);
            const remain = m ? parseInt(m[1], 10) : 0;
            const isInsurance = /保险/.test(document.getElementById('buyTitle').textContent || '');
            // 保险只要留够 ¥250 就买；地产留够 ¥250 才买，否则三成概率捡漏
            const want = isInsurance ? remain >= 250 : (remain >= 250 || Math.random() < 0.3);
            if (!want && !isInsurance){ click('buyNo'); break; }
            if (!click('buyYes')) click('buyNo');
            break;
          }
          case 'cardModal': click('cardOk'); break;
          case 'noticeModal': click('noticeOk'); break;
          case 'debtModal': handleDebt(); break;
          case 'jailModal': {
            report.stats.jails++;
            if (!click('jailBail')) click('jailRoll');
            break;
          }
          case 'auctionModal': {
            // 只按标价附近出价，否则机器人会把 1500 现金一路 +10 加到满仓，拍卖拖成死循环
            const info = (document.getElementById('aucInfo') || {}).textContent || '';
            const pm = info.match(/标价\s*¥(\d+)/);
            const list = pm ? parseInt(pm[1], 10) : 0;
            const cur = (document.getElementById('aucB10') || {}).textContent || '';
            const bm = cur.match(/¥(\d+)/);
            const base = bm ? parseInt(bm[1], 10) : 0;
            let acted = false;
            if (list && base <= list * 1.15 && Math.random() < 0.6) acted = click('aucB10');
            // 现金不够时 aucB10 是禁用的：此时必须弃拍，否则拍卖永远停在「轮到你」
            if (!acted) click('aucPass');
            break;
          }
          case 'buildModal': handleBuildModal(); break;
          case 'tradeModal': {
            const no = document.querySelector('#tradeBtns .btn-no');
            if (no) no.click();
            break;
          }
          case 'shopModal': {
            // 有钱就随机买一件，没钱/买不了就离店
            const buys = [...document.querySelectorAll('#shopList .si-buy:not([disabled])')];
            if (buys.length && Math.random() < 0.7){ buys[Math.floor(Math.random() * buys.length)].click(); report.stats.buys++; }
            else click('shopClose');
            break;
          }
          case 'useModal': click('useClose'); break;
          case 'stockModal': click('stockClose'); break;
          case 'voteModal': {
            // 六成赞成（公共设施对 AI/人都是长期利好）
            if (Math.random() < 0.6) click('voteYes');
            else click('voteNo');
            break;
          }
          case 'visitModal': {
            // 三成概率捞人（选列表第一个），否则不捞
            const bail = document.querySelector('#visitList .tgt');
            if (bail && Math.random() < 0.3) bail.click();
            else click('visitClose');
            break;
          }
          case 'statsModal': click('statsClose'); break;
          case 'synModal': click('synClose'); break;
          case 'resumeModal': click('resumeNo'); break;
        }
      });
    } finally { drainGuard = false; }
  }

  function anyModalOpen(){
    return OVERLAYS.some(id => {
      const el = document.getElementById(id);
      return el && !el.classList.contains('hidden');
    });
  }

  // ---------- 主循环 ----------
  let tickCount = 0, lastProgress = 0, lastTurnKey = '', turnCounter = 0, done = false, prevAucOpen = false;

  function tick(){
    if (done) return;
    tickCount++;
    drain();

    // 进度指纹：回合/现金/归属/拍卖叫价任一变化都算「还在动」，避免把长拍卖误判成死锁
    const aucEl = document.getElementById('auctionModal');
    const aucOpen = !!(aucEl && !aucEl.classList.contains('hidden'));
    if (aucOpen && !prevAucOpen) report.stats.auctions++;   // 一场新拍卖（不是叫价轮次）
    prevAucOpen = aucOpen;
    const aucLive = aucOpen ? ((document.getElementById('aucCur') || {}).textContent || '') : '';
    const key = round + '|' + turn + '|' + (players[turn] ? players[turn].money : '') + '|' +
                Object.keys(tileOwner).length + '|' + aucLive;
    if (key !== lastTurnKey){ lastTurnKey = key; lastProgress = tickCount; turnCounter++; }
    report.turns = turnCounter;

    if (gameOver){ finalize('gameover'); return; }

    // 轮到人类玩家时替他掷骰子；有弹窗、正在结算、或按钮被禁用时不动作
    if (!anyModalOpen() && !busy){
      const rb = document.getElementById('rollBtn');
      if (rb && !rb.disabled){ rb.click(); report.stats.clicks++; }
    }

    checkCore();
    if (tickCount % 25 === 0) checkDom();
    checkSave();

    // 死锁保护：60 秒虚拟时间没有任何状态变化就收尾，别把 --virtual-time-budget 耗干
    if (tickCount - lastProgress > 1500){
      // 联机：等待对手行动不算卡死（对手可能在做一长串操作），把计时往后推
      if (GAME_MODE === 'mp' && turn !== MP_SEAT){ lastProgress = tickCount; return; }
      // 留一份现场：卡在哪个弹窗、按钮状态、最后几条日志，方便直接定位
      const open = OVERLAYS.filter(id => { const el = document.getElementById(id); return el && !el.classList.contains('hidden'); });
      const rb = document.getElementById('rollBtn');
      const extra = {};
      const ac = document.getElementById('aucCur');
      if (ac) extra.aucCur = ac.textContent;
      const bc = document.getElementById('buyTitle');
      if (bc) extra.buyTitle = bc.textContent;
      const dd = document.getElementById('debtDesc');
      if (dd) extra.debtDesc = dd.textContent;
      const bd = document.getElementById('buyDesc');
      if (bd) extra.buyDesc = bd.textContent.slice(0, 120);
      extra.btns = ['aucB10','aucB50','aucB100','aucPass','buyYes','buyNo','jailBail','jailRoll','debtSell','debtBust']
        .map(id => { const b = document.getElementById(id); return b ? `${id}:${b.disabled ? 'X' : 'o'}${b.textContent.slice(0,6)}` : ''; })
        .filter(Boolean);
      report.stall = {
        openModals: open, rollDisabled: rb ? rb.disabled : null, busy: !!busy,
        owned: Object.keys(tileOwner).length, extra,
        trail: report.stats.trail.slice(),
        log: [...document.querySelectorAll('#log > div')].slice(-15).map(d => d.textContent),
      };
      finalize('stalled');
    }
  }

  function toB64(str){
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function finalize(reason){
    try {
      if (Game.itemsApi) report.stats.items = players.reduce((s2, _, pi) => s2 + Game.itemsApi.totalItems(pi), 0);
      if (Game.voteApi){
        report.stats.votes = Game.voteApi.proposed().length;
        report.stats.projects = Game.voteApi.active().length;
      }
    } catch(e){}
    if (done) return;
    done = true;
    clearInterval(timer);
    report.endReason = reason;
    report.finished = reason === 'gameover';
    report.round = round;
    report.players = players.map(p => ({
      name: p.name, money: p.money, bankrupt: !!p.bankrupt, net: netWorth(p),
      props: p.props.length, levels: p.props.reduce((s, i) => s + (tileLevel[i] || 0), 0),
    }));
    report.ok = report.violations.length === 0;
    let json;
    try { json = JSON.stringify(report); }
    catch(e){ json = JSON.stringify({ ok: false, violations: [{ code: 'REPORT_JSON', msg: e.message }] }); }
    const pre = document.createElement('pre');
    pre.id = '__selftest';
    pre.style.display = 'none';
    pre.textContent = 'SELFTESTBASE64:' + toB64(json);
    document.body.appendChild(pre);
    document.title = 'SELFTEST ' + (report.ok ? 'PASS' : 'FAIL') + ' r' + round;
  }

  const timer = setInterval(tick, 40);
  // 兜底：万一 setInterval 被虚拟时间吃掉，用超时再收一次尾
  setTimeout(() => { if (!done) finalize('timeout'); }, 600000);
})();
