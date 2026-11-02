"""城市大富翁 · 局域网联机（房间模式）

零依赖实现：
  * WebSocket 握手 + 帧编解码（RFC 6455 子集：文本帧 / ping / pong / close）
  * 房间管理：建房、房间列表、加入、准备、开局、断线清理、对局状态转发

设计取舍：
  * 服务端不跑游戏规则，只当「信使 + 座位表」——状态由当前行动的浏览器计算后广播，
    其他人套用。这样规则只有一份（game/js/core.js），不用在 Python 里重写一遍。
  * 联机时禁用需要多方即时确认的玩法（交易 / 拍卖 / 表决 / 探监），其余玩法照常。
"""

import base64
import hashlib
import json
import os
import random
import socket
import struct
import sys
import threading
import time
import traceback

# 设 MP_DEBUG=1 才打印每条指令与服务端异常栈，默认安静
MP_DEBUG = os.environ.get("MP_DEBUG", "") not in ("", "0", "false", "False")

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_FRAME = 4 * 1024 * 1024      # 单帧上限 4MB，状态快照远小于此
MAX_ROOM_SIZE = 4
ROOM_TTL_IDLE = 3 * 60 * 60      # 空房间 3 小时回收


# ============================================================
# WebSocket 连接
# ============================================================
class WsConn:
    def __init__(self, sock, rfile, addr):
        self.sock = sock
        self.rfile = rfile
        self.addr = addr
        self.name = "玩家"
        self.room = None
        self.seat = None
        self.alive = True
        self._send_lock = threading.Lock()

    # ---- 底层收发 ----
    def _read_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.rfile.read(n - len(buf))
            if not chunk:
                raise ConnectionError("peer closed")
            buf += chunk
        return buf

    def _write_frame(self, opcode, payload):
        head = bytearray([0x80 | opcode])
        n = len(payload)
        if n < 126:
            head.append(n)
        elif n < 65536:
            head.append(126)
            head += struct.pack(">H", n)
        else:
            head.append(127)
            head += struct.pack(">Q", n)
        with self._send_lock:
            if not self.alive:
                return
            try:
                self.sock.sendall(bytes(head) + payload)
            except OSError:
                self.alive = False

    def send_json(self, obj):
        if not self.alive:
            return
        self._write_frame(0x1, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def close(self, code=1000):
        if self.alive:
            try:
                self._write_frame(0x8, struct.pack(">H", code))
            except Exception:
                pass
        self.alive = False
        try:
            self.sock.close()
        except Exception:
            pass

    def read_message(self):
        """读一条完整文本消息；对端关闭返回 None。"""
        chunks = []
        while True:
            b1, b2 = self._read_exact(2)
            fin = b1 >> 7
            opcode = b1 & 0x0F
            masked = b2 & 0x80
            length = b2 & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._read_exact(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._read_exact(8))[0]
            if length > MAX_FRAME:
                raise ConnectionError("frame too large")
            mask = self._read_exact(4) if masked else b"\x00\x00\x00\x00"
            payload = self._read_exact(length) if length else b""
            if masked:
                payload = bytes(payload[i] ^ mask[i % 4] for i in range(len(payload)))

            if opcode == 0x8:      # close
                return None
            if opcode == 0x9:      # ping
                self._write_frame(0xA, payload)
                continue
            if opcode == 0xA:      # pong
                continue
            if opcode in (0x1, 0x0):
                chunks.append(payload)
                if fin:            # 没有分片就到此为止，直接交出去
                    return b"".join(chunks).decode("utf-8", "replace")
                continue
            raise ConnectionError(f"unsupported opcode {opcode}")


def handshake(handler):
    """在 HTTP 处理器上完成升级握手，成功返回 WsConn。"""
    key = handler.headers.get("Sec-WebSocket-Key")
    if not key:
        handler.send_error(400, "missing Sec-WebSocket-Key")
        return None
    accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
    handler.send_response(101, "Switching Protocols")
    handler.send_header("Upgrade", "websocket")
    handler.send_header("Connection", "Upgrade")
    handler.send_header("Sec-WebSocket-Accept", accept)
    handler.end_headers()
    try:
        handler.wfile.flush()
    except Exception:
        pass
    conn = WsConn(handler.connection, handler.rfile, handler.client_address)
    conn.sock.settimeout(None)
    return conn


# ============================================================
# 房间
# ============================================================
class Seat:
    def __init__(self, idx, conn):
        self.idx = idx
        self.conn = conn
        self.name = conn.name if conn else ""
        self.ready = False

    def brief(self, you_seat=None):
        return {
            "seat": self.idx,
            "name": self.name,
            "ready": self.ready or self.idx == 0,   # 房主默认已准备
            "online": bool(self.conn and self.conn.alive),
            "you": self.idx == you_seat,
        }


class Room:
    def __init__(self, rid, name, max_seats, opts, host):
        self.id = rid
        self.name = name
        self.max = max(2, min(MAX_ROOM_SIZE, int(max_seats or 4)))
        self.opts = opts or {}
        self.status = "lobby"           # lobby | playing
        self.seats = [Seat(i, None) for i in range(self.max)]
        self.created = time.time()
        self.touched = time.time()
        self.bind(0, host)

    # ---- 座位 ----
    def bind(self, idx, conn):
        seat = self.seats[idx]
        seat.conn = conn
        seat.name = conn.name
        seat.ready = False
        conn.room = self
        conn.seat = idx

    def detach(self, conn):
        for seat in self.seats:
            if seat.conn is conn:
                seat.conn = None
                seat.ready = False
                conn.room = None
                conn.seat = None
                return seat.idx
        return None

    def free_seat(self):
        for seat in self.seats:
            if seat.conn is None:
                return seat.idx
        return None

    def humans(self):
        return [s for s in self.seats if s.conn]

    def is_empty(self):
        return not self.humans()

    def host_seat(self):
        for seat in self.seats:
            if seat.conn:
                return seat.idx
        return 0

    # ---- 视图 ----
    def list_view(self):
        return {
            "id": self.id,
            "name": self.name,
            "max": self.max,
            "count": len(self.humans()),
            "status": self.status,
            "host": self.seats[self.host_seat()].name if self.humans() else "",
            "map": self.opts.get("map", "classic"),
            "mods": self.opts.get("mods", ""),
        }

    def view(self, you):
        return {
            "id": self.id,
            "name": self.name,
            "max": self.max,
            "status": self.status,
            "opts": self.opts,
            "hostSeat": self.host_seat(),
            "seats": [s.brief(you.seat if you else None) for s in self.seats],
        }


# ============================================================
# 房间管理器
# ============================================================
class Lobby:
    def __init__(self):
        self.lock = threading.RLock()
        self.rooms = {}
        self.clients = set()

    # ---- 连接生命周期 ----
    def add(self, conn):
        with self.lock:
            self.clients.add(conn)

    def drop(self, conn):
        with self.lock:
            room = conn.room
            self.clients.discard(conn)
            if not room:
                return
            idx = room.detach(conn)
            if room.is_empty():
                self.rooms.pop(room.id, None)
                self.broadcast_rooms()
                return
            if room.status == "playing":
                # 对局中断线：告诉剩下的人，房间回到可重进状态
                self.broadcast_room(room, {"t": "peer_left", "seat": idx, "name": conn.name})
            else:
                # 大厅里走人：房主移交
                if room.seats[room.host_seat()] and room.status == "lobby":
                    pass
                self.broadcast_room(room)
            self.broadcast_rooms()

    def broadcast_rooms(self):
        payload = {"t": "rooms", "rooms": [r.list_view() for r in self.rooms.values()]}
        for conn in list(self.clients):
            if conn.room is None and conn.alive:
                conn.send_json(payload)

    def broadcast_room(self, room, extra=None):
        for seat in room.seats:
            if seat.conn and seat.conn.alive:
                seat.conn.send_json({"t": "room", "room": room.view(seat.conn)})
                if extra:
                    seat.conn.send_json(extra)

    def to_room(self, room, obj, exclude=None):
        for seat in room.seats:
            conn = seat.conn
            if conn and conn.alive and conn is not exclude:
                conn.send_json(obj)

    # ---- 指令 ----
    def handle(self, conn, msg):
        t = msg.get("t")
        if t == "hi":
            name = str(msg.get("name") or "").strip()[:12] or random.choice(
                ["小明", "小红", "阿强", "阿珍", "老王", "小美"])
            conn.name = name
            conn.send_json({"t": "hello", "name": name})
            self.broadcast_rooms()
            return

        if t == "rooms":
            conn.send_json({"t": "rooms", "rooms": [r.list_view() for r in self.rooms.values()]})
            return

        if t == "create":
            with self.lock:
                if conn.room:
                    self.leave(conn)
                rid = self._new_id()
                room = Room(rid, str(msg.get("name") or "").strip()[:16] or f"{conn.name} 的房间",
                            msg.get("max") or 4, msg.get("opts") or {}, conn)
                self.rooms[rid] = room
                conn.send_json({"t": "joined", "room": room.view(conn), "seat": 0})
                self.broadcast_rooms()
            return

        if t == "join":
            with self.lock:
                room = self.rooms.get(str(msg.get("id") or ""))
                if not room:
                    conn.send_json({"t": "err", "msg": "房间不存在或已解散"})
                    return
                if room.status != "lobby":
                    conn.send_json({"t": "err", "msg": "这一局已经开始了"})
                    return
                idx = room.free_seat()
                if idx is None:
                    conn.send_json({"t": "err", "msg": "房间满了"})
                    return
                if conn.room:
                    self.leave(conn)
                room.bind(idx, conn)
                room.touched = time.time()
                conn.send_json({"t": "joined", "room": room.view(conn), "seat": idx})
                self.broadcast_room(room)
                self.broadcast_rooms()
            return

        if t == "ready":
            room = conn.room
            if not room or room.status != "lobby":
                return
            with self.lock:
                for seat in room.seats:
                    if seat.conn is conn:
                        seat.ready = bool(msg.get("v"))
                self.broadcast_room(room)
            return

        if t == "start":
            room = conn.room
            if not room or room.status != "lobby":
                return
            with self.lock:
                if conn.seat != room.host_seat():
                    conn.send_json({"t": "err", "msg": "只有房主能开始对局"})
                    return
                humans = room.humans()
                if len(humans) < 2:
                    conn.send_json({"t": "err", "msg": "至少需要 2 位玩家"})
                    return
                if any(not s.ready and s.idx != room.host_seat() for s in humans):
                    conn.send_json({"t": "err", "msg": "还有玩家没准备"})
                    return
                room.status = "playing"
                seats = [{"seat": s.idx, "name": s.name} for s in humans]
                self.to_room(room, {"t": "start", "roomId": room.id, "seats": seats, "opts": room.opts})
                self.broadcast_rooms()
            return

        if t == "resume":
            # 对局页（重新）进入：按房间号+座位号重新绑定连接
            with self.lock:
                room = self.rooms.get(str(msg.get("id") or ""))
                if not room:
                    conn.send_json({"t": "err", "msg": "房间已关闭"})
                    return
                try:
                    seat = int(msg.get("seat"))
                except (TypeError, ValueError):
                    conn.send_json({"t": "err", "msg": "座位号无效"})
                    return
                if not (0 <= seat < room.max):
                    conn.send_json({"t": "err", "msg": "座位号无效"})
                    return
                if conn.room and conn.room is not room:
                    self.leave(conn)
                old = room.seats[seat].conn
                if old and old is not conn:
                    old.alive = False            # 同一座位重复打开页面：顶掉旧连接
                    try:
                        old.close()
                    except Exception:
                        pass
                room.bind(seat, conn)
                room.seats[seat].ready = True
                conn.send_json({"t": "joined", "room": room.view(conn), "seat": seat})
                if room.status == "playing":
                    conn.send_json({"t": "game_live"})
                    # 找一个在线的同伴要当前状态（谁先回就听谁的）
                    peers = sorted([s for s in room.seats if s.conn and s.conn is not conn],
                                   key=lambda s: s.idx)
                    if peers:
                        peers[0].conn.send_json({"t": "state_req"})
                self.broadcast_rooms()
            return

        if t == "state_req":
            room = conn.room
            if not room or room.status != "playing":
                return
            self.to_room(room, {"t": "state_req"}, exclude=conn)
            return

        if t == "state":
            room = conn.room
            if not room or room.status != "playing":
                return
            if conn.seat != msg.get("seat"):
                return     # 只允许本人的座位号发状态
            self.to_room(room, {"t": "state", "seat": conn.seat, "data": msg.get("data")}, exclude=conn)
            return

        if t == "leave":
            with self.lock:
                self.leave(conn)
                conn.send_json({"t": "left"})
                self.broadcast_rooms()
            return

        if t == "ping":
            conn.send_json({"t": "pong", "t0": msg.get("t0")})
            return

        if t == "chat":
            room = conn.room
            if not room:
                return
            text = str(msg.get("text") or "").strip()[:80]
            if text:
                self.to_room(room, {"t": "chat", "seat": conn.seat, "name": conn.name, "text": text})
            return

        conn.send_json({"t": "err", "msg": f"未知指令 {t}"})

    def leave(self, conn):
        room = conn.room
        if not room:
            return
        idx = room.detach(conn)
        if room.is_empty():
            self.rooms.pop(room.id, None)
        else:
            if room.status == "playing":
                self.to_room(room, {"t": "peer_left", "seat": idx, "name": conn.name})
            else:
                self.broadcast_room(room)

    def _new_id(self):
        while True:
            rid = str(random.randint(1000, 9999))
            if rid not in self.rooms:
                return rid

    def gc(self):
        now = time.time()
        dead = []
        with self.lock:
            for rid, room in list(self.rooms.items()):
                if room.is_empty() and now - room.touched > ROOM_TTL_IDLE:
                    dead.append(rid)
                elif room.is_empty():
                    dead.append(rid)     # 空房间直接回收，列表里不留僵尸
            for rid in dead:
                self.rooms.pop(rid, None)
        return dead


LOBBY = Lobby()


# ============================================================
# 连接处理（由 server.py 在 /ws 上调用，占一个线程）
# ============================================================
def serve(handler):
    conn = handshake(handler)
    if not conn:
        return
    LOBBY.add(conn)
    conn.send_json({"t": "hello", "name": conn.name, "need_name": True})
    try:
        while conn.alive:
            raw = conn.read_message()
            if raw is None:
                break
            try:
                msg = json.loads(raw)
            except (ValueError, UnicodeDecodeError):
                conn.send_json({"t": "err", "msg": "消息格式错误"})
                continue
            if not isinstance(msg, dict):
                continue
            if MP_DEBUG:
                _d = msg.get('data') or {}
                _extra = ''
                if msg.get('t') == 'state':
                    _extra = 'over=%s round=%s turn=%s' % (
                        _d.get('over'), _d.get('round'), _d.get('turn'))
                print('[mp]', conn.name, conn.seat, msg.get('t'), _extra,
                      flush=True, file=sys.stderr)
            LOBBY.handle(conn, msg)
    except (ConnectionError, OSError, socket.timeout):
        pass
    except Exception:
        if MP_DEBUG:
            traceback.print_exc()
    finally:
        conn.alive = False
        LOBBY.drop(conn)
        try:
            handler.close_connection = True
        except Exception:
            pass
