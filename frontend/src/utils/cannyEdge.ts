// Pure JavaScript Canny edge detection
// No OpenCV / no native dependencies.
// Designed for real-time use: processes at reduced resolution then scales back.

const GAUSS5 = [
  2,  4,  5,  4,  2,
  4,  9, 12,  9,  4,
  5, 12, 15, 12,  5,
  4,  9, 12,  9,  4,
  2,  4,  5,  4,  2,
].map(v => v / 159)

/** Convert RGBA ImageData to grayscale Float32 array */
function toGray(data: Uint8ClampedArray, W: number, H: number): Float32Array {
  const g = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) {
    g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  }
  return g
}

/** 5×5 Gaussian blur */
function gaussBlur(gray: Float32Array, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0, w = 0
      for (let ky = -2; ky <= 2; ky++) {
        const ny = y + ky
        if (ny < 0 || ny >= H) continue
        for (let kx = -2; kx <= 2; kx++) {
          const nx = x + kx
          if (nx < 0 || nx >= W) continue
          const k = GAUSS5[(ky + 2) * 5 + (kx + 2)]
          s += gray[ny * W + nx] * k
          w += k
        }
      }
      out[y * W + x] = s / w
    }
  }
  return out
}

/** Sobel gradients — returns [magnitude, direction] */
function sobel(blur: Float32Array, W: number, H: number): [Float32Array, Float32Array] {
  const mag = new Float32Array(W * H)
  const dir = new Float32Array(W * H)
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const g = (dy: number, dx: number) => blur[(y + dy) * W + (x + dx)]
      const gx = -g(-1,-1) + g(-1,1) - 2*g(0,-1) + 2*g(0,1) - g(1,-1) + g(1,1)
      const gy = -g(-1,-1) - 2*g(-1,0) - g(-1,1) + g(1,-1) + 2*g(1,0) + g(1,1)
      const i = y * W + x
      mag[i] = Math.sqrt(gx * gx + gy * gy)
      dir[i] = Math.atan2(gy, gx)
    }
  }
  return [mag, dir]
}

/** Non-maximum suppression along gradient direction */
function nms(mag: Float32Array, dir: Float32Array, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H)
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      const m = mag[i]
      // Quantise direction to 0/45/90/135 degrees
      const d = ((dir[i] * 180 / Math.PI) + 180) % 180
      let n1: number, n2: number
      if (d < 22.5 || d >= 157.5)         { n1 = mag[i - 1];              n2 = mag[i + 1] }
      else if (d < 67.5)                   { n1 = mag[(y-1)*W+(x+1)];     n2 = mag[(y+1)*W+(x-1)] }
      else if (d < 112.5)                  { n1 = mag[(y-1)*W+x];         n2 = mag[(y+1)*W+x] }
      else                                  { n1 = mag[(y-1)*W+(x-1)];    n2 = mag[(y+1)*W+(x+1)] }
      out[i] = m >= n1 && m >= n2 ? m : 0
    }
  }
  return out
}

const STRONG = 255
const WEAK   = 128

/** Double threshold + hysteresis */
function threshold(sup: Float32Array, W: number, H: number, lo: number, hi: number): Uint8Array {
  const e = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) {
    if      (sup[i] >= hi) e[i] = STRONG
    else if (sup[i] >= lo) e[i] = WEAK
  }
  // Single-pass hysteresis (good enough for real-time)
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (e[y*W+x] !== WEAK) continue
      const hasStrong =
        e[(y-1)*W+(x-1)] === STRONG || e[(y-1)*W+x] === STRONG || e[(y-1)*W+(x+1)] === STRONG ||
        e[ y   *W+(x-1)] === STRONG ||                              e[ y   *W+(x+1)] === STRONG ||
        e[(y+1)*W+(x-1)] === STRONG || e[(y+1)*W+x] === STRONG || e[(y+1)*W+(x+1)] === STRONG
      e[y*W+x] = hasStrong ? STRONG : 0
    }
  }
  return e
}

export interface CannyOptions {
  lowThreshold:  number   // default 20
  highThreshold: number   // default 55
  /** Processing scale factor 0.25–1.0. Lower = faster, coarser. Default 0.5 */
  scale:         number
  /** RGBA colour of edge pixels [r,g,b,a]. Default bright cyan */
  edgeRgba:      [number, number, number, number]
}

const DEFAULT_OPTS: CannyOptions = {
  lowThreshold:  20,
  highThreshold: 55,
  scale:         0.5,
  edgeRgba:      [0, 255, 180, 230],
}

/**
 * Draw Canny edges from an image element onto a canvas.
 * The canvas is cleared first; edge pixels are drawn in edgeRgba colour,
 * non-edge pixels remain transparent so the underlying <img> shows through.
 *
 * @param img    Source HTMLImageElement (must be loaded)
 * @param canvas Target canvas (will be written at its current width/height)
 * @param opts   Canny parameters
 * @returns true if edges were drawn
 */
