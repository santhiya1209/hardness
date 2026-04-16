'use strict';
// backend/image-processing/js/getLine.js
// Scan-line extraction and 1-D analysis utilities for Vickers indentation.
//
// All functions operate on pre-allocated typed arrays.
// No heap allocation on the hot path — scratch buffers are caller-supplied.
// Strict mode: invalid arguments throw TypeError/RangeError immediately.

const { viewRow, copyColumn } = require('./copy');

// ── Horizontal line ──────────────────────────────────────────────────────────

/**
 * Return a zero-copy Uint8Array view of a single horizontal scan line.
 * The view is only valid while the underlying Buffer is alive.
 *
 * @param {Buffer}  frame  Row-major 8 bpp grayscale frame buffer
 * @param {number}  width  Frame width (pixels)
 * @param {number}  row    Row index (0-based)
 * @returns {Uint8Array}
 */
function getHorizontalLine(frame, width, row) {
    return viewRow(frame, width, row);
}

// ── Vertical line ────────────────────────────────────────────────────────────

/**
 * Copy a vertical scan line into scratch (columns are non-contiguous).
 *
 * @param {Buffer}     frame    Row-major 8 bpp grayscale frame
 * @param {number}     width    Frame width (pixels)
 * @param {number}     height   Frame height (pixels)
 * @param {number}     col      Column index (0-based)
 * @param {Uint8Array} scratch  Pre-allocated buffer of at least `height` bytes
 * @returns {Uint8Array}        View into scratch filled with column pixel values
 */
function getVerticalLine(frame, width, height, col, scratch) {
    if (scratch.length < height)
        throw new RangeError(`getVerticalLine: scratch too small (need ${height}, got ${scratch.length})`);
    copyColumn(frame, width, height, col, scratch);
    return new Uint8Array(scratch.buffer, scratch.byteOffset, height);
}

// ── Edge detection (1-D derivative threshold) ────────────────────────────────

/**
 * Locate rising and falling edge positions in a 1-D scan line using a
 * first-derivative threshold.
 *
 * @param {Uint8Array} line       Pixel values
 * @param {number}     threshold  Absolute gradient magnitude to qualify as edge
 * @returns {{ rising: number[], falling: number[] }}
 *   rising  — indices where intensity increases sharply (dark→bright)
 *   falling — indices where intensity decreases sharply (bright→dark)
 */
function findEdges(line, threshold) {
    const rising  = [];
    const falling = [];
    const n       = line.length;
    for (let i = 1; i < n; ++i) {
        const d = (line[i] | 0) - (line[i - 1] | 0);
        if ( d >  threshold) rising.push(i);
        if (-d >  threshold) falling.push(i);
    }
    return { rising, falling };
}

// ── Dark-span measurement ─────────────────────────────────────────────────────

/**
 * Measure the pixel span of the widest contiguous dark region in a scan line.
 * Used to locate the indentation boundary along one axis.
 *
 * @param {Uint8Array} line        Pixel values (0–255)
 * @param {number}     darkThresh  Pixels strictly below this value are "dark"
 * @returns {{ start: number, end: number, width: number } | null}
 *   null if no dark region satisfying darkThresh is found.
 */
function measureDarkSpan(line, darkThresh) {
    let bestStart = -1, bestLen = 0;
    let curStart  = -1, curLen  = 0;

    for (let i = 0; i < line.length; ++i) {
        if (line[i] < darkThresh) {
            if (curStart < 0) curStart = i;
            curLen++;
        } else {
            if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
            curStart = -1; curLen = 0;
        }
    }
    // Handle run extending to the last pixel
    if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }

    if (bestStart < 0) return null;
    return { start: bestStart, end: bestStart + bestLen - 1, width: bestLen };
}

// ── Diagonal measurement ─────────────────────────────────────────────────────

/**
 * Measure the pixel widths of both diagonals of a Vickers indentation
 * through a given centre point using orthogonal scan lines.
 *
 * @param {Buffer}     frame      Row-major 8 bpp grayscale frame
 * @param {number}     width      Frame width (pixels)
 * @param {number}     height     Frame height (pixels)
 * @param {number}     cx         Approximate centre X (pixels)
 * @param {number}     cy         Approximate centre Y (pixels)
 * @param {number}     darkThresh Dark-pixel threshold (default 80)
 * @param {Uint8Array} scratch    Pre-allocated buffer of ≥ max(width, height) bytes
 * @returns {{ d1_px, d1_start, d1_end, d2_px, d2_start, d2_end } | null}
 *   d1 = horizontal diagonal (scan row cy)
 *   d2 = vertical   diagonal (scan col cx)
 *   null if either span cannot be measured.
 */
function measureDiagonals(frame, width, height, cx, cy, darkThresh, scratch) {
    darkThresh = (darkThresh == null) ? 80 : darkThresh;

    const rowIdx = Math.round(cy);
    const colIdx = Math.round(cx);

    if (rowIdx < 0 || rowIdx >= height)
        throw new RangeError(`measureDiagonals: cy=${cy} out of [0, ${height})`);
    if (colIdx < 0 || colIdx >= width)
        throw new RangeError(`measureDiagonals: cx=${cx} out of [0, ${width})`);

    const hLine = getHorizontalLine(frame, width, rowIdx);
    const hSpan = measureDarkSpan(hLine, darkThresh);

    const vLine = getVerticalLine(frame, width, height, colIdx, scratch);
    const vSpan = measureDarkSpan(vLine, darkThresh);

    if (!hSpan || !vSpan) return null;

    return {
        d1_px:    hSpan.width,
        d1_start: hSpan.start,
        d1_end:   hSpan.end,
        d2_px:    vSpan.width,
        d2_start: vSpan.start,
        d2_end:   vSpan.end
    };
}

// ── Running mean of a scan line (boxcar) ─────────────────────────────────────

/**
 * Compute a boxcar (rectangular) running mean of a scan line.
 * Uses a prefix-sum for O(n) regardless of radius.
 *
 * @param {Uint8Array} line   Input pixel values
 * @param {number}     radius Half-window radius (inclusive)
 * @param {Float32Array} dst  Pre-allocated output of same length as line
 * @returns {Float32Array}    dst filled with smoothed values
 */
function runningMean(line, radius, dst) {
    const n = line.length;
    if (dst.length < n)
        throw new RangeError(`runningMean: dst too small (need ${n}, got ${dst.length})`);
    // Build prefix sum
    const prefix = new Float64Array(n + 1);
    for (let i = 0; i < n; ++i) prefix[i + 1] = prefix[i] + line[i];
    for (let i = 0; i < n; ++i) {
        const lo  = Math.max(0,   i - radius);
        const hi  = Math.min(n-1, i + radius);
        const cnt = hi - lo + 1;
        dst[i] = (prefix[hi + 1] - prefix[lo]) / cnt;
    }
    return dst;
}

module.exports = {
    getHorizontalLine,
    getVerticalLine,
    findEdges,
    measureDarkSpan,
    measureDiagonals,
    runningMean
};
