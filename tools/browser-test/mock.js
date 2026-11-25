// ファームウェアと同じ手順で動く疑似 BLE デバイス (ブラウザ内に注入する)
(() => {
  const U = n => `6b1d000${n}-9c4f-4f0e-a3b7-5a7e2c40d1e9`;
  const cfg = window.__mockCfg = { mtu: 247, corrupt: false, dropChunk: -1 };
  const got = window.__mock = { files: [], commands: [], writes: { nr: 0, wr: 0 }, maxChunk: 0, apps: {}, theme: null, running: -1 };
  const table = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xFFFFFFFF; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
  const bytesOf = v => new Uint8Array(v.buffer ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v);
  const emitter = () => { const t = new EventTarget(); t.startNotifications = async () => t; return t; };
  const fire = (t, value) => { t.value = value; setTimeout(() => t.dispatchEvent(new Event('characteristicvaluechanged')), 1); };
  const status = emitter(), logChr = emitter();
  const notify = (state, err, received) => {
    const v = new DataView(new ArrayBuffer(8));
    v.setUint8(0, state); v.setUint8(1, err); v.setUint16(2, cfg.mtu, true); v.setUint32(4, received, true);
    fire(status, v);
  };
  const deviceLog = text => fire(logChr, new DataView(new TextEncoder().encode(text).buffer));
  window.__mockLog = deviceLog;
  let rx = null, busyOp = false;
  const gatt = async fn => {   // 実機同様、GATT 操作の同時実行はエラーにする
    if (busyOp) throw new Error('GATT operation already in progress');
    busyOp = true; await new Promise(r => setTimeout(r, 0)); try { return fn(); } finally { busyOp = false; }
  };
  const LIMIT = { 1: 512 * 1024, 2: 1024 * 1024, 3: 64 * 1024 };
  const ctrl = { writeValueWithResponse: v => gatt(() => {
    const d = bytesOf(v), dv = new DataView(d.buffer);
    got.commands.push(Array.from(d));
    if (d[0] === 0x03) rx = null;
    if (d[0] === 0x13 && d[1] === 3) delete got.apps[d[2]];
    if (d[0] === 0x14) got.theme = Array.from(d.slice(1));
    if (d[0] === 0x20) { got.running = d[1]; deviceLog('> 起動: ' + (got.apps[d[1]] ? got.apps[d[1]].n : '?')); }
    if (d[0] === 0x21) got.running = -1;
    if (d[0] === 0x01) {
      const size = dv.getUint32(3, true);
      if (!LIMIT[d[1]] || (d[1] === 3 && d[2] >= 8)) return notify(3, 6, 0);
      if (size === 0 || size > LIMIT[d[1]]) return notify(3, 1, 0);
      rx = { kind: d[1], slot: d[2], size, crc: dv.getUint32(7, true), window: d[11] || 16, buf: new Uint8Array(size), received: 0, chunks: 0, n: 0 };
      notify(1, 0, 0);
    }
  }) };
  const onData = (v, kind) => gatt(() => {
    const d = bytesOf(v);
    got.writes[kind]++; got.maxChunk = Math.max(got.maxChunk, d.length);
    if (d.length > cfg.mtu - 3) throw new Error('chunk larger than MTU-3');
    if (!rx) return;
    if (rx.n++ === cfg.dropChunk) return;           // 欠落の再現
    if (rx.received + d.length > rx.size) { rx = null; return notify(3, 4, 0); }
    rx.buf.set(d, rx.received); rx.received += d.length;
    if (rx.received === rx.size) {
      notify(1, 0, rx.received);
      const done = rx; rx = null;
      setTimeout(() => {
        if (cfg.corrupt) done.buf[done.size >> 1] ^= 0xFF;
        if (crc(done.buf) !== done.crc) return notify(3, 3, done.size);
        got.files.push({ kind: done.kind, slot: done.slot, b64: btoa(Array.from(done.buf, c => String.fromCharCode(c)).join('')) });
        if (done.kind === 3) {
          const text = new TextDecoder().decode(done.buf);
          got.apps[done.slot] = { s: done.slot, n: ((/@name\s+(.+)/.exec(text) || [])[1] || `アプリ ${done.slot + 1}`).trim().slice(0, 12), z: done.size };
        }
        notify(2, 0, done.size);
      }, 30);
    } else if (++rx.chunks >= rx.window) { rx.chunks = 0; notify(1, 0, rx.received); }
  });
  const data = { writeValueWithoutResponse: v => onData(v, 'nr'), writeValueWithResponse: v => onData(v, 'wr') };
  const apps = { readValue: () => gatt(() => new DataView(new TextEncoder().encode(JSON.stringify(Object.values(got.apps))).buffer)) };
  const chars = { [U(2)]: ctrl, [U(3)]: data, [U(4)]: status, [U(5)]: apps, [U(6)]: logChr };
  const device = new EventTarget();
  device.name = 'M5StopWatch';
  device.gatt = { connected: false,
    connect: async () => { device.gatt.connected = true; return { getPrimaryService: async () => ({ getCharacteristic: async u => { if (!chars[u]) throw new Error('no characteristic'); return chars[u]; } }) }; },
    disconnect: () => { device.gatt.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')); } };
  Object.defineProperty(Navigator.prototype, 'bluetooth', { configurable: true, get: () => ({ requestDevice: async o => { got.request = o; return device; } }) });
})();
