import { useCallback, useEffect, useRef, useState } from 'react'
import CameraShell, { cam, C } from '../components/camera/CameraShell'
import { renderOverlay } from '../utils/overlayRenderer'
import type { VickersDet } from '../utils/overlayRenderer'
import { parseCaptureDetection } from '../utils/captureDetection'
import '../styles/global.css'
import '../styles/layout.css'

interface MeasRow {
  id: number
  no: number
  x: string
  y: string
  hardness: string
  hardnessType: string
  qualified: 'PASS' | 'WARN' | 'FAIL'
  d1: string
  d2: string
  convertType: string
  convertVal: string
  depth: string
  time: string
}

interface Detection {
  xPx: number
  yPx: number
  hD1: number
  hD2: number
  d1Px: number
  d2Px: number
  xMm: number
  yMm: number
  d1Um: number
  d2Um: number
  dAvg: number
  depth: number
}

const HV_TYPES = ['HV', 'HRC', 'HRB', 'HB', 'HK', 'HRA']
const CVT_LIST = ['None', 'HK', 'HBW', 'HRA', 'HRB', 'HRC', 'HRD', 'HRF', 'HR15N', 'HR30N', 'HR45N']
const LOADS_KGF = ['0.1', '0.3', '0.5', '1', '2', '5', '10', '20', '30', '50']
const ROWS_KEY = 'htp_meas_rows'
const PURPLE = 'rgba(200,50,220,0.95)'
const PURPLE_DIM = '#d946ef'

const loadRows = (): MeasRow[] => {
  try {
    return JSON.parse(localStorage.getItem(ROWS_KEY) || '[]')
  } catch {
    return []
  }
}

const saveRows = (r: MeasRow[]) => localStorage.setItem(ROWS_KEY, JSON.stringify(r))

function convertHV(hv: number, to: string): string {
  if (!to || to === 'None' || isNaN(hv) || hv <= 0) return '-'
  const r = (() => {
    switch (to) {
      case 'HK':
        return hv * 1.05
      case 'HBW':
        return hv * 0.9608
      case 'HRA':
        return 100 - 100 / (0.0006 * hv + 1.3)
      case 'HRB':
        return Math.min(0.2917 * hv - 5.833, 100)
      case 'HRC': {
        const v = -0.0006 * hv * hv + 0.37 * hv - 13.2
        return v > 0 ? v : null
      }
      default:
        return null
    }
  })()
  return r !== null ? r.toFixed(2) : '-'
}

