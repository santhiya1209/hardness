'use strict';
// backend/image-processing/js/copy.js
// Zero-copy and minimal-copy buffer utilities for the image processing pipeline.
//
// All functions operate on pre-allocated Buffers/TypedArrays.
// No heap allocation on the hot path — the caller owns all memory.
// Strict enforcement: bounds violations throw RangeError immediately.

/**
 * Copy a rectangular ROI from a row-major frame buffer into dst without
 * creating any intermediate allocations.
 *
 * @param {Buffer}  src       Source frame (8 bpp grayscale, row-major)
 * @param {Buffer}  dst       Destination — must be pre-allocated: roiH * roiW bytes
 * @param {number}  srcWidth  Source frame width (pixels)
 * @param {number}  roiX      ROI left edge (pixels, inclusive)
 * @param {number}  roiY      ROI top edge  (pixels, inclusive)
 * @param {number}  roiW      ROI width  (pixels)
 * @param {number}  roiH      ROI height (pixels)
 */
function copyROI(src, dst, srcWidth, roiX, roiY, roiW, roiH) {
    if (dst.length < roiW * roiH)
        throw new RangeError(`copyROI: dst too small (need ${roiW * roiH}, got ${dst.length})`);
    for (let row = 0; row < roiH; ++row) {
        const srcOff = (roiY + row) * srcWidth + roiX;
        const dstOff = row * roiW;
        src.copy(dst, dstOff, srcOff, srcOff + roiW);
    }
}

/**
 * Return a zero-copy Uint8Array view of a single horizontal scan line.
 * The view wraps the underlying ArrayBuffer — no copy is made.
 * Valid only while the underlying Buffer is alive.
 *
 * @param {Buffer}  frame  Row-major 8 bpp frame buffer
 * @param {number}  width  Frame width (pixels)
 * @param {number}  row    Row index (0-based)
 * @returns {Uint8Array}   Subarray of `frame` at that row
 */
function viewRow(frame, width, row) {
    const start = row * width;
    return new Uint8Array(frame.buffer, frame.byteOffset + start, width);
}

/**
 * Copy a vertical column out of a row-major buffer into dst.
 * Columns are non-contiguous in memory, so a copy is unavoidable.
 *
 * @param {Buffer}        frame   Row-major 8 bpp frame buffer
 * @param {number}        width   Frame width (pixels)
 * @param {number}        height  Frame height (pixels)
 * @param {number}        col     Column index (0-based)
 * @param {Uint8Array}    dst     Pre-allocated buffer of at least `height` bytes
 */
function copyColumn(frame, width, height, col, dst) {
    if (dst.length < height)
        throw new RangeError(`copyColumn: dst too small (need ${height}, got ${dst.length})`);
    for (let row = 0; row < height; ++row)
        dst[row] = frame[row * width + col];
}

/**
 * Blit src into dst at the given byte offset — no allocation.
 * Accepts both Buffer and TypedArray as src/dst.
 *
 * @param {Uint8Array|Buffer} src
 * @param {Uint8Array|Buffer} dst
 * @param {number}            dstOffset  Byte offset into dst
 */
function blit(src, dst, dstOffset) {
    if (dstOffset + src.length > dst.length)
        throw new RangeError(
            `blit: dst too small (need ${dstOffset + src.length}, got ${dst.length})`);
    dst.set(src, dstOffset);
}

/**
 * In-place interleave three equal-length planar channel buffers into a packed
 * RGB/BGR output buffer.  No allocation — writes directly into dst.
 *
 * @param {Uint8Array} ch0   Channel 0 (e.g. R or B)
 * @param {Uint8Array} ch1   Channel 1 (e.g. G)
 * @param {Uint8Array} ch2   Channel 2 (e.g. B or R)
 * @param {Uint8Array} dst   Pre-allocated buffer of length ch0.length * 3
 */
function interleave3(ch0, ch1, ch2, dst) {
    const n = ch0.length;
    if (dst.length < n * 3)
        throw new RangeError(`interleave3: dst too small (need ${n * 3}, got ${dst.length})`);
    for (let i = 0, j = 0; i < n; ++i, j += 3) {
        dst[j    ] = ch0[i];
        dst[j + 1] = ch1[i];
        dst[j + 2] = ch2[i];
    }
}

/**
 * Fill a typed array with a constant byte value — faster than a JS loop
 * for large buffers (delegates to native TypedArray.fill).
 *
 * @param {Uint8Array} buf
 * @param {number}     value  Byte value (0–255)
 */
function fill(buf, value) {
    buf.fill(value);
}

/**
 * Make a deep copy of a Buffer region.
 * Use this when you must retain pixel data past the current JS turn
 * (e.g. after memBuffer zero-copy reads).
 *
 * @param {Buffer} src
 * @param {number} [offset=0]
 * @param {number} [length=src.length - offset]
 * @returns {Buffer}  New Buffer containing a copy of the bytes
 */
function deepCopy(src, offset, length) {
    offset = offset == null ? 0 : offset;
    length = length == null ? src.length - offset : length;
    return Buffer.from(src.buffer, src.byteOffset + offset, length).slice();
}

module.exports = { copyROI, viewRow, copyColumn, blit, interleave3, fill, deepCopy };
