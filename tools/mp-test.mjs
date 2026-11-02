// 联机房间协议自测：node tools/mp-test.mjs
// 零依赖：自己实现最小 WebSocket 客户端，对着真实服务器跑一遍完整房间流程。
import { spawn } from 'node:child_process';
import net from 'node:net';
import crypto from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8791;

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}

// ---------- 最小 WebSocket 客户端 ----------
class WS {
  constructor(sock) {
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.queue = [];
    this.waiters = [];
    this.closed = false;
    sock.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this._parse(); });
    sock.on('close', () => { this.closed = true; this.waiters.forEach(w => w(null)); this.waiters = []; });
  }

  _parse() {
    while (this.buf.length >= 2) {
      const b1 = this.buf[0], b2 = this.buf[1];
      let len = b2 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (this.buf.length < off + len) return;
      const payload = this.buf.subarray(off, off + len);
      this.buf = this.buf.subarray(off + len);
      const opcode = b1 & 0x0f;
      if (opcode === 0x1) {
        let msg = null;
        try { msg = JSON.parse(payload.toString('utf8')); } catch { }
        if (msg) this._deliver(msg);
      }
    }
  }

  _deliver(msg) {
    const w = this.waiters.shift();
    if (w) w(msg);
    else this.queue.push(msg);
  }

  send(obj) {
    const data = Buffer.from(JSON.stringify(obj), 'utf8');
    const mask = crypto.randomBytes(4);
    let head;
    if (data.length < 126) head = Buffer.from([0x81, 0x80 | data.length]);
    else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(data.length, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
    const masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
    this.sock.write(Buffer.concat([head, mask, masked]));
  }

  // 取下一条（可跳过不关心类型）
  next(timeout = 3000) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise(res => {
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(wrap);
        if (i >= 0) this.waiters.splice(i, 1);
        res(null);
      }, timeout);
      const wrap = m => { clearTimeout(timer); res(m); };
      this.waiters.push(wrap);
    });
  }

  // 等某类消息
  async wait(t, timeout = 3000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const m = await this.next(timeout);
      if (!m) return null;
      if (m.t === t) return m;
    }
    return null;
  }

  close() { try { this.sock.destroy(); } catch { } }
}

function connect() {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PORT, '127.0.0.1');
    const key = crypto.randomBytes(16).toString('base64');
    const onErr = e => reject(e);
    sock.once('error', onErr);
    sock.once('connect', () => {
      sock.write(
        `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      let head = Buffer.alloc(0);
      const onData = d => {
        head = Buffer.concat([head, d]);
        const idx = head.indexOf('\r\n\r\n');
        if (idx < 0) return;
        const text = head.subarray(0, idx).toString();
        sock.off('data', onData);
        if (!/101/.test(text)) { reject(new Error('握手失败: ' + text.split('\r\n')[0])); return; }
        const ws = new WS(sock);
        // 握手响应之后可能还有帧数据
        const rest = head.subarray(idx + 4);
        if (rest.length) { ws.buf = Buffer.concat([ws.buf, rest]); ws._parse(); }
        sock.off('error', onErr);
        resolve(ws);
      };
      sock.on('data', onData);
    });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- 启动服务器 ----------
async function bootServer() {
  const py = process.platform === 'win32' ? 'python' : 'python3';
  const proc = spawn(py, ['deploy/server.py', '--no-open', '--port', String(PORT)], { cwd: ROOT });
  proc.stdout.on('data', () => { });
  proc.stderr.on('data', d => process.stderr.write('[server] ' + d));
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    const up = await new Promise(res => {
      const s = net.connect(PORT, '127.0.0.1');
      s.once('connect', () => { s.destroy(); res(true); });
      s.once('error', () => res(false));
    });
    if (up) return proc;
  }
  throw new Error('服务器没有起来');
}

// ---------- 测试 ----------
const server = await bootServer();
console.log('\n房间协议自测');

try {
  // 1. 建房
  const A = await connect();
  await A.wait('hello');
  A.send({ t: 'hi', name: '房主A' });
  await A.wait('hello');
  A.send({ t: 'create', name: '测试房间', max: 3, opts: { map: 'mini', mods: 'items' } });
  const joinedA = await A.wait('joined');
  ok(!!joinedA && joinedA.seat === 0, '建房成功，房主坐 0 号位');
  ok(joinedA?.room?.max === 3, '房间人数上限生效');
  ok(joinedA?.room?.seats?.length === 3, '座位数与上限一致');

  // 2. 房间列表
  const B = await connect();
  await B.wait('hello');
  B.send({ t: 'hi', name: '玩家B' });
  await B.wait('hello');
  B.send({ t: 'rooms' });
  const list = await B.wait('rooms');
  ok(list?.rooms?.length === 1 && list.rooms[0].count === 1, '未进房客户端能看到房间列表');

  // 3. 加入
  B.send({ t: 'join', id: joinedA.room.id });
  const joinedB = await B.wait('joined');
  ok(joinedB?.seat === 1, '第二个玩家坐 1 号位');
  const roomUpd = await A.wait('room');
  ok(roomUpd?.room?.seats?.[1]?.name === '玩家B', '房主收到座位更新');

  // 4. 准备
  B.send({ t: 'ready', v: true });
  const readyUpd = await A.wait('room');
  ok(readyUpd?.room?.seats?.[1]?.ready === true, '准备状态广播给房主');

  // 5. 非房主不能开局
  B.send({ t: 'start' });
  const errB = await B.wait('err');
  ok(!!errB, '非房主开局被拒绝');

  // 6. 房主开局
  A.send({ t: 'start' });
  const startA = await A.wait('start');
  const startB = await B.wait('start');
  ok(!!startA && startA.seats.length === 2, '开局广播包含两位玩家');
  ok(startB?.opts?.map === 'mini', '开局携带房间配置（地图等）');

  // 7. 状态转发（只发给别人，不回自己）
  B.send({ t: 'state', seat: joinedB.seat, data: { round: 2, turn: 0 } });
  const stateA = await A.wait('state');
  ok(stateA?.data?.round === 2, '对手状态转发到房主');
  const echo = await B.next(400);
  ok(echo === null, '状态不会回传给发送者');

  // 8. 冒用座位号被丢弃
  A.send({ t: 'state', seat: 1, data: { round: 99 } });
  const spoof = await B.next(400);
  ok(spoof === null, '冒用他人座位号的状态被丢弃');

  // 9. 开局后不能再加入
  const C = await connect();
  await C.wait('hello');
  C.send({ t: 'hi', name: '玩家C' });
  await C.wait('hello');
  C.send({ t: 'join', id: joinedA.room.id });
  const errC = await C.wait('err');
  ok(!!errC && /开始/.test(errC.msg), '进行中的房间拒绝加入');
  C.close();

  // 10. 断线通知
  B.close();
  const left = await A.wait('peer_left');
  ok(left?.seat === 1, '断线时通知同桌玩家');

  A.close();
  await sleep(200);

  // 11. 房间回收
  const D = await connect();
  await D.wait('hello');
  D.send({ t: 'hi', name: '玩家D' });
  await D.wait('hello');
  D.send({ t: 'rooms' });
  const empty = await D.wait('rooms');
  ok(empty?.rooms?.length === 0, '无人房间自动回收');
  D.close();
} catch (e) {
  fail++;
  console.log('  ✗ 异常：' + e.message);
} finally {
  server.kill();
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
