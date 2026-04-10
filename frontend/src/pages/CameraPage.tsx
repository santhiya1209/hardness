import { useCallback, useRef, useState } from 'react'
import CameraShell, { cam, C, DEFAULT_CANNY } from '../components/camera/CameraShell'
import type { CannyEdgeOpts } from '../components/camera/CameraShell'
import { renderOverlay } from '../utils/overlayRenderer'
import type { VickersDet } from '../utils/overlayRenderer'
import { parseCaptureDetection } from '../utils/captureDetection'

interface CamSettings {
  exposure_us: number
  gain_db: number
  gamma: number
  contrast: number
  black_level: number
  resolution: string
  res_mode: string
}

const DEFAULT: CamSettings = {
  exposure_us: 10000,
  gain_db: 0,
  gamma: 1.0,
  contrast: 100,
  black_level: 0,
  resolution: 'Max',
  res_mode: 'Normal',
}

const RESOLUTIONS = ['Max', '2592x1944', '1920x1080', '1280x720', '640x480', 'User']
const RES_MODES = ['Normal', 'Bin2', 'Sum2', 'Skip2']
const AUTO_DETECT_MS = 500
const RECONNECT_GAP_MS = 1600

function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (v: number) => void
}) {
  const { label, value, min, max, step = 1, unit = '', onChange } = props
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: C.text2 }}>{label}</span>
        <span style={{ fontSize: 10, fontFamily: 'monospace', color: C.accentDk, fontWeight: 700 }}>
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: '100%',
          height: 4,
          accentColor: C.accent,
          cursor: 'pointer',
          background: `linear-gradient(to right,${C.accent} ${pct}%,#334155 0)`,
          borderRadius: 2,
          outline: 'none',
          border: 'none',
        }}
      />
    </div>
  )
}

