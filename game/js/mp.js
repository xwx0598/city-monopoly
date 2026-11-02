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
        if (gotState) log(`👋 ${m.name || '有玩家'} 掉线了，等 TA 重连…`, 'bad');
        break;
      case 'err':
        log('⚠️ ' + (m.msg || '联机消息异常'), 'bad');
        break;
    }
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
    get sent(){ return sentCount; }, get dropped(){ return dropCount; } };

  // 页面加载即连接；棋盘由 boot.js 正常构建（同一份配置 + 种子，各端初始状态一致）
  connect();
})();
