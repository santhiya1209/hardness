import type { VickersDet } from './overlayRenderer'

function toFiniteNumber(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Camera responses differ slightly between IPC and HTTP wrappers.
// This helper normalizes both into one detection payload.
export function parseCaptureDetection(raw: unknown): VickersDet | null {
  const payload = (raw as any)?.data ?? raw
  const d = payload?.data ?? payload
  if (!d || d.ok === false) return null

  const d1_mm = toFiniteNumber(d.d1_mm)
  const d2_mm = toFiniteNumber(d.d2_mm)
  const hv = toFiniteNumber(d.hv)
  const confidence = toFiniteNumber(d.confidence)
  const cx_frac = toFiniteNumber(d.cx_frac)
  const cy_frac = toFiniteNumber(d.cy_frac)
  const lx_frac = toFiniteNumber(d.lx_frac)
  const ly_frac = toFiniteNumber(d.ly_frac)
  const rx_frac = toFiniteNumber(d.rx_frac)
  const ry_frac = toFiniteNumber(d.ry_frac)
  const tx_frac = toFiniteNumber(d.tx_frac)
  const ty_frac = toFiniteNumber(d.ty_frac)
  const bx_frac = toFiniteNumber(d.bx_frac)
  const by_frac = toFiniteNumber(d.by_frac)
  const img_w = toFiniteNumber(d.img_w)
  const img_h = toFiniteNumber(d.img_h)

  if (
    d1_mm == null || d2_mm == null || hv == null || confidence == null ||
    cx_frac == null || cy_frac == null ||
    lx_frac == null || ly_frac == null ||
    rx_frac == null || ry_frac == null ||
    tx_frac == null || ty_frac == null ||
    bx_frac == null || by_frac == null ||
    img_w == null || img_h == null
  ) {
    return null
  }
  if (d1_mm <= 0 || d2_mm <= 0 || img_w <= 0 || img_h <= 0) return null

  return {
    d1_mm,
    d2_mm,
    hv,
    confidence,
    cx_frac,
    cy_frac,
    lx_frac,
    ly_frac,
    rx_frac,
    ry_frac,
    tx_frac,
    ty_frac,
    bx_frac,
    by_frac,
    img_w,
    img_h,
  }
}

export function parseCalibrateResult(raw: unknown): {
  ok: boolean
  px_per_mm: number
  offset_hv: number
  measured_hv: number
  error_pct: number
  message: string
} | null {
  const payload = (raw as any)?.data ?? raw
  const d = payload?.data ?? payload
  if (!d) return null

  const ok = Boolean(d.ok === true || d.success === true)
  const px_per_mm = toFiniteNumber(d.px_per_mm)
  const offset_hv = toFiniteNumber(d.offset_hv ?? d.offset)
  const measured_hv = toFiniteNumber(d.measured_hv ?? d.measured)
  const error_pct = toFiniteNumber(d.error_pct)
  const message = typeof d.message === 'string' ? d.message : ''

  if (
    px_per_mm == null ||
    offset_hv == null ||
    measured_hv == null ||
    error_pct == null
  ) {
    return null
  }

  return { ok, px_per_mm, offset_hv, measured_hv, error_pct, message }
}

