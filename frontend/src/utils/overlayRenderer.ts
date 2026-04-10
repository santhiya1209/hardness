// Pure canvas drawing for Vickers indentation overlay.
// Purple machine-style guide lines for D1/D2.

export interface VickersDet {
  d1_mm: number
  d2_mm: number
  hv: number
  confidence: number
  cx_frac: number
  cy_frac: number
  lx_frac: number
  ly_frac: number
  rx_frac: number
  ry_frac: number
  tx_frac: number
  ty_frac: number
  bx_frac: number
  by_frac: number
  img_w: number
  img_h: number
}

export interface OverlayOptions {
  showEdge: boolean
  showGrid: boolean
  /** When false, skip clearRect so a Canny layer underneath is preserved. Default: true */
  clearFirst?: boolean
}

const COL = {
  line: 'rgba(192, 38, 211, 0.95)',
  outline: 'rgba(192, 38, 211, 0.40)',
  xhair: 'rgba(192, 38, 211, 0.18)',
  xhairTick: 'rgba(192, 38, 211, 0.50)',
  detXhair: 'rgba(192, 38, 211, 0.30)',
  dot: 'rgba(216, 80, 255, 0.95)',
  centre: '#e879f9',
  labelD1: '#d946ef',
  labelD2: '#c084fc',
  labelBg: 'rgba(0, 0, 0, 0.60)',
  grid: 'rgba(14, 165, 233, 0.07)',
  conf: 'rgba(192, 38, 211, 0.55)',
}

function getImageRect(imgW: number, imgH: number, canW: number, canH: number) {
  const scale = Math.min(canW / imgW, canH / imgH)
  const drawW = imgW * scale
  const drawH = imgH * scale
  const offX = (canW - drawW) / 2
  const offY = (canH - drawH) / 2
  return { offX, offY, drawW, drawH }
}

function fracToCanvas(fx: number, fy: number, rect: { offX: number; offY: number; drawW: number; drawH: number }): [number, number] {
  return [rect.offX + fx * rect.drawW, rect.offY + fy * rect.drawH]
}

export function renderOverlay(canvas: HTMLCanvasElement, det: VickersDet | null, opts: OverlayOptions): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const W = canvas.width
  const H = canvas.height
  if (opts.clearFirst !== false) ctx.clearRect(0, 0, W, H)

  if (opts.showGrid) drawGrid(ctx, W, H)
  drawCanvasCrosshair(ctx, W, H)
  if (opts.showEdge && det && det.img_w > 0 && det.img_h > 0) {
    drawMachineStyleOverlay(ctx, det, W, H)
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.save()
  ctx.strokeStyle = COL.grid
  ctx.lineWidth = 1
  const STEP = 40
  for (let x = 0; x <= W; x += STEP) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, H)
    ctx.stroke()
  }
  for (let y = 0; y <= H; y += STEP) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y)
    ctx.stroke()
  }
  ctx.restore()
}

function drawCanvasCrosshair(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const cx = W / 2
  const cy = H / 2
  ctx.save()
  ctx.strokeStyle = COL.xhair
  ctx.lineWidth = 1
  ctx.setLineDash([5, 6])
  ctx.beginPath()
  ctx.moveTo(0, cy)
  ctx.lineTo(W, cy)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx, 0)
  ctx.lineTo(cx, H)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.strokeStyle = COL.xhairTick
  ctx.lineWidth = 1.5
  const T = 9
  ctx.beginPath()
  ctx.moveTo(cx - T, cy)
  ctx.lineTo(cx + T, cy)
  ctx.moveTo(cx, cy - T)
  ctx.lineTo(cx, cy + T)
  ctx.stroke()
  ctx.restore()
}