function drawManualLines(
  canvas: HTMLCanvasElement,
  hD1: number,
  hD2: number,
  cx: number,
  cy: number,
  d1mm: number,
  d2mm: number,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const W = canvas.width
  const H = canvas.height
  ctx.clearRect(0, 0, W, H)

  ctx.strokeStyle = 'rgba(147,51,234,0.25)'
  ctx.lineWidth = 1
  ctx.setLineDash([6, 4])
  ctx.beginPath()
  ctx.moveTo(0, H / 2)
  ctx.lineTo(W, H / 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(W / 2, 0)
  ctx.lineTo(W / 2, H)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.strokeStyle = PURPLE
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(cx - hD1, 0)
  ctx.lineTo(cx - hD1, H)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx + hD1, 0)
  ctx.lineTo(cx + hD1, H)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(0, cy - hD2)
  ctx.lineTo(W, cy - hD2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(0, cy + hD2)
  ctx.lineTo(W, cy + hD2)
  ctx.stroke()

  ctx.font = 'bold 10px monospace'
  ctx.fillStyle = PURPLE_DIM
  ctx.textAlign = 'center'
  ctx.fillText(`D1: ${(d1mm * 1000).toFixed(1)} um`, cx, cy - hD2 - 7)
  ctx.textAlign = 'left'
  ctx.fillText(`D2: ${(d2mm * 1000).toFixed(1)} um`, cx + hD1 + 7, cy + 4)
}

function metricsFromDetection(det: VickersDet, pxPerMm: number): Detection {
  const d1Um = det.d1_mm * 1000
  const d2Um = det.d2_mm * 1000
  const xPx = Math.round(det.cx_frac * det.img_w)
  const yPx = Math.round(det.cy_frac * det.img_h)
  const d1Px = Math.round(det.d1_mm * pxPerMm)
  const d2Px = Math.round(det.d2_mm * pxPerMm)
  const dAvg = (d1Um + d2Um) / 2
  return {
    xPx,
    yPx,
    hD1: d1Px / 2,
    hD2: d2Px / 2,
    d1Px,
    d2Px,
    xMm: xPx / pxPerMm,
    yMm: yPx / pxPerMm,
    d1Um,
    d2Um,
    dAvg,
    depth: dAvg / 7.001,
  }
}

const Calibration = {
  get: () => {
    try {
      return JSON.parse(localStorage.getItem('htp_calib') || 'null') || { px_per_mm: 100, offset_hv: 0 }
    } catch {
      return { px_per_mm: 100, offset_hv: 0 }
    }
  },
}

export default function MeasurePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef(0)
  const detectBusy = useRef(false)
  const d1x = useRef<number | null>(null)
  const d2x = useRef<number | null>(null)
  const d3y = useRef<number | null>(null)
  const d4y = useRef<number | null>(null)
  const dragging = useRef<'d1' | 'd2' | 'd3' | 'd4' | null>(null)

  const [rows, setRows] = useState<MeasRow[]>(loadRows)
  const [selRow, setSelRow] = useState<number | null>(null)
  const [detInfo, setDetInfo] = useState<Detection | null>(null)
  const [autoDet, setAutoDet] = useState<VickersDet | null>(null)
  const [d1Lbl, setD1Lbl] = useState('-')
  const [d2Lbl, setD2Lbl] = useState('-')
  const [hvUser, setHvUser] = useState('')
  const [hvType, setHvType] = useState('HV')
  const [cvtType, setCvtType] = useState('None')
  const [loadKgf, setLoadKgf] = useState('10')
  const [measuring, setMeasuring] = useState(false)
  const [measMode, setMeasMode] = useState<'auto' | 'manual'>('auto')
  const [activeTab, setActiveTab] = useState<'measure' | 'machine' | 'statistics'>('measure')

  const calib = Calibration.get()
  const pm = calib.px_per_mm || 100

  const hvs = rows.map((r) => parseFloat(r.hardness)).filter((v) => !isNaN(v))
  const mean = hvs.length ? hvs.reduce((a, b) => a + b, 0) / hvs.length : 0
  const stats = {
    count: rows.length,
    min: hvs.length ? Math.min(...hvs).toFixed(2) : '-',
    max: hvs.length ? Math.max(...hvs).toFixed(2) : '-',
    avg: hvs.length ? mean.toFixed(2) : '-',
    stddev: hvs.length ? Math.sqrt(hvs.reduce((a, v) => a + (v - mean) ** 2, 0) / hvs.length).toFixed(4) : '-',
  }

  const placeDefault = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const s = Math.min(canvas.width, canvas.height) * 0.18
    d1x.current = canvas.width / 2 - s
    d2x.current = canvas.width / 2 + s
    d3y.current = canvas.height / 2 - s
    d4y.current = canvas.height / 2 + s
    setD1Lbl(((s * 2) / pm * 1000).toFixed(2) + ' um')
    setD2Lbl(((s * 2) / pm * 1000).toFixed(2) + ' um')
    drawManualLines(canvas, s, s, canvas.width / 2, canvas.height / 2, (s * 2) / pm / 1000, (s * 2) / pm / 1000)
  }, [pm])

  const applyAutoDetection = useCallback(
    (det: VickersDet) => {
      const canvas = canvasRef.current
      if (!canvas) return
      setAutoDet(det)
      setDetInfo(metricsFromDetection(det, pm))
      setD1Lbl((det.d1_mm * 1000).toFixed(2) + ' um')
      setD2Lbl((det.d2_mm * 1000).toFixed(2) + ' um')
      renderOverlay(canvas, det, { showEdge: true, showGrid: false })
    },
    [pm],
  )

  const runCaptureDetection = useCallback(async (): Promise<VickersDet | null> => {
    const raw = await cam.post('/capture', { load_kgf: parseFloat(loadKgf) })
    return parseCaptureDetection(raw)
  }, [loadKgf])

  const onFrameLoad = useCallback(async () => {
    if (measMode !== 'auto') return
    frameRef.current += 1
    if (frameRef.current % 8 !== 0) return
    if (detectBusy.current) return
    detectBusy.current = true
    try {
      const det = await runCaptureDetection()
      if (det) applyAutoDetection(det)
    } catch {
      // ignore frame errors
    } finally {
      detectBusy.current = false
    }
  }, [measMode, runCaptureDetection, applyAutoDetection])

  const autoMeasure = async () => {
    setMeasuring(true)
    try {
      const det = await runCaptureDetection()
      if (det) applyAutoDetection(det)
      else placeDefault()
    } catch {
      placeDefault()
    }
    setMeasuring(false)
  }

  const addRow = () => {
    if (!detInfo) return
    const hv = parseFloat(hvUser)
    if (isNaN(hv) || hv <= 0) return
    const asym = Math.abs(detInfo.d1Um - detInfo.d2Um) / ((detInfo.d1Um + detInfo.d2Um) / 2) * 100
    const qual: 'PASS' | 'WARN' | 'FAIL' = hv > 0 && hv < 2000 && asym < 5 ? (asym < 2 ? 'PASS' : 'WARN') : 'FAIL'
    const now = new Date()
    const row: MeasRow = {
      id: Date.now(),
      no: rows.length + 1,
      x: detInfo.xMm.toFixed(3),
      y: detInfo.yMm.toFixed(3),
      hardness: hv.toFixed(1),
      hardnessType: hvType,
      qualified: qual,
      d1: detInfo.d1Um.toFixed(2),
      d2: detInfo.d2Um.toFixed(2),
      convertType: cvtType,
      convertVal: convertHV(hv, cvtType),
      depth: detInfo.depth.toFixed(3),
      time: now.toLocaleDateString() + ' ' + now.toLocaleTimeString(),
    }
    const u = [...rows, row]
    setRows(u)
    saveRows(u)
    setDetInfo(null)
    setAutoDet(null)
    setHvUser('')
  }

  const deleteRow = () => {
    if (selRow === null) return
    const u = rows.filter((r) => r.id !== selRow)
    setRows(u)
    saveRows(u)
    setSelRow(null)
  }

  const clearRows = () => {
    if (!confirm('Clear all rows?')) return
    setRows([])
    saveRows([])
    setSelRow(null)
  }

  const getCP = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const findHit = (px: number, py: number) => {
    const H = 10
    if (d1x.current !== null && Math.abs(px - d1x.current) <= H) return 'd1' as const
    if (d2x.current !== null && Math.abs(px - d2x.current) <= H) return 'd2' as const
    if (d3y.current !== null && Math.abs(py - d3y.current) <= H) return 'd3' as const
    if (d4y.current !== null && Math.abs(py - d4y.current) <= H) return 'd4' as const
    return null
  }

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const p = getCP(e)
    dragging.current = findHit(p.x, p.y)
  }

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragging.current || !canvasRef.current) return
    const p = getCP(e)
    const W = canvasRef.current.width
    const H = canvasRef.current.height
    if (dragging.current === 'd1') d1x.current = Math.min(p.x, (d2x.current ?? W) - 4)
    else if (dragging.current === 'd2') d2x.current = Math.max(p.x, (d1x.current ?? 0) + 4)
    else if (dragging.current === 'd3') d3y.current = Math.min(p.y, (d4y.current ?? H) - 4)
    else if (dragging.current === 'd4') d4y.current = Math.max(p.y, (d3y.current ?? 0) + 4)

    if (d1x.current !== null && d2x.current !== null) {
      setD1Lbl((Math.abs(d2x.current - d1x.current) / pm * 1000).toFixed(2) + ' um')
    }
    if (d3y.current !== null && d4y.current !== null) {
      setD2Lbl((Math.abs(d4y.current - d3y.current) / pm * 1000).toFixed(2) + ' um')
    }

    const icx = ((d1x.current ?? 0) + (d2x.current ?? W)) / 2
    const icy = ((d3y.current ?? 0) + (d4y.current ?? H)) / 2
    const hD1 = Math.abs((d2x.current ?? W) - (d1x.current ?? 0)) / 2
    const hD2 = Math.abs((d4y.current ?? H) - (d3y.current ?? 0)) / 2
    drawManualLines(canvasRef.current, hD1, hD2, icx, icy, (hD1 * 2) / pm / 1000, (hD2 * 2) / pm / 1000)
  }

  const onMouseUp = () => {
    dragging.current = null
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (measMode === 'manual') {
      canvas.style.pointerEvents = 'auto'
      canvas.style.cursor = 'crosshair'
      canvas.addEventListener('mousedown', onMouseDown as any)
      canvas.addEventListener('mousemove', onMouseMove as any)
      canvas.addEventListener('mouseup', onMouseUp)
      canvas.addEventListener('mouseleave', onMouseUp)
      if (d1x.current === null || d2x.current === null || d3y.current === null || d4y.current === null) {
        placeDefault()
      }
    } else {
      canvas.style.pointerEvents = 'none'
      canvas.style.cursor = 'default'
      if (autoDet) renderOverlay(canvas, autoDet, { showEdge: true, showGrid: false })
      else renderOverlay(canvas, null, { showEdge: false, showGrid: false })
    }
    return () => {
      canvas.removeEventListener('mousedown', onMouseDown as any)
      canvas.removeEventListener('mousemove', onMouseMove as any)
      canvas.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('mouseleave', onMouseUp)
    }
  }, [measMode, autoDet, placeDefault]) // eslint-disable-line react-hooks/exhaustive-deps

  const TH: React.CSSProperties = {
    padding: '6px 8px',
    textAlign: 'left',
    fontSize: 10,
    fontWeight: 700,
    color: C.text2,
    borderBottom: `1px solid ${C.border2}`,
    background: C.bgPanel,
    whiteSpace: 'nowrap',
  }

  const TD: React.CSSProperties = {
    padding: '5px 8px',
    fontSize: 10,
    color: C.text,
    borderBottom: `1px solid ${C.border}`,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  }

  const extraToolbar = (
    <>
      <button
        onClick={autoMeasure}
        disabled={measuring}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '4px 10px',
          height: 28,
          fontSize: 11,
          fontWeight: 600,
          cursor: measuring ? 'not-allowed' : 'pointer',
          borderRadius: 5,
          background: 'rgba(14,165,233,.15)',
          color: C.accentDk,
          border: `1px solid ${C.border2}`,
          opacity: measuring ? 0.6 : 1,
        }}
      >
        <i className={`fa-solid ${measuring ? 'fa-circle-notch fa-spin' : 'fa-crosshairs'}`} style={{ fontSize: 10 }} />
        {measuring ? 'Detecting...' : 'Auto Measure'}
      </button>
      <button
        onClick={() => setMeasMode((m) => (m === 'auto' ? 'manual' : 'auto'))}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '4px 10px',
          height: 28,
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          borderRadius: 5,
          background: measMode === 'manual' ? 'rgba(245,158,11,.15)' : C.bgPanel,
          color: measMode === 'manual' ? C.amber : C.text2,
          border: `1px solid ${C.border}`,
        }}
      >
        <i className={`fa-solid ${measMode === 'manual' ? 'fa-hand-pointer' : 'fa-robot'}`} style={{ fontSize: 10 }} />
        {measMode === 'manual' ? 'Manual' : 'Auto'}
      </button>
      <div style={{ display: 'flex', gap: 12, padding: '0 8px', fontSize: 10, fontFamily: 'monospace' }}>
        <span style={{ color: PURPLE_DIM }}>
          D1: <b>{d1Lbl}</b>
        </span>
        <span style={{ color: PURPLE_DIM }}>
          D2: <b>{d2Lbl}</b>
        </span>
      </div>
    </>
  )

  return (
    <CameraShell
      pageTitle="Measurement"
      pageSub={`px/mm: ${pm} | mode: ${measMode}`}
      canvasRef={canvasRef as any}
      onFrameLoad={onFrameLoad}
      extraToolbar={extraToolbar}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, background: C.bgLight, flexShrink: 0 }}>
          {([
            { key: 'measure', label: 'Measure' },
            { key: 'machine', label: 'Machine' },
            { key: 'statistics', label: 'Statistics' },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                flex: 1,
                padding: '6px 0',
                fontSize: 10,
                fontWeight: activeTab === t.key ? 700 : 500,
                background: activeTab === t.key ? C.bg : 'transparent',
                color: activeTab === t.key ? C.accentDk : C.text3,
                border: 'none',
                borderBottom: `2px solid ${activeTab === t.key ? C.accent : 'transparent'}`,
                cursor: 'pointer',
                transition: 'all .12s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {activeTab === 'measure' && (
            <>
              <div style={{ background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.text2, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>
                  Add Measurement
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input
                    type="number"
                    value={hvUser}
                    onChange={(e) => setHvUser(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addRow()}
                    placeholder="HV value"
                    style={{ flex: 1, minWidth: 80, padding: '5px 8px', fontSize: 12, background: C.bgLight, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, outline: 'none' }}
                  />
                  <select value={hvType} onChange={(e) => setHvType(e.target.value)} style={{ padding: '5px 6px', fontSize: 11, background: C.bgLight, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 4 }}>
                    {HV_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                  <select value={cvtType} onChange={(e) => setCvtType(e.target.value)} style={{ padding: '5px 6px', fontSize: 11, background: C.bgLight, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 4 }}>
                    {CVT_LIST.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <button
                  onClick={addRow}
                  disabled={!detInfo || !hvUser}
                  style={{
                    marginTop: 8,
                    width: '100%',
                    padding: '7px 0',
                    fontSize: 12,
                    fontWeight: 700,
                    borderRadius: 5,
                    border: 'none',
                    cursor: !detInfo || !hvUser ? 'not-allowed' : 'pointer',
                    background: !detInfo || !hvUser ? C.bgLight : C.accent,
                    color: !detInfo || !hvUser ? C.text3 : '#fff',
                    opacity: !detInfo || !hvUser ? 0.5 : 1,
                  }}
                >
                  + Add Row
                </button>
              </div>

              {detInfo && (
                <div style={{ background: C.bgPanel, border: `1px solid ${C.border2}`, borderRadius: 6, padding: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.text2, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>
                    Last Contour Detection
                  </div>
                  {[
                    ['D1', `${detInfo.d1Um.toFixed(2)} um`, PURPLE_DIM],
                    ['D2', `${detInfo.d2Um.toFixed(2)} um`, C.accentDk],
                    ['D avg', `${detInfo.dAvg.toFixed(2)} um`, '#10b981'],
                    ['Depth', `${detInfo.depth.toFixed(3)} um`, C.amber],
                  ].map(([k, v, col]) => (
                    <div key={String(k)} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: `1px solid ${C.border}` }}>
                      <span style={{ fontSize: 10, color: C.text3 }}>{k}</span>
                      <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: col as string }}>{v}</span>
                    </div>
                  ))}
                </div>
              )}

              {rows.length > 0 && (
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: C.bgPanel, borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: C.text2, textTransform: 'uppercase', letterSpacing: '.07em' }}>
                      Results ({rows.length})
                    </span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={deleteRow} disabled={selRow === null} style={{ padding: '3px 8px', fontSize: 10, borderRadius: 4, cursor: 'pointer', border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.08)', color: '#f87171', opacity: selRow === null ? 0.4 : 1 }}>
                        Delete
                      </button>
                      <button onClick={clearRows} style={{ padding: '3px 8px', fontSize: 10, borderRadius: 4, cursor: 'pointer', border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.08)', color: '#f87171' }}>
                        Clear
                      </button>
                    </div>
                  </div>
                  <div style={{ overflowX: 'auto', maxHeight: 200 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                      <thead>
                        <tr>{['#', 'HV', 'Type', 'Qual', 'D1', 'D2', 'Depth'].map((h) => <th key={h} style={TH}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.id} onClick={() => setSelRow(r.id)} style={{ background: selRow === r.id ? 'rgba(14,165,233,.12)' : r.no % 2 === 0 ? 'rgba(30,41,59,.5)' : C.bg }}>
                            <td style={{ ...TD, color: C.text3 }}>{r.no}</td>
                            <td style={{ ...TD, color: C.accentDk, fontWeight: 700, fontFamily: 'monospace' }}>{r.hardness}</td>
                            <td style={TD}>{r.hardnessType}</td>
                            <td style={TD}>
                              <span style={{ padding: '1px 6px', borderRadius: 8, fontSize: 9, fontWeight: 700, background: r.qualified === 'PASS' ? 'rgba(34,197,94,.15)' : r.qualified === 'WARN' ? 'rgba(245,158,11,.15)' : 'rgba(239,68,68,.15)', color: r.qualified === 'PASS' ? C.green : r.qualified === 'WARN' ? C.amber : C.red }}>
                                {r.qualified}
                              </span>
                            </td>
                            <td style={{ ...TD, color: PURPLE_DIM }}>{r.d1}</td>
                            <td style={{ ...TD, color: C.accentDk }}>{r.d2}</td>
                            <td style={TD}>{r.depth}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'machine' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.text2, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>
                  Measurement Settings
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: C.text3, width: 80, flexShrink: 0 }}>Load (kgf)</span>
                  <select value={loadKgf} onChange={(e) => setLoadKgf(e.target.value)} style={{ flex: 1, padding: '5px 6px', fontSize: 11, background: C.bgLight, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 4 }}>
                    {LOADS_KGF.map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <button onClick={autoMeasure} disabled={measuring} style={{ width: '100%', padding: '8px 0', fontSize: 12, fontWeight: 700, borderRadius: 5, border: 'none', cursor: measuring ? 'not-allowed' : 'pointer', background: measuring ? C.bgLight : C.accent, color: measuring ? C.text3 : '#fff', opacity: measuring ? 0.6 : 1, marginTop: 4 }}>
                  {measuring ? 'Detecting...' : 'Auto Measure'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'statistics' && (
            <div style={{ background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.text2, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>
                Statistics
              </div>
              {[
                ['Count', String(stats.count), C.accentDk],
                ['Min', stats.min, C.green],
                ['Max', stats.max, C.red],
                ['Average', stats.avg, C.accentDk],
                ['StdDev', stats.stddev, C.amber],
              ].map(([k, v, col]) => (
                <div key={String(k)} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: 11, color: C.text3 }}>{k}</span>
                  <span style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: col as string }}>{v || '-'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </CameraShell>
  )
}

