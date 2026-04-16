'use strict';
// backend/hikrobot/js/getStream.js
// IPC consumer: receives frame-ready notifications from hikrobot/ipc/frameserver.js,
// reads raw pixels from the shared memory buffer, and emits 'frame' events.
//
// Usage:
//   const FrameStream = require('./getStream');
//   const stream = new FrameStream();
//   stream.on('frame', ({ data, width, height, frameNum, gen }) => { ... });
//   stream.on('drop',  ({ frameNum, expected, got }) => { ... });
//   stream.on('error', (err) => { ... });
//   stream.start();
//   // ... later:
//   stream.stop();
//
// Guarantees:
//   • 'frame' events fire on the Node.js main thread.
//   • `frame.data` is a zero-copy Buffer wrapping the static C++ triple-buffer.
//     It is valid ONLY during the synchronous execution of the 'frame' handler.
//     Copy it with Buffer.from(frame.data) if it must outlive the handler.
//   • Out-of-order IPC lines are silently discarded (gen ≤ lastGen → 'drop').
//   • Reconnects to the pipe within 100 ms on disconnect.

const net              = require('net');
const { EventEmitter } = require('events');
const memBuffer        = require('../memory-buffer/index');

// Must match hikrobot/ipc/frameserver.js PIPE_PATH.
const PIPE_PATH = process.platform === 'win32'
    ? '\\\\.\\pipe\\hikrobot-frame'
    : '/tmp/hikrobot-frame.sock';

class FrameStream extends EventEmitter {
    constructor() {
        super();
        this._socket          = null;
        this._lineBuf         = '';
        this._lastGen         = -1;
        this._running         = false;
        this._reconnectTimer  = null;
    }

    // ── start() ──────────────────────────────────────────────────────────────
    start() {
        if (this._running) return;
        this._running = true;
        this._connect();
    }

    // ── stop() ───────────────────────────────────────────────────────────────
    stop() {
        this._running = false;
        if (this._reconnectTimer !== null) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        if (this._socket) {
            this._socket.destroy();
            this._socket = null;
        }
        this._lineBuf = '';
        this._lastGen = -1;
    }

    // ── _connect() ───────────────────────────────────────────────────────────
    _connect() {
        const socket = net.createConnection({ path: PIPE_PATH });
        this._socket = socket;

        socket.setNoDelay(true);
        socket.setEncoding('utf8');

        socket.on('data', (chunk) => {
            this._lineBuf += chunk;
            let nl;
            // Process every complete newline-terminated JSON line.
            while ((nl = this._lineBuf.indexOf('\n')) !== -1) {
                const line   = this._lineBuf.slice(0, nl).trim();
                this._lineBuf = this._lineBuf.slice(nl + 1);
                if (line.length > 0) this._onNotification(line);
            }
        });

        socket.on('error', (err) => {
            this.emit('error', err);
            this._scheduleReconnect();
        });

        socket.on('close', () => {
            if (this._running) this._scheduleReconnect();
        });
    }

    // ── _scheduleReconnect() ─────────────────────────────────────────────────
    _scheduleReconnect() {
        if (!this._running || this._reconnectTimer !== null) return;
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            if (this._running) this._connect();
        }, 100);
    }

    // ── _onNotification(line) ────────────────────────────────────────────────
    // line is a JSON string: {"frameNum":N,"gen":G,"width":W,"height":H}
    _onNotification(line) {
        let meta;
        try { meta = JSON.parse(line); } catch { return; }

        const gen      = meta.gen;
        const frameNum = meta.frameNum;

        // Discard stale or duplicate notifications.
        if (typeof gen !== 'number' || gen <= this._lastGen) {
            this.emit('drop', { frameNum, reason: 'stale', gen, lastGen: this._lastGen });
            return;
        }

        // Read pixels from the shared memory buffer (zero-copy).
        const frame = memBuffer.read();

        if (!frame.ok) {
            this.emit('error', new Error(
                `memBuffer.read() failed for frameNum=${frameNum}: ${frame.error}`
            ));
            return;
        }

        // Verify the buffer generation matches: if not, a new frame overwrote it
        // during the IPC round-trip.  Emit 'drop' so the caller can log it.
        if (frame.gen !== gen) {
            this.emit('drop', { frameNum, reason: 'overwritten', expected: gen, got: frame.gen });
            return;
        }

        this._lastGen = gen;

        this.emit('frame', {
            data:     frame.data,       // Buffer — zero-copy, valid this turn only
            width:    frame.width,
            height:   frame.height,
            frameNum: frame.frameNum,
            gen:      frame.gen
        });
    }
}

module.exports = FrameStream;
