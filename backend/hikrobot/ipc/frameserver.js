'use strict';
// backend/hikrobot/ipc/frameserver.js
// Named-pipe IPC server that broadcasts frame-ready notifications to all
// connected consumers (e.g. hikrobot/js/getStream.js).
//
// Protocol: newline-delimited JSON.
//   Server → Client:  {"frameNum":N,"gen":G,"width":W,"height":H}\n
//
// The pixel data itself is NOT sent over the pipe.  Consumers read it
// directly from the shared memory buffer (hikrobot/memory-buffer/).
// This keeps the pipe throughput O(1) per frame regardless of resolution.
//
// On Windows the pipe is:  \\.\pipe\hikrobot-frame
// On POSIX (dev/test):     /tmp/hikrobot-frame.sock

const net  = require('net');
const path = require('path');

const PIPE_PATH = process.platform === 'win32'
    ? '\\\\.\\pipe\\hikrobot-frame'
    : '/tmp/hikrobot-frame.sock';

// Active client sockets — plain Set, no queue.
const clients = new Set();

// ── Server ───────────────────────────────────────────────────────────────────
const server = net.createServer((socket) => {
    socket.setNoDelay(true);
    clients.add(socket);

    socket.on('error', () => {
        clients.delete(socket);
        socket.destroy();
    });

    socket.on('close', () => {
        clients.delete(socket);
    });
});

// ── notify(meta) ─────────────────────────────────────────────────────────────
// Called by the JS frame pipeline immediately after writing a new frame into
// the memory buffer.  meta = { frameNum, gen, width, height }.
// Each client receives one newline-terminated JSON line.
function notify(meta) {
    if (clients.size === 0) return; // fast path — no connected consumers
    const line = JSON.stringify(meta) + '\n';
    for (const socket of clients) {
        if (!socket.destroyed) socket.write(line);
    }
}

// ── start() ──────────────────────────────────────────────────────────────────
// Binds the server to the named pipe.  Throws if already listening.
function start() {
    server.listen(PIPE_PATH, () => {
        process.stderr.write(`[frameserver] listening on ${PIPE_PATH}\n`);
    });

    server.on('error', (err) => {
        process.stderr.write(`[frameserver] ERROR: ${err.message}\n`);
        throw err; // unrecoverable — surfaces to the parent process
    });
}

// ── stop() ───────────────────────────────────────────────────────────────────
// Destroys all client sockets and closes the server.
function stop() {
    for (const s of clients) s.destroy();
    clients.clear();
    server.close();
}

module.exports = { start, stop, notify, PIPE_PATH };