export default function CameraPage() {
  const [settings, setSettings] = useState<CamSettings>({ ...DEFAULT })
  const [dirty, setDirty] = useState(false)
  const [applying, setApplying] = useState(false)
  const [snapshots, setSnapshots] = useState<{ id: number; src: string; time: string }[]>([])
  const [tab, setTab] = useState<'settings' | 'snapshots'>('settings')
  const [detection, setDetection] = useState<VickersDet | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [canny, setCanny] = useState<CannyEdgeOpts>({ ...DEFAULT_CANNY })

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const detectBusy = useRef(false)
  const lastDetectAt = useRef(0)
  const lastFrameAt = useRef(0)
  const connectedCycleAutoStarted = useRef(false)

  const set = <K extends keyof CamSettings>(k: K, v: CamSettings[K]) => {
    setSettings((p) => ({ ...p, [k]: v }))
    setDirty(true)
  }

  const applySettings = async () => {
    setApplying(true)
    try {
      await cam.post('/settings', settings)
      setDirty(false)
    } catch {
      // ignore
    }
    setApplying(false)
  }

  const onSnapshot = useCallback((url: string) => {
    setSnapshots((prev) =>
      [{ id: Date.now(), src: url, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 20),
    )
    setTab('snapshots')
  }, [])

  const cannyRef = useRef(canny)
  cannyRef.current = canny

  const applyDetection = useCallback((det: VickersDet | null) => {
    const canvas = canvasRef.current
    if (!canvas) return
    setDetection(det)
    // When Canny is on, don't clear the canvas so the edge layer is preserved
    renderOverlay(canvas, det, { showEdge: !!det, showGrid: false, clearFirst: !cannyRef.current.enabled })
  }, [])

  const runDetection = useCallback(async (): Promise<boolean> => {
    const raw = await cam.post('/capture', { load_kgf: 10 })
    const det = parseCaptureDetection(raw)
    // Always call applyDetection — even with null so the canvas crosshair
    // is drawn when detection fails (otherwise canvas stays blank forever).
    applyDetection(det)
    return det !== null
  }, [applyDetection])

  const onFrameLoad = useCallback(
    async (_img: HTMLImageElement) => {
      const now = performance.now()
      const disconnectedGap = now - lastFrameAt.current > RECONNECT_GAP_MS
      if (disconnectedGap) {
        connectedCycleAutoStarted.current = false
      }
      lastFrameAt.current = now
      if (detectBusy.current) return
      const shouldStartOnConnect = !connectedCycleAutoStarted.current
      const shouldPoll = now - lastDetectAt.current >= AUTO_DETECT_MS
      if (!shouldStartOnConnect && !shouldPoll) return
      detectBusy.current = true
      try {
        const ok = await runDetection()
        if (ok) {
          connectedCycleAutoStarted.current = true
          lastDetectAt.current = performance.now()
        }
      } catch {
        // ignore
      } finally {
        detectBusy.current = false
      }
    },
    [runDetection],
  )

  const detectNow = async () => {
    if (detecting || detectBusy.current) return
    setDetecting(true)
    detectBusy.current = true
    try {
      const ok = await runDetection()
      if (ok) {
        connectedCycleAutoStarted.current = true
        lastDetectAt.current = performance.now()
      }
    } catch {
      // keep the previous successful detection if current frame fails
    } finally {
      detectBusy.current = false
      setDetecting(false)
    }
  }

  return (
    <CameraShell
      pageTitle="Live Camera"
      pageSub="Camera feed"
      onSnapshot={onSnapshot}
      onFrameLoad={onFrameLoad}
      canvasRef={canvasRef}
      cannyOpts={canny}
      extraToolbar={
        <>
          <button
            onClick={detectNow}
            disabled={detecting}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              height: 28,
              fontSize: 11,
              fontWeight: 600,
              background: C.bgPanel,
              color: detecting ? C.text3 : C.accentDk,
              border: `1px solid ${detecting ? C.border : C.border2}`,
              borderRadius: 5,
              cursor: detecting ? 'not-allowed' : 'pointer',
              opacity: detecting ? 0.5 : 1,
            }}
          >
            <i className="fa-solid fa-crosshairs" style={{ fontSize: 11 }} />
            {detecting ? 'Detecting...' : 'Detect Now'}
          </button>

          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              height: 28,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '.04em',
              textTransform: 'uppercase',
              borderRadius: 5,
              border: `1px solid ${C.border}`,
              background: 'rgba(217,70,239,.10)',
              color: C.purpleDim,
            }}
            title="Auto detection runs continuously after camera connect"
          >
            <i className="fa-solid fa-wand-magic-sparkles" style={{ fontSize: 10 }} />
            Auto Detect ON
          </span>

          {/* Canny Edge toggle */}
          <button
            onClick={() => setCanny(p => ({ ...p, enabled: !p.enabled }))}
            title="Toggle Canny edge detection overlay"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              height: 28,
              fontSize: 11,
              fontWeight: 600,
              background: canny.enabled ? 'rgba(0,255,180,.12)' : C.bgPanel,
              color: canny.enabled ? '#00ffb4' : C.text2,
              border: `1px solid ${canny.enabled ? 'rgba(0,255,180,.45)' : C.border}`,
              borderRadius: 5,
              cursor: 'pointer',
            }}
          >
            <i className="fa-solid fa-draw-polygon" style={{ fontSize: 11 }} />
            {canny.enabled ? 'Edge ON' : 'Edge OFF'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, background: C.bgLight, flexShrink: 0 }}>
        {(['settings', 'snapshots'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: '7px 0',
              fontSize: 11,
              fontWeight: tab === t ? 700 : 500,
              background: tab === t ? C.bg : 'transparent',
              color: tab === t ? C.accentDk : C.text3,
              border: 'none',
              borderBottom: `2px solid ${tab === t ? C.accent : 'transparent'}`,
              cursor: 'pointer',
              transition: 'all .12s',
              textTransform: 'capitalize',
            }}
          >
            {t === 'snapshots' ? `Snapshots (${snapshots.length})` : t}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        {detection && (
          <div
            style={{
              marginBottom: 10,
              background: C.bgPanel,
              border: `1px solid ${C.border2}`,
              borderRadius: 6,
              padding: '8px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: C.accentDk,
                textTransform: 'uppercase',
                letterSpacing: '.07em',
              }}
            >
              Auto Edge Detection
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
              {[
                ['D1', `${(detection.d1_mm * 1000).toFixed(1)} um`, C.purpleDim],
                ['D2', `${(detection.d2_mm * 1000).toFixed(1)} um`, C.purpleDim],
                ['HV', detection.hv > 0 ? detection.hv.toFixed(0) : '-', C.text],
                ['Conf', `${(detection.confidence * 100).toFixed(0)} %`, C.text2],
              ].map(([k, v, col]) => (
                <div
                  key={String(k)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 11,
                    borderBottom: `1px solid ${C.border}`,
                  }}
                >
                  <span style={{ color: C.text3 }}>{k}</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: String(col) }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: C.text2,
                  textTransform: 'uppercase',
                  letterSpacing: '.07em',
                  marginBottom: 10,
                }}
              >
                Exposure and Gain
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Slider
                  label="Exposure (us)"
                  value={settings.exposure_us}
                  min={100}
                  max={500000}
                  step={100}
                  unit=" us"
                  onChange={(v) => set('exposure_us', v)}
                />
                <Slider
                  label="Gain (dB)"
                  value={settings.gain_db}
                  min={0}
                  max={24}
                  step={0.1}
                  unit=" dB"
                  onChange={(v) => set('gain_db', v)}
                />
                <Slider
                  label="Gamma"
                  value={settings.gamma}
                  min={0.1}
                  max={4.0}
                  step={0.01}
                  onChange={(v) => set('gamma', v)}
                />
                <Slider
                  label="Black Level"
                  value={settings.black_level}
                  min={0}
                  max={255}
                  step={1}
                  onChange={(v) => set('black_level', v)}
                />
              </div>
            </div>

            <div style={{ background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: C.text2,
                  textTransform: 'uppercase',
                  letterSpacing: '.07em',
                  marginBottom: 8,
                }}
              >
                Resolution
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div>
                  <div style={{ fontSize: 10, color: C.text3, marginBottom: 4 }}>Resolution</div>
                  <select
                    value={settings.resolution}
                    onChange={(e) => set('resolution', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px 8px',
                      fontSize: 11,
                      background: C.bgLight,
                      color: C.text2,
                      border: `1px solid ${C.border}`,
                      borderRadius: 4,
                    }}
                  >
                    {RESOLUTIONS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.text3, marginBottom: 4 }}>Mode</div>
                  <select
                    value={settings.res_mode}
                    onChange={(e) => set('res_mode', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px 8px',
                      fontSize: 11,
                      background: C.bgLight,
                      color: C.text2,
                      border: `1px solid ${C.border}`,
                      borderRadius: 4,
                    }}
                  >
                    {RES_MODES.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* ── Canny Edge Settings ── */}
            <div style={{ background: C.bgPanel, border: `1px solid ${canny.enabled ? 'rgba(0,255,180,.3)' : C.border}`, borderRadius: 6, padding: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: canny.enabled ? '#00ffb4' : C.text2, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Canny Edge Detection</span>
                <button
                  onClick={() => setCanny(p => ({ ...p, enabled: !p.enabled }))}
                  style={{ fontSize: 9, padding: '2px 8px', borderRadius: 3, border: `1px solid ${canny.enabled ? 'rgba(0,255,180,.4)' : C.border}`, background: canny.enabled ? 'rgba(0,255,180,.1)' : C.bgLight, color: canny.enabled ? '#00ffb4' : C.text3, cursor: 'pointer', fontWeight: 700 }}
                >
                  {canny.enabled ? 'ON' : 'OFF'}
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: canny.enabled ? 1 : 0.5 }}>
                <Slider
                  label="Low Threshold"
                  value={canny.lowThreshold}
                  min={1}
                  max={100}
                  step={1}
                  onChange={v => setCanny(p => ({ ...p, lowThreshold: Math.min(v, p.highThreshold - 1) }))}
                />
                <Slider
                  label="High Threshold"
                  value={canny.highThreshold}
                  min={2}
                  max={200}
                  step={1}
                  onChange={v => setCanny(p => ({ ...p, highThreshold: Math.max(v, p.lowThreshold + 1) }))}
                />
                <Slider
                  label="Process Scale"
                  value={Math.round(canny.scale * 100)}
                  min={25}
                  max={100}
                  step={5}
                  unit="%"
                  onChange={v => setCanny(p => ({ ...p, scale: v / 100 }))}
                />
                <div style={{ fontSize: 10, color: C.text3, lineHeight: 1.5 }}>
                  Low scale = faster (less CPU). High thresholds = fewer edges.
                  Edges shown in <span style={{ color: '#00ffb4' }}>cyan</span> over live feed.
                </div>
              </div>
            </div>

            <button
              onClick={applySettings}
              disabled={!dirty || applying}
              style={{
                padding: '7px 0',
                fontSize: 12,
                fontWeight: 700,
                borderRadius: 6,
                border: `1px solid ${dirty ? C.border2 : C.border}`,
                cursor: 'pointer',
                background: dirty ? C.accentLt : C.bgPanel,
                color: dirty ? C.accentDk : C.text3,
                opacity: applying ? 0.6 : 1,
              }}
            >
              {applying ? 'Applying...' : dirty ? 'Apply Settings' : 'Settings Applied'}
            </button>
          </div>
        )}

        {tab === 'snapshots' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: C.text2 }}>Snapshots</span>
              <button
                onClick={() => setSnapshots([])}
                disabled={!snapshots.length}
                style={{
                  fontSize: 10,
                  padding: '3px 8px',
                  borderRadius: 4,
                  border: `1px solid ${C.border}`,
                  background: C.bgPanel,
                  color: '#f87171',
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
            {snapshots.length === 0 ? (
              <div
                style={{
                  padding: '24px',
                  textAlign: 'center',
                  color: C.text3,
                  background: C.bgPanel,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  fontSize: 11,
                }}
              >
                No snapshots yet
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {snapshots.map((s) => (
                  <div key={s.id} style={{ border: `1px solid ${C.border}`, borderRadius: 5, overflow: 'hidden' }}>
                    <img
                      src={s.src}
                      alt={s.time}
                      style={{ width: '100%', display: 'block', cursor: 'pointer' }}
                      onClick={() => {
                        const a = document.createElement('a')
                        a.href = s.src
                        a.download = `snap_${s.id}.png`
                        a.click()
                      }}
                    />
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '3px 6px',
                        background: C.bgLight,
                        borderTop: `1px solid ${C.border}`,
                      }}
                    >
                      <span style={{ fontSize: 9, color: C.text3 }}>{s.time}</span>
                      <button
                        onClick={() => setSnapshots((p) => p.filter((x) => x.id !== s.id))}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: '#fca5a5',
                          fontWeight: 700,
                          fontSize: 11,
                        }}
                      >
                        x
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </CameraShell>
  )
}
