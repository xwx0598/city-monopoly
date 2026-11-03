// ================================================================
// 城市大富翁 · 联机同步层（mode=mp 时由 game.html 引入）
// 思路：每个玩家都在自己的浏览器里跑完整引擎，但只有「轮到自己」时才能操作；
//       行动者的每一次状态变化都会把全量快照广播给其他人，其他人直接套用重绘。
//       规则只有 core.js 一份，服务端（deploy/mp.py）只做座位表和消息转发。
// ================================================================
(function(){
  if (typeof GAME_MODE === 'undefined' || GAME_MODE !== 'mp') return;

  const ROOM = QS.get('room') || '';
  const MY_SEAT = parseInt(QS.get('seat'), 10);
  if (!ROOM || !Number.isFinite(MY_SEAT)) return;

  let ws = null;
  let ready = false;
  let lastSync = 0;
  let syncTimer = null;
  let gotState = false;          // 是否已经收到过一次对局状态
  const pending = [];            // 连接建立前攒下的消息

  // ---- 断线托管：服务端广播座位连接表，全员一致推举「最小在线座位」当驱动者 ----
  const ALL_SEATS = (QS.get('seats') || '0,1').split(',').map(n => parseInt(n, 10)).filter(Number.isFinite);
  const connected = new Set(ALL_SEATS);   // 开局时人人在线，roster 事件负责更新
  const hosted = new Set();               // 断线待托管的座位

  function amDriving(){
    if (!connected.has(MY_SEAT)) return false;
    let min = Infinity;
    connected.forEach(s => { if (s < min) min = s; });
    return MY_SEAT === min;
  }
  const hostedSeat = pi => hosted.has(pi);

  function wsUrl(){
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + '/ws';
  }

  let sentCount = 0, dropCount = 0;
  function send(obj){
    if (ws && ws.readyState === 1){ try { ws.send(JSON.stringify(obj)); sentCount++; } catch(e){ dropCount++; } }
    else pending.push(obj);
  }

  function connect(){
    try { ws = new WebSocket(wsUrl()); }
    catch (e){ log('⚠️ 联机连接失败，2 秒后重试', 'bad'); setTimeout(connect, 2000); return; }

    ws.onopen = () => {
      const me = players[MP_SEAT];
      send({ t: 'hi', name: me ? me.name : '玩家' });
      send({ t: 'resume', id: ROOM, seat: MY_SEAT });
      while (pending.length) send(pending.shift());
    };
    ws.onclose = () => {
      ready = false;
      log('⚠️ 与房间服务断开，正在重连…', 'bad');
      setTimeout(connect, 2000);
    };
    ws.onerror = () => { /* onclose 会跟着来 */ };
    ws.onmessage = ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e){ return; }
      handle(m);
    };
  }

  function handle(m){
    switch (m.t){
      case 'joined':
        ready = true;
        if (m.room && m.room.status === 'playing') send({ t: 'state_req' });
        break;
      case 'game_live':
        send({ t: 'state_req' });      // 进页面前对局已经开过：先要一份最新状态
        break;
      case 'state_req':
        // 有人（重新）进来了，把当前状态原样广播一份
        sync(true);
        break;
      case 'state':
        apply(m.data);
        break;
      case 'peer_left':
        if (gotState) log(`👋 ${m.name || '有玩家'} 掉线了`, 'bad');
        break;
      case 'roster':
        applyRoster(m);
        break;
      case 'err':
        log('⚠️ ' + (m.msg || '联机消息异常'), 'bad');
        break;
    }
  }

  // ---- 托管：连接表变化 → 更新集合、恢复/接管 isAI、必要时触发代打 ----
  function applyRoster(m){
    const wasHosted = new Set(hosted);
    // 连接表以服务端广播为真相整体刷新（含驱动者掉线 → 权限移交下一位）
    connected.clear();
    (m.connected || []).forEach(s => connected.add(s));
    const nowHosted = new Set(m.hosted || []);
    // 新进入托管的座位
    nowHosted.forEach(s => {
      if (!wasHosted.has(s)){
        hosted.add(s);
        const p = players[s];
        if (p) log(`🤖 ${p.name} 掉线，AI 代打中…（TA 重连后会自动收回控制权）`, 'bad');
      }
    });
    // 收回托管的座位（重连成功）：驱动者把临时 isAI 摘掉
    wasHosted.forEach(s => {
      if (!nowHosted.has(s)){
        hosted.delete(s);
        if (players[s]) players[s].isAI = false;
        log(`🎉 ${players[s] ? players[s].name : '玩家'} 回来了！`, 'good');
      }
    });
    if (amDriving()) log('🧭 本端被推举为托管驱动者（AI 代打出招端）', 'card');
    updateTurnUi();
  }

  // 驱动者代打托管座位：临时标 isAI 走既有 AI 决策分支，状态变化照常广播
  // 注意不能等 gotState（收到过快照）——驱动者自己从不收到状态回传，本地状态就是权威
  function driveCheck(){
    if (!amDriving() || busy || gameOver) return;
    const pi = turn;
    if (!hosted.has(pi)) return;
    const p = players[pi];
    if (!p || p.bankrupt) return;
    p.isAI = true;                 // 临时标记，收回托管时在 applyRoster 摘除
    setTimeout(() => {
      if (busy || gameOver || turn !== pi || !hosted.has(pi)) return;
      p.isAI = true;
      if (p.jail > 0){
        busy = true;
        updateBuildBtn();
        handleJailTurn(pi).then(() => { busy = false; if (!gameOver) nextStep(false); });
      } else {
        rollDice();                // 内部检查 mpMine()——驱动者在托管座位上已被放行
      }
    }, 900);
  }

  function apply(data){
    if (!data) return;
    Game._applying = true;
    const ok = Game.applyState(data);
    Game._applying = false;
    if (ok){
      gotState = true;
      if (turn === MP_SEAT && !busy && !gameOver && players[turn] && players[turn].jail <= 0){
        log('🎯 轮到你了！', 'good');
      }
    }
  }

  // ---- 广播（节流：renderPlayers 在动画期间会高频调用）----
  function sync(force){
    if (!ready || !ws || ws.readyState !== 1) return;
    const now = Date.now();
    if (!force && now - lastSync < 150){
      if (!syncTimer) syncTimer = setTimeout(() => { syncTimer = null; sync(true); }, 170);
      return;
    }
    lastSync = now;
    send({ t: 'state', seat: MY_SEAT, data: Game.snapshot() });
  }

  // 心跳：保持连接、顺便当断线探针
  setInterval(() => send({ t: 'ping', t0: Date.now() }), 25000);

  window.MPNet = { sync, myTurn: () => turn === MP_SEAT, seat: MY_SEAT, room: ROOM,
    hostedSeat, amDriving, driveCheck,
    get sent(){ return sentCount; }, get dropped(){ return dropCount; } };

  // 页面加载即连接；棋盘由 boot.js 正常构建（同一份配置 + 种子，各端初始状态一致）
  connect();
})();
