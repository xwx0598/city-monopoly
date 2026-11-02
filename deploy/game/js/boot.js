// ================================================================
// 城市大富翁 · 启动引导（boot）
// 所有模块已注册完毕，这里按顺序初始化棋盘、恢复存档、开始对局。
// ================================================================
(function(){
  if (QS.get('new') === '1') clearSave();
  const bootSave = loadSave();

  // 模块先决定地图（存档地图 > URL 参数 > 预设），再渲染棋盘
  Game.beforeBoard.forEach(f => { try { f(bootSave); } catch(e){ console.warn(e); } });
  if (!MAP) Game.applyMap(Game.DEFAULT_MAP);

  buildBoard();
  initTokens();
  makeDie($('die1'));
  makeDie($('die2'));
  setDie($('die1'), 3);
  setDie($('die2'), 4);
  renderPlayers();
  positionTokens();
  updateRound();
  $('modeLabel').textContent = (GAME_MODE === 'ai' ? '单机 vs AI' : `本地同屏 ${HOTSEAT_N} 人`) + ` · ${MAP.name} · 本地存档`;

  function fitBoard(){
    const wrap = $('boardWrap');
    const vw = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
    // 桌面端适当放大棋盘（3D 倾斜后视觉会缩小，放一点更有桌游存在感）
    const avail = vw >= 900 ? Math.min(660, vw - 400) : Math.max(260, vw - 36);
    const scale = Math.min(1.2, avail / 530);
    wrap.style.transform = `scale(${scale})`;
    wrap.style.height = (530 * scale) + 'px';
    wrap.style.width = (530 * scale) + 'px';
    // perspective 投影会把棋盘近端（底边两角）放大约 9%，左右各留出等宽内边距，
    // 让溢出落在自己的留白里而不是压到旁边面板；棋盘本身不缩小，布局向两边撑满
    const pad = Math.ceil(26 * scale);
    wrap.style.margin = `0 ${pad}px`;
  }
  window.addEventListener('resize', fitBoard);
  fitBoard();

  $('rollBtn').onclick = rollDice;
  $('buildBtn').onclick = () => openBuildModal(turn);   // 关闭回调由 openBuildModal 内部绑定
  $('newGameBtn').onclick = () => { if (confirm('确定放弃当前对局，重新开始吗？')) { clearSave(); location.reload(); } };
  $('restartBtn').onclick = () => { clearSave(); location.reload(); };

  function applySaveState(sv){
    Game.loadExtras.forEach(f => { try { f(sv); } catch(e){ console.warn(e); } });
    sv.players.forEach((sp, i) => {
      players[i].money = sp.money;
      players[i].pos = sp.pos;
      players[i].props = [...sp.props];
      players[i].bankrupt = sp.bankrupt;
      players[i].skip = sp.skip || 0;
      players[i].jail = sp.jail || 0;
      players[i].jailCard = sp.jailCard || 0;
      players[i].insured = sp.insured || 0;
    });
    tileOwner = { ...sv.tileOwner };
    tileLevel = { ...(sv.levels || {}) };
    tileMortgaged = { ...(sv.mortgaged || {}) };
    turn = sv.turn; round = sv.round;
    for (let i = 0; i < TILES.length; i++) refreshTile(i);
    renderPlayers(); positionTokens(); updateRound();
    const pp = players[turn];
    $('turnInfo').textContent = pp.isAI ? `${pp.name} 思考中…` : `轮到 ${pp.name} 行动`;
    if (!pp.isAI){ $('rollBtn').disabled = false; updateBuildBtn(); }
  }

  const saved = loadSave();

  // 大厅点「继续存档」带 autoload=1 进来：直接进局，不再二次确认
  if (saved && QS.get('autoload') === '1'){
    applySaveState(saved);
    log(`📂 已读取存档 · 第 ${saved.round} 回合，继续对局`, 'good');
    if (players[turn].isAI){
      busy = true;
      setTimeout(() => { busy = false; rollDice(); }, 800);
    }
  } else if (saved){
    applySaveState(saved);

    const d = new Date(saved.savedAt), pad = n => String(n).padStart(2,'0');
    $('resumeDesc').textContent = `存档时间 ${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}　|　第 ${saved.round} 回合`;
    $('resumeModal').classList.remove('hidden');
    $('resumeYes').onclick = () => {
      $('resumeModal').classList.add('hidden');
      log('📂 已读取本地存档，继续对局', 'good');
      if (players[turn].isAI){
        busy = true;
        setTimeout(() => { busy = false; rollDice(); }, 800);
      }
    };
    $('resumeNo').onclick = () => { clearSave(); location.reload(); };
  } else {
    $('rollBtn').disabled = false;
    log(`🗺️ 地图：${MAP.name}（${TILES.length} 格，${TILES.filter(t => t.type === 'prop').length} 块地产）`);
    log(`🎮 对局开始！${GAME_MODE === 'ai' ? `你和 ${AI_COUNT} 位 AI 各有 ¥1500` : `${HOTSEAT_N} 位玩家各 ¥1500`}，30 回合内总资产最高者获胜。`);
    log('🏗️ 买下地产后点「资产管理」可升级（同组均衡建设）、抵押或出售；抵押中免收租，赎回加 10% 利息。');
    log(`💾 每回合自动存档，中途退出后可继续对局。`);
    Game.onStart.forEach(f => { try { f(); } catch(e){} });
    updateBuildBtn();
  }

  // 模块装载状态汇报：哪个坏了会直接写在日志里，但游戏照常能玩
  const parts = [];
  if (Game._loaded.length) parts.push('已装载：' + Game._loaded.join('、'));
  if (Game._off.length) parts.push('未启用：' + Game._off.join('、'));
  if (Game._failed.length) parts.push('⚠️ 装载失败：' + Game._failed.join('、'));
  log('🧩 ' + (parts.join('；') || '纯核心模式（未装载任何玩法模块）'), Game._failed.length ? 'bad' : '');
})();
