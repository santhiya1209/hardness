import { useCallback, useEffect, useRef, useState } from 'react'
import CameraShell, { cam, C } from '../components/camera/CameraShell'
import { renderOverlay } from '../utils/overlayRenderer'
import type { VickersDet } from '../utils/overlayRenderer'
import { parseCalibrateResult, parseCaptureDetection } from '../utils/captureDetection'
import './CalibrationPage.css'

const CALIB_KEY = 'htp_calib'

interface CalibData {
  px_per_mm: number
  offset_hv: number
  ref_hv?: number
  measured_hv?: number
  date?: number
}

interface Pt {
  x: number
  y: number
}

type CalibMode = 'point' | 'auto'
type BannerKind = 'success' | 'error' | 'warn'

const LOADS = [0.1, 0.3, 0.5, 1, 2, 5, 10, 20, 30, 50]

function getCalib(): CalibData {
  try {
    return JSON.parse(localStorage.getItem(CALIB_KEY) || 'null') || { px_per_mm: 100, offset_hv: 0 }
  } catch {
    return { px_per_mm: 100, offset_hv: 0 }
  }
}

function persistCalib(c: CalibData) {
  localStorage.setItem(CALIB_KEY, JSON.stringify(c))
}

export default function CalibrationPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pt1Ref = useRef<Pt | null>(null)
  const pt2Ref = useRef<Pt | null>(null)
  const modeRef = useRef<CalibMode>('point')
  const frameRef = useRef(0)
  const detectBusy = useRef(false)

  const [mode, setMode] = useState<CalibMode>('point')
  const [calib, setCalibState] = useState<CalibData>(getCalib)
  const [running, setRunning] = useState(false)

  const [knownLen, setKnownLen] = useState('')
  const [unit, setUnit] = useState<'mm' | 'um'>('mm')
  const [pt1, setPt1] = useState<Pt | null>(null)
  const [pt2, setPt2] = useState<Pt | null>(null)
  const [pixelDist, setPixelDist] = useState<number | null>(null)
  const [scale, setScale] = useState<number | null>(null)

  const [refHv, setRefHv] = useState(200)
  const [refLoad, setRefLoad] = useState(10)
  const [autoResult, setAutoResult] = useState<{
    px_per_mm: number
    offset_hv: number
    measured_hv: number
    error_pct: number
  } | null>(null)
  const [autoDet, setAutoDet] = useState<VickersDet | null>(null)

  const [banner, setBanner] = useState<{ kind: BannerKind; msg: string } | null>(null)

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  const drawPointOverlay = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width
    const H = canvas.height
    ctx.clearRect(0, 0, W, H)

    ctx.save()
    ctx.strokeStyle = 'rgba(14,165,233,0.22)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 7])
    ctx.beginPath()
    ctx.moveTo(0, H / 2)
    ctx.lineTo(W, H / 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(W / 2, 0)
    ctx.lineTo(W / 2, H)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()

    const p1 = pt1Ref.current
    const p2 = pt2Ref.current
    if (modeRef.current !== 'point' || !p1) return

    const drawPt = (p: Pt, color: string, label: string) => {
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(p.x - 11, p.y)
      ctx.lineTo(p.x + 11, p.y)
      ctx.moveTo(p.x, p.y - 11)
      ctx.lineTo(p.x, p.y + 11)
      ctx.stroke()
      ctx.font = 'bold 11px monospace'
      ctx.fillStyle = color
      ctx.fillText(label, p.x + 9, p.y - 7)
    }

    drawPt(p1, '#22c55e', 'P1')
    if (p2) {
      drawPt(p2, '#f59e0b', 'P2')
      ctx.strokeStyle = '#0ea5e9'
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.moveTo(p1.x, p1.y)
      ctx.lineTo(p2.x, p2.y)
      ctx.stroke()
      ctx.setLineDash([])

      const dx = p2.x - p1.x
      const dy = p2.y - p1.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      const mx = (p1.x + p2.x) / 2
      const my = (p1.y + p2.y) / 2
      ctx.font = 'bold 11px monospace'
      ctx.fillStyle = '#38bdf8'
      ctx.textAlign = 'center'
      ctx.fillText(`${dist.toFixed(1)} px`, mx, my - 9)
      ctx.textAlign = 'left'
    }
  }, [])

  useEffect(() => {
    if (pt1 && pt2) {
      const dx = pt2.x - pt1.x
      const dy = pt2.y - pt1.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      setPixelDist(dist)
      const val = parseFloat(knownLen)
      if (!isNaN(val) && val > 0) {
        const mm = unit === 'um' ? val / 1000 : val
        setScale(dist / mm)
      } else {
        setScale(null)
      }
    } else {
      setPixelDist(null)
      setScale(null)
    }
  }, [pt1, pt2, knownLen, unit])

  useEffect(() => {
    if (mode === 'point') drawPointOverlay()
  }, [mode, pt1, pt2, drawPointOverlay])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onClick = (e: MouseEvent) => {
      if (modeRef.current !== 'point') return
      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      const x = (e.clientX - rect.left) * scaleX
      const y = (e.clientY - rect.top) * scaleY
      if (!pt1Ref.current || pt2Ref.current) {
        pt1Ref.current = { x, y }
        pt2Ref.current = null
        setPt1({ x, y })
        setPt2(null)
      } else {
        pt2Ref.current = { x, y }
        setPt2({ x, y })
      }
    }
    canvas.addEventListener('click', onClick)
    return () => canvas.removeEventListener('click', onClick)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (mode === 'point') {
      canvas.style.pointerEvents = 'auto'
      canvas.style.cursor = 'crosshair'
      drawPointOverlay()
      return
    }
    canvas.style.pointerEvents = 'none'
    canvas.style.cursor = 'default'
    renderOverlay(canvas, autoDet, { showEdge: !!autoDet, showGrid: false })
  }, [mode, autoDet, drawPointOverlay])

  const onFrameLoad = useCallback(async () => {
    if (modeRef.current === 'point') {
      drawPointOverlay()
      return
    }
    frameRef.current += 1
    if (frameRef.current % 10 !== 0) return
    if (detectBusy.current) return
    detectBusy.current = true
    try {
      const raw = await cam.post('/capture', { load_kgf: refLoad })
      const det = parseCaptureDetection(raw)
      setAutoDet(det)
      const canvas = canvasRef.current
      if (canvas) renderOverlay(canvas, det, { showEdge: !!det, showGrid: false })
    } catch {
      // ignore frame detection errors
    } finally {
      detectBusy.current = false
    }
  }, [drawPointOverlay, refLoad])

  const flash = (kind: BannerKind, msg: string) => {
    setBanner({ kind, msg })
    setTimeout(() => setBanner(null), 4000)
  }

  const clearPoints = () => {
    pt1Ref.current = null
    pt2Ref.current = null
    setPt1(null)
    setPt2(null)
    setPixelDist(null)
    setScale(null)
    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
      drawPointOverlay()
    }
  }

  const saveScale = () => {
    if (scale == null) return
    const c: CalibData = { ...getCalib(), px_per_mm: +scale.toFixed(2), date: Date.now() }
    persistCalib(c)
    setCalibState(getCalib())
    flash('success', `Saved - px/mm: ${scale.toFixed(2)}`)
  }

  const runAutoCalib = async () => {
    setRunning(true)
    setBanner(null)
    setAutoResult(null)
    try {
      const raw = await cam.post('/calibrate', { reference: refHv, load_kgf: refLoad })
      const d = parseCalibrateResult(raw)
      if (!d || !d.ok) throw new Error(d?.message || 'Calibration failed')

      setAutoResult({
        px_per_mm: d.px_per_mm,
        offset_hv: d.offset_hv,
        measured_hv: d.measured_hv,
        error_pct: d.error_pct,
      })

      const c: CalibData = {
        ...getCalib(),
        px_per_mm: d.px_per_mm || getCalib().px_per_mm,
        offset_hv: d.offset_hv,
        ref_hv: refHv,
        measured_hv: d.measured_hv,
        date: Date.now(),
      }
      persistCalib(c)
      setCalibState(getCalib())
      flash(Math.abs(d.error_pct) < 2 ? 'success' : 'warn', `Calibrated - Error: ${d.error_pct.toFixed(2)}%`)
    } catch (e: any) {
      flash('error', e.message || 'Calibration failed')
    } finally {
      setRunning(false)
    }
  }

  const resetCalib = () => {
    if (!confirm('Reset calibration to factory defaults?')) return
    const c: CalibData = { px_per_mm: 100, offset_hv: 0 }
    persistCalib(c)
    setCalibState(c)
    clearPoints()
    setAutoResult(null)
    setAutoDet(null)
    flash('success', 'Reset to defaults - px/mm: 100')
  }

  const errPct = calib.measured_hv && calib.ref_hv ? ((calib.measured_hv - calib.ref_hv) / calib.ref_hv) * 100 : null

  const extraToolbar = (
    <>
      <div className="cp-tb-modes">
        {(['point', 'auto'] as CalibMode[]).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`cp-tb-mode-btn${mode === m ? ' active' : ''}`}>
            <i className={`fa-solid ${m === 'point' ? 'fa-ruler' : 'fa-wand-magic-sparkles'}`} />
            {m === 'point' ? 'Point-to-Point' : 'Auto Detect'}
          </button>
        ))}
      </div>
      {mode === 'point' && (
        <span className="cp-tb-hint">{!pt1 ? '-> click P1 on image' : !pt2 ? '-> click P2' : `${pixelDist?.toFixed(1)} px`}</span>
      )}
      {mode === 'auto' && autoDet && (
        <span className="cp-tb-hint">
          D1 {(autoDet.d1_mm * 1000).toFixed(1)} um | D2 {(autoDet.d2_mm * 1000).toFixed(1)} um
        </span>
      )}
    </>
  )

  return (
    <CameraShell
      pageTitle="Calibration"
      pageSub={`px/mm: ${calib.px_per_mm}`}
      canvasRef={canvasRef as React.RefObject<HTMLCanvasElement>}
      onFrameLoad={onFrameLoad}
      extraToolbar={extraToolbar}
    >
      <div className="cp-panel">
        <div className="cp-panel-hdr">
          <div className="cp-panel-hdr-title">
            <i className="fa-solid fa-ruler-combined" />
            Calibration
          </div>
          <div className="cp-panel-hdr-sub">px/mm | scale | HV offset</div>
        </div>

        {banner && (
          <div className={`cp-banner cp-banner--${banner.kind}`}>
            <i className={`fa-solid ${banner.kind === 'success' ? 'fa-circle-check' : banner.kind === 'error' ? 'fa-circle-xmark' : 'fa-triangle-exclamation'}`} />
            {banner.msg}
          </div>
        )}

        <div className="cp-scroll">
          {mode === 'point' && (
            <>
              <div className="cp-card">
                <div className="cp-card-title">
                  <i className="fa-solid fa-circle-dot" style={{ color: C.accent }} />
                  Point Selection
                </div>
                <p className="cp-hint-text">
                  Click <span className="cp-hint-p1">P1</span> then <span className="cp-hint-p2">P2</span> on a known-length feature in the camera view.
                </p>
                <div className="cp-pt-row">
                  {[
                    { label: 'P1', pt: pt1, cls: 'cp-pt-chip--p1' },
                    { label: 'P2', pt: pt2, cls: 'cp-pt-chip--p2' },
                  ].map(({ label, pt: p, cls }) => (
                    <div key={label} className={`cp-pt-chip${p ? ` ${cls}` : ''}`}>
                      <div className="cp-pt-chip-label">{label}</div>
                      <div className="cp-pt-chip-val">{p ? `${p.x.toFixed(0)}, ${p.y.toFixed(0)}` : '-'}</div>
                    </div>
                  ))}
                </div>
                <div className="cp-readout">
                  <div className="cp-readout-label">Pixel Distance</div>
                  <div className={`cp-readout-val${pixelDist ? ' cp-readout-val--active' : ''}`}>{pixelDist ? `${pixelDist.toFixed(2)} px` : '-'}</div>
                </div>
                <button className="cp-btn cp-btn--ghost" onClick={clearPoints}>
                  <i className="fa-solid fa-trash" /> Clear Points
                </button>
              </div>

              <div className="cp-card">
                <div className="cp-card-title">
                  <i className="fa-solid fa-ruler" style={{ color: C.accent }} />
                  Known Physical Length
                </div>
                <div className="cp-form-row">
                  <div className="cp-form-group cp-form-group--flex">
                    <label className="cp-label">Length</label>
                    <input type="number" className="cp-input" value={knownLen} placeholder="e.g. 0.100" onChange={(e) => setKnownLen(e.target.value)} />
                  </div>
                  <div className="cp-form-group cp-form-group--unit">
                    <label className="cp-label">Unit</label>
                    <select className="cp-input" value={unit} onChange={(e) => setUnit(e.target.value as 'mm' | 'um')}>
                      <option value="mm">mm</option>
                      <option value="um">um</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="cp-card">
                <div className="cp-card-title">
                  <i className="fa-solid fa-calculator" style={{ color: C.accent }} />
                  Computed Scale
                </div>
                <div className="cp-scale-display">
                  <div className={`cp-scale-big${scale ? ' cp-scale-big--active' : ''}`}>{scale ? scale.toFixed(2) : '-'}</div>
                  <div className="cp-scale-unit">pixels per millimetre</div>
                </div>
                {scale != null && (
                  <div className="cp-data-table">
                    <DataRow label="um / pixel" value={`${(1000 / scale).toFixed(4)} um/px`} />
                    <DataRow label="vs. stored" value={`Delta ${(scale - calib.px_per_mm).toFixed(2)} px/mm`} />
                  </div>
                )}
                <div className="cp-btn-row">
                  <button className={`cp-btn cp-btn--primary${!scale ? ' cp-btn--disabled' : ''}`} onClick={saveScale} disabled={!scale}>
                    <i className="fa-solid fa-floppy-disk" /> Save Calibration
                  </button>
                  <button className="cp-btn cp-btn--icon" onClick={resetCalib} title="Reset to defaults">
                    <i className="fa-solid fa-rotate-left" />
                  </button>
                </div>
              </div>
            </>
          )}

          {mode === 'auto' && (
            <>
              <div className="cp-card">
                <div className="cp-card-title">
                  <i className="fa-solid fa-wand-magic-sparkles" style={{ color: C.accent }} />
                  Reference Block Auto-Calibration
                </div>
                <p className="cp-hint-text">
                  Live contour detection is running on the camera image. Place a certified Vickers reference block and calibrate.
                </p>
                <div className="cp-form-row">
                  <div className="cp-form-group cp-form-group--flex">
                    <label className="cp-label">Reference HV</label>
                    <input type="number" className="cp-input" value={refHv} min={1} onChange={(e) => setRefHv(+e.target.value)} />
                  </div>
                  <div className="cp-form-group cp-form-group--flex">
                    <label className="cp-label">Test Load (kgf)</label>
                    <select className="cp-input" value={refLoad} onChange={(e) => setRefLoad(+e.target.value)}>
                      {LOADS.map((l) => <option key={l} value={l}>{l} kgf</option>)}
                    </select>
                  </div>
                </div>
                <button className={`cp-btn cp-btn--primary${running ? ' cp-btn--disabled' : ''}`} onClick={runAutoCalib} disabled={running}>
                  <i className={`fa-solid ${running ? 'fa-circle-notch fa-spin' : 'fa-crosshairs'}`} />
                  {running ? 'Detecting...' : 'Capture & Calibrate'}
                </button>
              </div>

              {autoDet && (
                <div className="cp-card">
                  <div className="cp-card-title">
                    <i className="fa-solid fa-wave-square" style={{ color: C.accent }} />
                    Live Edge Detection
                  </div>
                  <div className="cp-data-table">
                    <DataRow label="D1" value={`${(autoDet.d1_mm * 1000).toFixed(1)} um`} />
                    <DataRow label="D2" value={`${(autoDet.d2_mm * 1000).toFixed(1)} um`} />
                    <DataRow label="Confidence" value={`${(autoDet.confidence * 100).toFixed(0)}%`} />
                  </div>
                </div>
              )}

              {autoResult && (
                <div className="cp-card">
                  <div className="cp-card-title">
                    <i className="fa-solid fa-chart-simple" style={{ color: C.accent }} />
                    Calibration Result
                  </div>
                  <div className="cp-data-table">
                    <DataRow label="Measured HV" value={`${autoResult.measured_hv.toFixed(2)} HV`} />
                    <DataRow label="Reference HV" value={`${refHv} HV`} />
                    <DataRow label="Error %" value={`${autoResult.error_pct.toFixed(2)}%`} accent={Math.abs(autoResult.error_pct) < 2 ? 'green' : 'amber'} />
                    <DataRow label="Scale (px/mm)" value={autoResult.px_per_mm.toFixed(2)} />
                    <DataRow label="HV Offset" value={`${autoResult.offset_hv.toFixed(2)} HV`} />
                  </div>
                </div>
              )}

              <button className="cp-btn cp-btn--ghost" onClick={resetCalib}>
                <i className="fa-solid fa-rotate-left" /> Reset Calibration
              </button>
            </>
          )}

          <div className="cp-card cp-card--stored">
            <div className="cp-card-title">
              <i className="fa-solid fa-database" style={{ color: C.accent }} />
              Stored Calibration
            </div>
            <div className="cp-scale-display">
              <div className="cp-scale-big cp-scale-big--active">{calib.px_per_mm}</div>
              <div className="cp-scale-unit">px / mm</div>
            </div>
            <div className="cp-data-table">
              <DataRow label="HV Offset" value={calib.offset_hv != null ? `${(+calib.offset_hv).toFixed(2)} HV` : '-'} />
              <DataRow label="Ref HV" value={calib.ref_hv ? String(calib.ref_hv) : '-'} />
              <DataRow
                label="Error %"
                value={errPct != null ? `${errPct.toFixed(2)}%` : '-'}
                accent={errPct != null ? (Math.abs(errPct) < 2 ? 'green' : Math.abs(errPct) < 5 ? 'amber' : 'red') : undefined}
              />
              <DataRow label="Calibrated" value={calib.date ? new Date(calib.date).toLocaleString() : 'Never'} />
            </div>
          </div>
        </div>
      </div>
    </CameraShell>
  )
}

interface DataRowProps {
  label: string
  value: string
  accent?: 'green' | 'amber' | 'red'
}

function DataRow({ label, value, accent }: DataRowProps) {
  return (
    <div className="cp-data-row">
      <span className="cp-data-key">{label}</span>
      <span className={`cp-data-val${accent ? ` cp-data-val--${accent}` : ''}`}>{value}</span>
    </div>
  )
}

