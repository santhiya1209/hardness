// frontend/src/components/camera/CameraView.tsx
// Re-exports the canvas feed element — used if you want to embed
// the camera feed inside other pages (e.g. MeasurePage)
import { forwardRef } from 'react'

interface CameraViewProps {
  streaming: boolean
  onConnect: () => void
  connecting?: boolean
  error?: string | null
  style?: React.CSSProperties
}

const CameraView = forwardRef<HTMLCanvasElement, CameraViewProps>(
  ({ streaming, onConnect, connecting = false, error = null, style }, canvasRef) => {
    return (
      <div style={{ position:'relative', width:'100%', height:'100%', background:'#000', ...style }}>

        {/* Placeholder */}
        {!streaming && (
          <div style={{
            position:'absolute', inset:0, display:'flex',
            flexDirection:'column', alignItems:'center', justifyContent:'center',
            background:'#0a1628', gap:12, zIndex:2,
          }}>
            <i className="fa-solid fa-video-slash" style={{fontSize:40,color:'#1e3a5f'}}/>
            <span style={{color:'#475569',fontSize:13}}>Camera not connected</span>
            {error && (
              <div style={{color:'#f87171',fontSize:12,background:'rgba(239,68,68,.1)',
                border:'1px solid rgba(239,68,68,.3)',borderRadius:6,
                padding:'6px 14px',maxWidth:300,textAlign:'center'}}>
                ⚠ {error}
              </div>
            )}
            <button
              onClick={onConnect}
              disabled={connecting}
              style={{
                padding:'6px 18px', fontSize:12, fontWeight:600,
                background:'rgba(14,165,233,.15)', color:'#38bdf8',
                border:'1px solid rgba(14,165,233,.35)', borderRadius:5,
                cursor: connecting ? 'not-allowed' : 'pointer',
                opacity: connecting ? 0.6 : 1,
              }}
            >
              <i className={`fa-solid ${connecting ? 'fa-circle-notch fa-spin' : 'fa-plug'}`}
                style={{marginRight:6}}/>
              {connecting ? 'Connecting…' : 'Connect Camera'}
            </button>
          </div>
        )}

        {/* Canvas output */}
        <canvas
          ref={canvasRef}
          style={{
            width:'100%', height:'100%', objectFit:'contain',
            display: streaming ? 'block' : 'none',
          }}
        />
      </div>
    )
  }
)

CameraView.displayName = 'CameraView'
export default CameraView