function drawMachineStyleOverlay(ctx: CanvasRenderingContext2D, det: VickersDet, W: number, H: number): void {
  const rect = getImageRect(det.img_w, det.img_h, W, H)
  const toC = (fx: number, fy: number): [number, number] => fracToCanvas(fx, fy, rect)

  const [cx, cy] = toC(det.cx_frac, det.cy_frac)
  const [lx, ly] = toC(det.lx_frac, det.ly_frac)
  const [rx, ry] = toC(det.rx_frac, det.ry_frac)
  const [tx, ty] = toC(det.tx_frac, det.ty_frac)
  const [bx, by] = toC(det.bx_frac, det.by_frac)

  // Detection centre crosshair
  ctx.save()
  ctx.strokeStyle = COL.detXhair
  ctx.lineWidth = 1
  ctx.setLineDash([4, 7])
  ctx.beginPath()
  ctx.moveTo(rect.offX, cy)
  ctx.lineTo(rect.offX + rect.drawW, cy)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx, rect.offY)
  ctx.lineTo(cx, rect.offY + rect.drawH)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()

  // No fill overlay on indentation area to preserve machine color fidelity.
  ctx.save()
  ctx.strokeStyle = COL.outline
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(lx, ly)
  ctx.lineTo(tx, ty)
  ctx.lineTo(rx, ry)
  ctx.lineTo(bx, by)
  ctx.closePath()
  ctx.stroke()
  ctx.restore()

  // Machine-style D1/D2 rails (like yellow machine lines, but purple)
  ctx.save()
  ctx.strokeStyle = COL.line
  ctx.lineWidth = 1.2
  ctx.shadowColor = COL.line
  ctx.shadowBlur = 4
  ctx.beginPath()
  // D1 rails (left/right vertical)
  ctx.moveTo(lx, rect.offY)
  ctx.lineTo(lx, rect.offY + rect.drawH)
  ctx.moveTo(rx, rect.offY)
  ctx.lineTo(rx, rect.offY + rect.drawH)
  // D2 rails (top/bottom horizontal)
  ctx.moveTo(rect.offX, ty)
  ctx.lineTo(rect.offX + rect.drawW, ty)
  ctx.moveTo(rect.offX, by)
  ctx.lineTo(rect.offX + rect.drawW, by)
  ctx.stroke()
  ctx.restore()

  // Feature dots
  ;[[lx, ly], [rx, ry], [tx, ty], [bx, by]].forEach(([x, y]) => {
    ctx.save()
    ctx.fillStyle = COL.dot
    ctx.shadowColor = COL.dot
    ctx.shadowBlur = 6
    ctx.beginPath()
    ctx.arc(x, y, 2.8, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  })

  ctx.save()
  ctx.fillStyle = COL.centre
  ctx.shadowColor = COL.centre
  ctx.shadowBlur = 8
  ctx.beginPath()
  ctx.arc(cx, cy, 3.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // Labels
  const d1_um = (det.d1_mm * 1000).toFixed(1)
  const d2_um = (det.d2_mm * 1000).toFixed(1)
  const d1Text = `D1 ${d1_um} um`
  const d2Text = `D2 ${d2_um} um`

  ctx.save()
  ctx.font = 'bold 11px monospace'
  ctx.fillStyle = COL.labelBg
  const d1X = (lx + rx) / 2
  const d1Y = rect.offY + 14
  const d1W = ctx.measureText(d1Text).width + 10
  ctx.fillRect(d1X - d1W / 2, d1Y - 12, d1W, 15)
  ctx.fillStyle = COL.labelD1
  ctx.textAlign = 'center'
  ctx.fillText(d1Text, d1X, d1Y)

  const d2Y = (ty + by) / 2
  const d2X = rect.offX + rect.drawW - 76
  const d2W = ctx.measureText(d2Text).width + 10
  ctx.fillStyle = COL.labelBg
  ctx.fillRect(d2X - 2, d2Y - 12, d2W, 15)
  ctx.fillStyle = COL.labelD2
  ctx.textAlign = 'left'
  ctx.fillText(d2Text, d2X, d2Y)

  const confText = `conf ${Math.round(det.confidence * 100)}%`
  ctx.textAlign = 'right'
  ctx.font = '10px monospace'
  ctx.fillStyle = COL.conf
  ctx.fillText(confText, rect.offX + rect.drawW - 8, rect.offY + rect.drawH - 8)
  ctx.restore()
}
