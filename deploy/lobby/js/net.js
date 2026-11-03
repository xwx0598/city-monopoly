// ===== 联机大厅：房间列表 / 建房 / 座位准备 =====
// 与 deploy/mp.py 的 WebSocket 协议对接；游戏内同步由 game/js/mp.js 负责。
(function(){
  const NICK_KEY = 'monopoly_nick';
  // 需要多人即时确认的玩法在联机里有冲突：交易（m-trade）、拍卖（core）、表决（m-vote）、探监放贷（m-visit）
  const ONLINE_OFF = ['vote', 'visit'];

  let ws = null;
  let connected = false;
  let nick = '';
  let mySeat = -1;
  let curRoom = null;
  let roomMax = 4;
  let roomMap = 'classic';
  let roomMods = [];
  let reconnectTimer = null;

  const $ = id => document.getElementById(id);

  // ---- 自制地图（与 editor.js 共用存储 key 与分享码格式）----
  const CUSTOM_STORE_KEY = 'cm_custom_maps';
  function loadCustomMaps(){ try { return JSON.parse(localStorage.getItem(CUSTOM_STORE_KEY) || '{}'); } catch(e){ return {}; } }
  function encodeMap(obj){
    return btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  // 本机保存的自制地图动态插进建房地图选择（放在预设按钮之后）
  function renderRoomCustomMaps(){
    const seg = $('segRoomMap');
    if (!seg) return;
    seg.querySelectorAll('button[data-v^="custom:"]').forEach(b => b.remove());
    const store = loadCustomMaps();
    Object.keys(store).sort((a, b) => (store[b].ts || 0) - (store[a].ts || 0)).forEach(id => {
      const b = document.createElement('button');
      b.dataset.v = 'custom:' + id;
      b.textContent = '🎨 ' + (store[id].name || id).slice(0, 6);
      seg.appendChild(b);
    });
  }

  function wsUrl(){
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + '/ws';
  }

  function setConn(text, state){
    const dot = $('connDot');
    if (!dot) return;
    dot.className = 'conn-dot ' + (state || '');
    dot.querySelector('b').textContent = text;
  }

  function connect(){
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    setConn('连接中…', 'wait');
    try { ws = new WebSocket(wsUrl()); }
    catch (e){ setConn('连接失败', 'bad'); return; }

    ws.onopen = () => {
      connected = true;
      setConn('已连接', 'ok');
      ws.send(JSON.stringify({ t: 'hi', name: nick }));
      ws.send(JSON.stringify({ t: 'rooms' }));
      if (reconnectTimer){ clearTimeout(reconnectTimer); reconnectTimer = null; }
    };
    ws.onclose = () => {
      connected = false;
      setConn('连接断开，正在重连…', 'bad');
      if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 2000);
    };
    ws.onerror = () => setConn('连接异常', 'bad');
    ws.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e){ return; }
      handle(msg);
    };
  }

  function send(obj){
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  // ---------- 房间列表 ----------
  function renderRooms(rooms){
    const box = $('roomList');
    const cnt = $('roomCount');
    if (cnt) cnt.textContent = (rooms.length ? rooms.length + ' 个房间' : '暂无房间');
    if (!box) return;
    if (!rooms.length){
      box.innerHTML = '<p class="room-empty">还没有人开房，创建一个等朋友来吧</p>';
      return;
    }
    box.innerHTML = rooms.map(r => {
      const full = r.count >= r.max;
      const playing = r.status === 'playing';
      const tag = playing ? '对局中' : (full ? '已满' : '等待中');
      return `<div class="room-row${playing || full ? ' dim' : ''}" data-id="${r.id}">
        <div class="room-main">
          <b>${esc(r.name)}</b>
          <small>房主 ${esc(r.host)} · ${r.count}/${r.max} 人 · 房间码 ${r.id}</small>
        </div>
        <span class="room-tag ${playing ? 'playing' : full ? 'full' : 'wait'}">${tag}</span>
        <button class="room-join" data-id="${r.id}" ${playing || full ? 'disabled' : ''}>${playing ? '进行中' : full ? '已满' : '加入'}</button>
      </div>`;
    }).join('');
  }

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  // ---------- 房间内 ----------
  function renderRoom(room){
    curRoom = room;
    try {
      const mark = room.id + '|' + room.status + '|' +
        room.seats.map(s => (s.you ? '*' : '') + (s.name || '-') + (s.ready ? '+' : '')).join(',');
      document.body.setAttribute('data-mp-room', mark);
      if (window.__MP_SMOKE) console.log('[smoke] room ' + mark);
    } catch(e){}
    $('roomTitle').textContent = room.name;
    $('roomCode').textContent = room.id;
    $('roomHint').textContent = room.status === 'playing' ? '对局进行中' : `房间码 ${room.id} · 让朋友在联机大厅输入`;
    const mapName = room.opts.map === 'custom'
      ? (room.opts.mname || '自定义地图')
      : ({ classic:'经典小城', mini:'迷你快棋', metro:'繁华都会', random:'随机岛屿' }[room.opts.map] || '经典小城');
    const modsText = room.opts.mods ? room.opts.mods.split(',').filter(Boolean).length + ' 项玩法' : '纯经典玩法';
    $('roomOptsTip').textContent = `${mapName} · ${modsText}`;

    const grid = $('seatGrid');
    grid.innerHTML = room.seats.map(s => {
      const me = s.you ? ' me' : '';
      const empty = !s.name ? ' empty' : '';
      const host = s.seat === room.hostSeat ? '<span class="seat-host">房主</span>' : '';
      let sub;
      if (!s.name) sub = '等待加入';
      else if (s.seat === room.hostSeat) sub = '已准备';
      else sub = s.ready ? '已准备' : '未准备';
      return `<div class="seat${me}${empty}">
        <span class="seat-no">${s.seat + 1}</span>
        <div class="seat-main"><b>${s.name ? esc(s.name) : '空位'}${me ? '<i>你</i>' : ''}</b><small>${sub}</small></div>
        ${host}
      </div>`;
    }).join('');

    const isHost = room.hostSeat === mySeat;
    const meSeat = room.seats[mySeat];
    const readyBtn = $('readyBtn');
    const beginBtn = $('beginBtn');
    if (isHost){
      readyBtn.classList.add('hidden');
      beginBtn.classList.remove('hidden');
      const others = room.seats.filter(s => s.name && s.seat !== room.hostSeat);
      const allReady = others.every(s => s.ready);
      beginBtn.disabled = !others.length || !allReady;
      beginBtn.textContent = !others.length ? '等待玩家加入' : (allReady ? '开始对局' : '等待其他玩家准备');
    } else {
      beginBtn.classList.add('hidden');
      readyBtn.classList.remove('hidden');
      readyBtn.textContent = meSeat && meSeat.ready ? '已准备 · 点此取消' : '准备';
      readyBtn.classList.toggle('is-ready', !!(meSeat && meSeat.ready));
    }
  }

  // ---------- 消息分发 ----------
  function handle(msg){
    switch (msg.t){
      case 'hello':
        if (msg.need_name && nick) send({ t: 'hi', name: nick });
        break;
      case 'rooms':
        if (!$('viewRooms').classList.contains('hidden')) renderRooms(msg.rooms);
        break;
      case 'joined':
        mySeat = msg.seat;
        renderRoom(msg.room);
        showView('room');
        history.replaceState(null, '', '#room=' + msg.room.id);
        break;
      case 'room':
        if (!$('viewRoom').classList.contains('hidden')){
          // 保留自己的座位信息（服务端已按连接标注 you）
          renderRoom(msg.room);
        } else {
          curRoom = msg.room;
        }
        break;
      case 'start':
        if (window.__MP_SMOKE) console.log('[smoke] jump ' + msg.roomId);
        launch(msg);
        break;
      case 'peer_left':
        toast(`${msg.name || '有玩家'} 离开了房间`);
        break;
      case 'err':
        toast(msg.msg || '操作失败', true);
        break;
    }
  }

  // ---------- 开局跳转 ----------
  function launch(msg){
    const seats = msg.seats.slice().sort((a, b) => a.seat - b.seat);
    const opts = msg.opts || {};
    const q = new URLSearchParams({
      mode: 'mp',
      room: msg.roomId,
      seat: String(mySeat),
      seats: seats.map(s => s.seat).join(','),
      names: seats.map(s => s.name).join('|'),
      map: opts.map || 'classic',
    });
    if (opts.mods) q.set('mods', opts.mods);
    if (opts.mseed) q.set('mseed', opts.mseed);
    if (opts.mc) q.set('mc', opts.mc);      // 自制地图分享码（map=custom 时由 m-maps 解码）
    location.href = '../../game/html/game.html?' + q.toString();
  }

  // ---------- 轻提示 ----------
  let toastTimer = null;
  function toast(text, bad){
    let el = $('mpToast');
    if (!el){
      el = document.createElement('div');
      el.id = 'mpToast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.className = 'mp-toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'mp-toast'; }, 2600);
  }

  // ---------- 对外 ----------
  window.MPLobby = {
    enter(){
      const saved = localStorage.getItem(NICK_KEY);
      nick = saved || '玩家' + Math.floor(100 + Math.random() * 900);
      $('nickInput').value = saved || '';
      showView('rooms');
      connect();
      history.replaceState(null, '', '#online');
    },
    leaveRoom(backToList){
      send({ t: 'leave' });
      mySeat = -1;
      curRoom = null;
      if (backToList) showView('rooms');
      history.replaceState(null, '', '#online');
    },
  };

  // ---------- 事件绑定 ----------
  const bind = () => {
    const nickInput = $('nickInput');
    if (!nickInput) return;

    nickInput.addEventListener('input', () => {
      nick = nickInput.value.replace(/[|<\n\r]/g, '').slice(0, 8) || '玩家';
      localStorage.setItem(NICK_KEY, nickInput.value.trim());
      if (connected) send({ t: 'hi', name: nick });
    });

    $('roomsBack').addEventListener('click', () => {
      window.MPLobby.leaveRoom(false);
      showModePicker();
    });

    $('refreshRooms').addEventListener('click', () => send({ t: 'rooms' }));

    $('segRoomMax').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      roomMax = parseInt(b.dataset.v);
      syncRoomOpts();
    });
    $('segRoomMap').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      roomMap = b.dataset.v;
      syncRoomOpts();
    });
    $('roomPresetRow').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      roomMods = (PRESETS[b.dataset.preset] || []).filter(m => !ONLINE_OFF.includes(m));
      syncRoomOpts();
    });

    $('createBtn').addEventListener('click', () => {
      if (!connected){ toast('还没连上房间服务，稍等两秒', true); return; }
      const opts = { mods: roomMods.join(',') };
      if (roomMap && roomMap.startsWith('custom:')){
        // 自制地图：把整张图编码进分享码随房间配置下发，加入的人不需要事先保存过
        const store = loadCustomMaps();
        const m = store[roomMap.slice(7)];
        if (!m){ toast('这张自制地图已被删除，请重新选图', true); return; }
        opts.map = 'custom';
        opts.mname = m.name || '自定义地图';
        opts.mc = encodeMap({ name: m.name, tiles: m.tiles });
      } else {
        opts.map = roomMap;
      }
      send({ t: 'create', name: $('roomName').value.trim(), max: roomMax, opts });
    });

    $('roomList').addEventListener('click', e => {
      const b = e.target.closest('.room-join');
      if (!b || b.disabled) return;
      send({ t: 'join', id: b.dataset.id });
    });

    $('readyBtn').addEventListener('click', () => {
      const me = curRoom && curRoom.seats[mySeat];
      send({ t: 'ready', v: !(me && me.ready) });
    });
    $('beginBtn').addEventListener('click', () => send({ t: 'start' }));

    $('roomBack').addEventListener('click', () => {
      window.MPLobby.leaveRoom(true);
    });

    $('copyCode').addEventListener('click', () => {
      if (!curRoom) return;
      const code = curRoom.id;
      const done = () => toast('房间码 ' + code + ' 已复制');
      if (navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(code).then(done, () => toast('房间码 ' + code));
      } else toast('房间码 ' + code);
    });

    renderRoomCustomMaps();
    syncRoomOpts();
  };

  function syncRoomOpts(){
    const segMax = $('segRoomMax');
    if (segMax) segMax.querySelectorAll('button').forEach(b => {
      b.classList.toggle('on', parseInt(b.dataset.v) === roomMax);
      b.style.background = parseInt(b.dataset.v) === roomMax ? '#6E7C88' : 'transparent';
      b.style.color = parseInt(b.dataset.v) === roomMax ? '#fff' : '';
    });
    const segMap = $('segRoomMap');
    if (segMap) segMap.querySelectorAll('button').forEach(b => {
      b.classList.toggle('on', b.dataset.v === roomMap);
      b.style.background = b.dataset.v === roomMap ? '#6E7C88' : 'transparent';
      b.style.color = b.dataset.v === roomMap ? '#fff' : '';
    });
    const row = $('roomPresetRow');
    if (row){
      const key = roomMods.length === 0 ? 'none'
        : roomMods.join(',').split(',').sort().join(',') === ['synergy','weather','items','quests'].sort().join(',') ? 'std'
        : 'chaos';
      row.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.preset === key));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  // lobby.js 的 initHash 跑在本脚本之前（那时 MPLobby 还没定义），直链在这里兜底
  if (location.hash === '#online') window.MPLobby.enter();

  // ---- 冒烟钩子（tools/lobby-mp-smoke.mjs 专用，正常使用无影响）----
  const AUTO = new URLSearchParams(location.search).get('autotest');
  if (AUTO === 'host'){
    const run = () => setTimeout(() => {
      try {
        window.MPLobby.enter();
        const ni = document.getElementById('nickInput');
        ni.value = '甲'; ni.dispatchEvent(new Event('input'));
        document.querySelector('#segRoomMax button[data-v="2"]').click();
        document.querySelector('#segRoomMap button[data-v="mini"]').click();
        document.querySelector('#roomPresetRow button[data-preset="std"]').click();
        document.getElementById('createBtn').click();
        document.body.setAttribute('data-mp-smoke', 'hosted');
        window.__MP_SMOKE = true;
        console.log('[smoke] hosted');
      } catch(e){ document.body.setAttribute('data-mp-smoke', 'error:' + e.message); }
    }, 400);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  }
  // 房主满员自动点开局（仅 autotest 模式）
  if (AUTO === 'host'){
    const origRender = renderRoom;
    renderRoom = function(room){
      origRender(room);
      try {
        if (room.hostSeat === mySeat && room.status === 'lobby'){
          const others = room.seats.filter(s => s.name && s.seat !== room.hostSeat);
          if (others.length && others.every(s2 => s2.ready)) setTimeout(() => {
            const b = document.getElementById('beginBtn');
            if (b && !b.disabled) b.click();
          }, 500);
        }
      } catch(e){}
    };
  }
})();
