'use strict';
// backend/hikrobot/memory-buffer/index.js
// Thin synchronous JS wrapper around the memorybuffer N-API addon.
// All paths are hot — no try/catch, no lazy loading.

const path   = require('path');
const native = require(path.join(__dirname, 'build', 'Release', 'memorybuffer.node'));

/**
 * Maximum frame size the buffer accepts (bytes).
 * Attempting to write a larger frame throws RangeError in C++.
 * @type {number}
 */
const MAX_FRAME_BYTES = native.MAX_FRAME_BYTES;

/**
 * Write raw frame pixels into the triple-buffer.
 * Overwrites the previous spare slot; the last complete frame in the read slot
 * is unaffected until this call completes and publishes the new slot.
 *
 * @param {Buffer}  data      Raw pixel bytes — 8 bpp grayscale, row-major.
 * @param {number}  width     Frame width  (pixels, uint32).
 * @param {number}  height    Frame height (pixels, uint32).
 * @param {number}  frameNum  Frame counter from camera SDK (uint32).
 * @returns {void}
 */
function write(data, width, height, frameNum) {
    native.write(data, width, height, frameNum);
}

/**
 * Read the most recently completed frame — zero-copy.
 *
 * The returned `data` Buffer wraps static C++ memory.
 * It is valid ONLY for the duration of the current synchronous JS turn.
 * Copy it with `Buffer.from(frame.data)` if you need it to outlive this turn.
 *
 * @returns {{ ok: true,  data: Buffer, width: number, height: number,
 *             frameNum: number, size: number, gen: number }
 *          | { ok: false, error: string }}
 */
function read() {
    return native.read();
}

/**
 * Returns the generation counter of the current readable slot (even integer).
 * Advances by 2 per frame written.  Poll this to detect new frames without
 * touching pixel memory.
 *
 * @returns {number}
 */
function getGeneration() {
    return native.getGeneration();
}

module.exports = { MAX_FRAME_BYTES, write, read, getGeneration };
