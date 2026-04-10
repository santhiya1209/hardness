import { useEffect, useRef, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { drawCannyEdges } from '../../utils/cannyEdge'

const camReq = async (method: string, path: string, body?: object): Promise<any> => {
  if (typeof window !== 'undefined' && (window as any).api?.camReq) {
    const result = await (window as any).api.camReq({ method, path, body: body ?? undefined })
    return result?.data ?? result
  }
  const res = await fetch(`http://localhost:8765${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

export const cam = {
  post: (path: string, body: object = {}) => camReq('POST', path, body),
  get: (path: string) => camReq('GET', path),
}

export const C = {
  bg: '#0f172a',
  bgLight: '#1e293b',
  bgPanel: '#162032',
  border: 'rgba(14,165,233,.18)',
  border2: 'rgba(14,165,233,.32)',
  accent: '#0ea5e9',
  accentDk: '#38bdf8',
  accentLt: 'rgba(14,165,233,.10)',
  accentMd: 'rgba(14,165,233,.22)',
  text: '#f1f5f9',
  text2: '#94a3b8',
  text3: '#475569',
  green: '#22c55e',
  red: '#ef4444',
  amber: '#f59e0b',
  purple: 'rgba(200,50,220,0.95)',
  purpleDim: '#d946ef',
}

const NAV = [
  {
    sec: 'Main',
    items: [
      { label: 'Dashboard', icon: 'fa-solid fa-gauge-high', path: '/' },
      { label: 'Measurement', icon: 'fa-solid fa-crosshairs', path: '/measurement' },
      { label: 'Live Camera', icon: 'fa-solid fa-video', path: '/live' },
    ],
  },
  {
    sec: 'Analysis',
    items: [
      { label: 'Reports', icon: 'fa-solid fa-chart-line', path: '/reports' },
      { label: 'History', icon: 'fa-solid fa-clock-rotate-left', path: '/history' },
      { label: 'HV Converter', icon: 'fa-solid fa-arrows-rotate', path: '/converter' },
    ],
  },
  {
    sec: 'System',
    items: [
      { label: 'Calibration', icon: 'fa-solid fa-ruler-combined', path: '/calibration' },
      { label: 'Settings', icon: 'fa-solid fa-gear', path: '/settings' },
      { label: 'Help', icon: 'fa-solid fa-circle-question', path: '/help' },
    ],
  },
]

export interface CannyEdgeOpts {
  enabled:       boolean
  lowThreshold:  number
  highThreshold: number
  /** Processing scale 0.25–1.0. Lower = faster. Default 0.5 */
  scale:         number
}

export const DEFAULT_CANNY: CannyEdgeOpts = {
  enabled:       false,
  lowThreshold:  20,
  highThreshold: 55,
  scale:         0.5,
}

export interface CameraShellProps {
  children: ReactNode
  pageTitle: string
  pageSub?: string
  onSnapshot?: (dataUrl: string) => void
  onFrameLoad?: (source?: HTMLImageElement) => void
  canvasRef?: React.RefObject<HTMLCanvasElement>
  extraToolbar?: ReactNode
  /** When set, Canny edges are drawn on the canvas overlay each frame */
  cannyOpts?: CannyEdgeOpts
}

export default function CameraShell({
  children, pageTitle, pageSub, onSnapshot, onFrameLoad, canvasRef: externalCanvasRef, extraToolbar,
  cannyOpts,
}: CameraShellProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const imgRef = useRef<HTMLImageElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const fpsRef = useRef({ frames: 0, last: performance.now() })
  const pendingFrameNoRef = useRef(0)
  const decodePendingRef = useRef(false)
  const internalCanvasRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = externalCanvasRef || internalCanvasRef
  const wrapRef = useRef<HTMLDivElement>(null)

  const [streaming, setStreaming] = useState(false)
  const streamingRef = useRef(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [camInfo, setCamInfo] = useState<{ resolution: string } | null>(null)
  const [fps, setFps] = useState(0)
  const [frameNum, setFrameNum] = useState(0)
  const [hasFrame, setHasFrame] = useState(false)

  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])

  const cannyOptsRef = useRef<CannyEdgeOpts | undefined>(cannyOpts)
  useEffect(() => { cannyOptsRef.current = cannyOpts }, [cannyOpts])

  const tickFrame = useCallback((source?: HTMLImageElement, frameNo?: number) => {
    if (frameNo != null) setFrameNum(frameNo)
    fpsRef.current.frames += 1
    const now = performance.now()
    if (now - fpsRef.current.last >= 1000) {
      setFps(Math.round((fpsRef.current.frames * 1000) / (now - fpsRef.current.last)))
      fpsRef.current = { frames: 0, last: now }
    }

    // ── Canny edge overlay ──
    const co = cannyOptsRef.current
    if (co?.enabled && canvasRef.current && source) {
      const edgeOpts = { lowThreshold: co.lowThreshold, highThreshold: co.highThreshold, scale: co.scale }
      drawCannyEdges(source, canvasRef.current, edgeOpts)
    }

    if (onFrameLoad) onFrameLoad(source)
  }, [canvasRef, onFrameLoad])

  const startPoll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    decodePendingRef.current = false
    pendingFrameNoRef.current = 0
    pollRef.current = setInterval(async () => {
      try {
        if (decodePendingRef.current) return
        const raw = await cam.get('/frame')
        if (!mountedRef.current) return
        const payload = raw?.data ?? raw
        const frameB64 = payload?.frame ?? payload?.data?.frame ?? null
        const frameNo = payload?.frameNum ?? payload?.data?.frameNum ?? 0
        const frameFmtRaw = payload?.format ?? payload?.data?.format ?? 'jpeg'
        const frameFmt = String(frameFmtRaw).toLowerCase() === 'bmp' ? 'bmp' : 'jpeg'

        if (frameB64 && imgRef.current) {
          decodePendingRef.current = true
          pendingFrameNoRef.current = frameNo
          imgRef.current.src = `data:image/${frameFmt};base64,${frameB64}`
        }
      } catch {
        // not ready
      }
    }, 80)
  }, [])

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = undefined
    }
    decodePendingRef.current = false
    pendingFrameNoRef.current = 0
  }, [])

  useEffect(() => {
    setError(null)
    setConnecting(true)

    const checkCamera = async () => {
      try {
        const raw = await cam.get('/health')
        if (!mountedRef.current) return
        const health = raw?.data ?? raw
        const connected = health?.autoConnected === true
        if (connected) {
          if (!streamingRef.current) {
            const stRaw = await cam.get('/status')
            if (!mountedRef.current) return
            const st = stRaw?.data ?? stRaw
            const resolution = st?.data?.params?.resolution || st?.params?.resolution || '-'
            setCamInfo({ resolution })
            streamingRef.current = true
            setStreaming(true)
            setHasFrame(false)
            setError(null)
            if (wrapRef.current && canvasRef.current) {
              canvasRef.current.width = wrapRef.current.clientWidth
              canvasRef.current.height = wrapRef.current.clientHeight
            }
            startPoll()
          }
        } else if (streamingRef.current) {
          stopPoll()
          if (imgRef.current) imgRef.current.src = ''
          streamingRef.current = false
          setStreaming(false)
          setFps(0)
          setCamInfo(null)
          setHasFrame(false)
          setFrameNum(0)
        }
        setConnecting(false)
      } catch {
        if (mountedRef.current) setConnecting(false)
      }
    }

    checkCamera()
    const interval = setInterval(checkCamera, 3000)
    return () => {
      clearInterval(interval)
      stopPoll()
    }
  }, [canvasRef, startPoll, stopPoll])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => {
      if (canvasRef.current) {
        canvasRef.current.width = wrap.clientWidth
        canvasRef.current.height = wrap.clientHeight
      }
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [canvasRef])

  const handleSnapshot = useCallback(() => {
    const img = imgRef.current
    const canvas = canvasRef.current
    if (!streaming) return

    const tmp = document.createElement('canvas')
    if (img) {
      tmp.width = canvas?.width || img.naturalWidth || 800
      tmp.height = canvas?.height || img.naturalHeight || 600
    } else {
      return
    }
    const ctx = tmp.getContext('2d')
    if (!ctx) return
    try {
      if (img) ctx.drawImage(img, 0, 0, tmp.width, tmp.height)
    } catch {
      // ignore draw failures
    }
    if (canvas) ctx.drawImage(canvas, 0, 0)
    const url = tmp.toDataURL('image/png')
    if (onSnapshot) onSnapshot(url)
    const a = document.createElement('a')
    a.href = url
    a.download = `snap_${Date.now()}.png`
    a.click()
  }, [canvasRef, onSnapshot, streaming])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: C.bg, color: C.text, fontFamily: 'system-ui,sans-serif', overflow: 'hidden' }}>
      <div style={{ height: 36, background: '#0a1628', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', flexShrink: 0, WebkitAppRegion: 'drag' } as any}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 22, height: 22, background: `linear-gradient(135deg,${C.accent},#0369a1)`, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <i className="fa-solid fa-diamond" style={{ fontSize: 10, color: '#fff' }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
            Hardness <span style={{ color: C.accentDk }}>Tester</span> Pro
          </span>
          <span style={{ fontSize: 10, color: C.text3, marginLeft: 4 }}>· {pageTitle}</span>
        </div>
        <div style={{ display: 'flex', gap: 4, WebkitAppRegion: 'no-drag' } as any}>
          {(['minus', 'square', 'xmark'] as const).map((ic, i) => (
            <button
              key={ic}
              onClick={() => [(window as any).api?.minimize, (window as any).api?.maximize, (window as any).api?.close][i]?.()}
              style={{ width: 28, height: 28, background: i === 2 ? 'rgba(239,68,68,.2)' : 'rgba(255,255,255,.08)', border: 'none', borderRadius: 4, cursor: 'pointer', color: i === 2 ? '#f87171' : 'rgba(255,255,255,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <i className={`fa fa-${ic}`} style={{ fontSize: 9 }} />
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <nav style={{ width: 168, background: '#0a1628', borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '10px 14px 6px', borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.accentDk }}>
              HT <span style={{ color: C.text3 }}>Pro</span>
            </div>
            <div style={{ fontSize: 9, color: C.text3, marginTop: 1 }}>HiRobot SDK</div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            {NAV.map((g) => (
              <div key={g.sec}>
                <div style={{ padding: '8px 14px 3px', fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.3)', letterSpacing: '.1em', textTransform: 'uppercase' }}>{g.sec}</div>
                {g.items.map((item) => {
                  const isActive = location.pathname === item.path
                  return (
                    <div
                      key={item.path}
                      onClick={() => navigate(item.path)}
                      style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 14px', cursor: 'pointer', fontSize: 12, transition: 'all .15s', color: isActive ? '#7dd3fc' : 'rgba(255,255,255,.65)', background: isActive ? 'rgba(125,211,252,.10)' : 'transparent', borderLeft: `3px solid ${isActive ? '#7dd3fc' : 'transparent'}`, fontWeight: isActive ? 600 : 400 }}
                      onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.06)' }}
                      onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                    >
                      <i className={item.icon} style={{ fontSize: 11, flexShrink: 0 }} />
                      {item.label}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <div style={{ padding: '8px 14px', borderTop: `1px solid ${C.border}`, background: 'rgba(0,0,0,.15)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: streaming ? C.green : C.text3, boxShadow: streaming ? `0 0 5px ${C.green}` : 'none', animation: streaming ? 'camPulse 1.5s infinite' : 'none', transition: 'all .3s' }} />
              <span style={{ fontSize: 10, color: streaming ? C.green : C.text3 }}>
                {streaming ? 'Hikrobot Active' : 'Camera Offline'}
              </span>
            </div>
            {camInfo && (
              <div style={{ fontSize: 9, color: C.text3, marginTop: 3, fontFamily: 'monospace' }}>
                {camInfo.resolution}
              </div>
            )}
          </div>
        </nav>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', padding: 8, gap: 8 }}>
          <div style={{ flex: '0 0 62%', display: 'flex', flexDirection: 'column', border: `1px solid ${C.border2}`, borderRadius: 6, background: '#000', overflow: 'hidden', boxShadow: '0 2px 12px rgba(14,165,233,.08)' }}>
            <div style={{ background: C.bgLight, borderBottom: `1px solid ${C.border}`, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, flexWrap: 'wrap' }}>
              <button onClick={handleSnapshot} disabled={!streaming} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', height: 28, fontSize: 11, fontWeight: 600, background: C.bgPanel, color: streaming ? C.text2 : C.text3, border: `1px solid ${C.border}`, borderRadius: 5, cursor: streaming ? 'pointer' : 'not-allowed', opacity: streaming ? 1 : 0.5 }}>
                <i className="fa-solid fa-camera" style={{ fontSize: 11 }} />
                Snapshot
              </button>

              <span style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', height: 28, fontSize: 11, fontWeight: 600, background: C.bgPanel, color: C.accentDk, border: `1px solid ${C.border2}`, borderRadius: 5 }}>
                <i className="fa-solid fa-camera" style={{ fontSize: 11 }} />
                Source: Hikrobot USB3
              </span>

              {extraToolbar}

              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, color: C.text3, background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px 8px', fontFamily: 'monospace' }}>
                  {camInfo?.resolution || '-'}
                </span>
                {streaming ? (
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#dc2626', display: 'inline-block', animation: 'camPulse 1s infinite' }} />
                    LIVE | {fps}fps
                  </span>
                ) : (
                  <span style={{ fontSize: 10, color: C.text3 }}>
                    {connecting ? 'Connecting...' : 'Waiting for source...'}
                  </span>
                )}
              </div>
            </div>

            <div ref={wrapRef} style={{ flex: 1, position: 'relative', background: '#0a1628', overflow: 'hidden' }}>
              {(!streaming || !hasFrame) && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, zIndex: 2 }}>
                  <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(14,165,233,.08)', border: `2px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="fa-solid fa-video-slash" style={{ fontSize: 24, color: '#1e3a5f' }} />
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ color: '#475569', fontSize: 12, fontWeight: 600 }}>
                      HiRobot Camera Offline
                    </div>
                    <div style={{ color: C.text3, fontSize: 11, marginTop: 3 }}>
                      Plug in USB3 camera and it connects automatically
                    </div>
                  </div>
                  {error && (
                    <div style={{ color: '#f87171', fontSize: 11, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 6, padding: '6px 12px', maxWidth: 360, textAlign: 'center', lineHeight: 1.5 }}>
                      {error}
                    </div>
                  )}
                </div>
              )}

              <img
                ref={imgRef}
                alt="HiRobot live feed"
                onError={() => {
                  decodePendingRef.current = false
                  setHasFrame(false)
                }}
                onLoad={() => {
                  decodePendingRef.current = false
                  setHasFrame(true)
                  if (imgRef.current) tickFrame(imgRef.current, pendingFrameNoRef.current)
                }}
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: streaming && hasFrame ? 'block' : 'none' }}
              />

              <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 3, pointerEvents: 'none' }} />
            </div>

            <div style={{ background: C.bgLight, borderTop: `1px solid ${C.border}`, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
              <span style={{ fontSize: 10, color: C.text3 }}>
                Frame: <b style={{ color: C.text2, fontFamily: 'monospace' }}>{frameNum}</b>
              </span>
              <span style={{ fontSize: 10, color: C.text3 }}>
                Source: <b style={{ color: C.text2 }}>Hikrobot USB3</b>
              </span>
              {pageSub && <span style={{ fontSize: 10, color: C.text3 }}>{pageSub}</span>}
              <span style={{ marginLeft: 'auto', fontSize: 10, color: streaming ? C.green : C.text3 }}>
                {streaming ? 'Connected' : 'Waiting...'}
              </span>
            </div>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', border: `1px solid ${C.border2}`, borderRadius: 6, background: C.bg, overflow: 'hidden', minWidth: 0 }}>
            {children}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes camPulse{0%,100%{opacity:1}50%{opacity:.3}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:${C.bg}}
        ::-webkit-scrollbar-thumb{background:${C.border2};border-radius:2px}
      `}</style>
    </div>
  )
}