export function drawCannyEdges(
  img: HTMLImageElement,
  canvas: HTMLCanvasElement,
  opts: Partial<CannyOptions> = {},
): boolean {
  const o = { ...DEFAULT_OPTS, ...opts }
  const CW = canvas.width
  const CH = canvas.height
  if (!CW || !CH || !img.naturalWidth || !img.naturalHeight) return false

  const ctx = canvas.getContext('2d')
  if (!ctx) return false

  // ── 1. Determine letterbox rect (same as overlayRenderer.getImageRect) ──
  const imgW = img.naturalWidth
  const imgH = img.naturalHeight
  const scale = Math.min(CW / imgW, CH / imgH)
  const dW = imgW * scale
  const dH = imgH * scale
  const offX = (CW - dW) / 2
  const offY = (CH - dH) / 2

  // ── 2. Render image into offscreen canvas at processing resolution ──
  const procW = Math.round(dW * o.scale)
  const procH = Math.round(dH * o.scale)
  if (procW < 8 || procH < 8) return false

  const off = new OffscreenCanvas(procW, procH)
  const offCtx = off.getContext('2d')
  if (!offCtx) return false
  offCtx.drawImage(img, 0, 0, imgW, imgH, 0, 0, procW, procH)
  const srcData = offCtx.getImageData(0, 0, procW, procH)

  // ── 3. Canny pipeline ──
  const gray    = toGray(srcData.data, procW, procH)
  const blurred = gaussBlur(gray, procW, procH)
  const [mag, dir] = sobel(blurred, procW, procH)
  const sup     = nms(mag, dir, procW, procH)
  const edges   = threshold(sup, procW, procH, o.lowThreshold, o.highThreshold)

  // ── 4. Write edge pixels into output ImageData (at processing size) ──
  const outData = new ImageData(procW, procH)
  const [er, eg, eb, ea] = o.edgeRgba
  for (let i = 0; i < procW * procH; i++) {
    if (edges[i] === STRONG) {
      outData.data[i * 4]     = er
      outData.data[i * 4 + 1] = eg
      outData.data[i * 4 + 2] = eb
      outData.data[i * 4 + 3] = ea
    }
    // else: alpha=0, transparent
  }

  // ── 5. Draw onto the main canvas at the letterboxed position ──
  ctx.clearRect(0, 0, CW, CH)

  // Scale edge image back to display size
  const edgeOff = new OffscreenCanvas(procW, procH)
  const edgeOffCtx = edgeOff.getContext('2d')
  if (!edgeOffCtx) return false
  edgeOffCtx.putImageData(outData, 0, 0)

  // Disable image smoothing for sharper edges
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(edgeOff, 0, 0, procW, procH, offX, offY, dW, dH)

  return true
}

/**
 * Draw Canny edges from a video element onto a canvas.
 * Same semantics as drawCannyEdges for HTMLImageElement.
 */
export function drawCannyEdgesFromVideo(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  opts: Partial<CannyOptions> = {},
): boolean {
  const o = { ...DEFAULT_OPTS, ...opts }
  const CW = canvas.width
  const CH = canvas.height
  if (!CW || !CH || !video.videoWidth || !video.videoHeight) return false

  const ctx = canvas.getContext('2d')
  if (!ctx) return false

  const imgW = video.videoWidth
  const imgH = video.videoHeight
  const scale = Math.min(CW / imgW, CW / imgH)
  const dW = imgW * scale
  const dH = imgH * scale
  const offX = (CW - dW) / 2
  const offY = (CH - dH) / 2

  const procW = Math.round(dW * o.scale)
  const procH = Math.round(dH * o.scale)
  if (procW < 8 || procH < 8) return false

  const off = new OffscreenCanvas(procW, procH)
  const offCtx = off.getContext('2d')
  if (!offCtx) return false
  offCtx.drawImage(video, 0, 0, imgW, imgH, 0, 0, procW, procH)
  const srcData = offCtx.getImageData(0, 0, procW, procH)

  const gray    = toGray(srcData.data, procW, procH)
  const blurred = gaussBlur(gray, procW, procH)
  const [mag, dir] = sobel(blurred, procW, procH)
  const sup     = nms(mag, dir, procW, procH)
  const edges   = threshold(sup, procW, procH, o.lowThreshold, o.highThreshold)

  const outData = new ImageData(procW, procH)
  const [er, eg, eb, ea] = o.edgeRgba
  for (let i = 0; i < procW * procH; i++) {
    if (edges[i] === STRONG) {
      outData.data[i * 4]     = er
      outData.data[i * 4 + 1] = eg
      outData.data[i * 4 + 2] = eb
      outData.data[i * 4 + 3] = ea
    }
  }

  ctx.clearRect(0, 0, CW, CH)
  const edgeOff = new OffscreenCanvas(procW, procH)
  const edgeOffCtx = edgeOff.getContext('2d')
  if (!edgeOffCtx) return false
  edgeOffCtx.putImageData(outData, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(edgeOff, 0, 0, procW, procH, offX, offY, dW, dH)

  return true
}
