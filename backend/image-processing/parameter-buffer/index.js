'use strict';
// backend/image-processing/parameter-buffer/index.js
// JS wrapper for the parambuffer N-API addon.
// All functions map 1-to-1 to C++ exports — no additional logic.

const path   = require('path');
const native = require(path.join(__dirname, 'build', 'Release', 'parambuffer.node'));

// ── Constants ────────────────────────────────────────────────────────────────
// Re-export every PARAM_<name> index constant from C++ so callers can do:
//   paramBuf.PARAM_pxPerMm  → 3
const PARAM_COUNT        = native.PARAM_COUNT;
const PARAM_exposureUs   = native.PARAM_exposureUs;
const PARAM_gainDb       = native.PARAM_gainDb;
const PARAM_gamma        = native.PARAM_gamma;
const PARAM_pxPerMm      = native.PARAM_pxPerMm;
const PARAM_cannyT1      = native.PARAM_cannyT1;
const PARAM_cannyT2      = native.PARAM_cannyT2;
const PARAM_loadKgf      = native.PARAM_loadKgf;
const PARAM_blackLevel   = native.PARAM_blackLevel;
const PARAM_contrast     = native.PARAM_contrast;

/**
 * Set one parameter by name.
 * @param {string} name   One of: exposureUs, gainDb, gamma, pxPerMm,
 *                        cannyT1, cannyT2, loadKgf, blackLevel, contrast
 * @param {number} value  Float value.
 */
function setParam(name, value) {
    native.setParam(name, value);
}

/**
 * Get one parameter by name.
 * @param {string} name
 * @returns {number}
 */
function getParam(name) {
    return native.getParam(name);
}

/**
 * Batch-set parameters from a plain object.
 * Unknown keys are ignored; missing keys are left unchanged.
 * @param {{ exposureUs?, gainDb?, gamma?, pxPerMm?,
 *           cannyT1?, cannyT2?, loadKgf?,
 *           blackLevel?, contrast? }} params
 */
function setAll(params) {
    native.setAll(params);
}

/**
 * Read all parameters as a plain object.
 * @returns {{ exposureUs: number, gainDb: number, gamma: number,
 *             pxPerMm: number, cannyT1: number, cannyT2: number,
 *             loadKgf: number, blackLevel: number, contrast: number }}
 */
function getAll() {
    return native.getAll();
}

/**
 * Return a packed Buffer<float32> of PARAM_COUNT floats in declaration order.
 * For C-side consumers that read the buffer directly (avoids JS object overhead).
 * @returns {Buffer}
 */
function getRawBuffer() {
    return native.getRawBuffer();
}

module.exports = {
    setParam, getParam, setAll, getAll, getRawBuffer,
    PARAM_COUNT,
    PARAM_exposureUs, PARAM_gainDb, PARAM_gamma, PARAM_pxPerMm,
    PARAM_cannyT1,    PARAM_cannyT2, PARAM_loadKgf,
    PARAM_blackLevel, PARAM_contrast
};
