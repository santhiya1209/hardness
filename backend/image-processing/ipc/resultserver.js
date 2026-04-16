'use strict';
// backend/image-processing/ipc/resultserver.js
// Named-pipe IPC server for Vickers measurement requests.
//
// Protocol: newline-delimited JSON, request-response over the same connection.
//
//   Client → Server:
//     {"id":"<uuid>","width":W,"height":H,"pxPerMm":P,"loadKgf":L}\n
//     (pixel data is NOT sent — processor reads from the shared memory buffer)
//
//   Server → Client (success):
//     {"id":"<uuid>","ok":true,"hv":V,"d1_mm":D1,"d2_mm":D2,
//      "d_mean_mm":DM,"confidence":C,"px_per_mm":P,
//      "cx_frac":...,"cy_frac":...,"lx_frac":...,...}\n
//
//   Server → Client (failure):
//     {"id":"<uuid>","ok":false,"error":"<message>"}\n
//
// The server is single-threaded — requests from multiple clients are
// serialised by the Node.js event loop.  Each request runs the CPU-bound
// processor.process() synchronously (it completes in <200 ms at 5 MP).
//
// On Windows the pipe is:  \\.\pipe\hikrobot-result
// On POSIX (dev/test):     /tmp/hikrobot-result.sock

const net       = require('net');
const path      = require('path');
const memBuffer = require('../../hikrobot/memory-buffer/index');
const processor = require('../napi/build/Release/processor.node');

const PIPE_PATH = process.platform === 'win32'
    ? '\\\\.\\pipe\\hikrobot-result'
    : '/tmp/hikrobot-result.sock';

// ── Server ───────────────────────────────────────────────────────────────────
const server = net.createServer((socket) => {
    socket.setNoDelay(true);
    socket.setEncoding('utf8');

    let lineBuf = '';

    socket.on('data', (chunk) => {
        lineBuf += chunk;
        let nl;
        while ((nl = lineBuf.indexOf('\n')) !== -1) {
            const line = lineBuf.slice(0, nl).trim();
            lineBuf    = lineBuf.slice(nl + 1);
            if (line.length > 0) handleRequest(socket, line);
        }
    });

    socket.on('error', () => socket.destroy());
    socket.on('close', () => {});
});

// ── handleRequest ─────────────────────────────────────────────────────────────
function handleRequest(socket, line) {
    let req;
    try { req = JSON.parse(line); }
    catch { return; } // malformed — ignore

    const id       = req.id     || '';
    const width    = req.width  | 0;
    const height   = req.height | 0;
    const pxPerMm  = typeof req.pxPerMm === 'number' ? req.pxPerMm : 100;
    const loadKgf  = typeof req.loadKgf === 'number' ? req.loadKgf : 10;

    // Read raw pixels from the shared memory buffer (zero-copy).
    const frame = memBuffer.read();
    if (!frame.ok) {
        send(socket, { id, ok: false, error: frame.error || 'no frame in buffer' });
        return;
    }

    if (frame.width !== width || frame.height !== height) {
        send(socket, { id, ok: false,
            error: `dimension mismatch: buffer is ${frame.width}×${frame.height}, requested ${width}×${height}` });
        return;
    }

    // Run Vickers detection — synchronous, CPU-bound, <200 ms at 5 MP.
    const result = processor.process(frame.data, width, height, { pxPerMm, loadKgf });

    send(socket, { id, ...result });
}

// ── send ─────────────────────────────────────────────────────────────────────
function send(socket, obj) {
    if (!socket.destroyed) socket.write(JSON.stringify(obj) + '\n');
}

// ── start() ──────────────────────────────────────────────────────────────────
function start() {
    server.listen(PIPE_PATH, () => {
        process.stderr.write(`[resultserver] listening on ${PIPE_PATH}\n`);
    });
    server.on('error', (err) => {
        process.stderr.write(`[resultserver] ERROR: ${err.message}\n`);
        throw err;
    });
}

// ── stop() ───────────────────────────────────────────────────────────────────
function stop() {
    server.close();
}

module.exports = { start, stop, PIPE_PATH };
