// frontend/src/components/camera/CameraControls.tsx
// Standalone controls panel — can be embedded in any page

const C = {
  bg:'#0f172a', bgLight:'#1e293b', bgPanel:'#162032',
  border:'rgba(14,165,233,.18)', border2:'rgba(14,165,233,.32)',
  accent:'#0ea5e9', accentDk:'#38bdf8', accentLt:'rgba(14,165,233,.10)',
  text2:'#94a3b8', text3:'#475569',
}

interface CameraControlsProps {
  zoom:       number;  onZoom:       (v:number) => void
  brightness: number;  onBrightness: (v:number) => void
  contrast:   number;  onContrast:   (v:number) => void
  saturation: number;  onSaturation: (v:number) => void
  rotation:   number;  onRotation:   (v:number) => void
  flipH:      boolean; onFlipH:      (v:boolean) => void
  flipV:      boolean; onFlipV:      (v:boolean) => void
  showGrid:   boolean; onShowGrid:   (v:boolean) => void
  showCross:  boolean; onShowCross:  (v:boolean) => void
  onReset:    () => void
}

function Slider({ label, value, min, max, unit='', onChange }:{
  label:string; value:number; min:number; max:number; unit?:string
  onChange:(v:number)=>void
}) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:3}}>
      <div style={{display:'flex',justifyContent:'space-between'}}>
        <span style={{fontSize:10,color:C.text2,fontWeight:600}}>{label}</span>
        <span style={{fontSize:10,fontFamily:'monospace',color:C.accentDk,fontWeight:700}}>
          {value}{unit}
        </span>
      </div>
      <input type="range" min={min} max={max} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{width:'100%',height:4,accentColor:C.accent,cursor:'pointer'}}/>
    </div>
  )
}

function Toggle({ label, value, onChange }:{label:string;value:boolean;onChange:(v:boolean)=>void}) {
  return (
    <button onClick={() => onChange(!value)} style={{
      padding:'4px 10px', fontSize:11, fontWeight:600, borderRadius:5, cursor:'pointer',
      background: value ? C.accentLt : C.bgPanel,
      color:      value ? C.accentDk : C.text3,
      border:`1px solid ${value ? C.border2 : C.border}`,
      transition:'all .15s',
    }}>
      {label}
    </button>
  )
}

export default function CameraControls({
  zoom, onZoom, brightness, onBrightness, contrast, onContrast,
  saturation, onSaturation, rotation, onRotation,
  flipH, onFlipH, flipV, onFlipV,
  showGrid, onShowGrid, showCross, onShowCross, onReset,
}: CameraControlsProps) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:12,padding:10}}>

      <div style={{background:C.bgPanel,border:`1px solid ${C.border}`,borderRadius:6,padding:12}}>
        <div style={{fontSize:10,fontWeight:700,color:C.text2,textTransform:'uppercase',
          letterSpacing:'.08em',marginBottom:10}}>Image Adjustments</div>
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          <Slider label="Zoom"       value={zoom}       min={50}  max={400} unit="%" onChange={onZoom}/>
          <Slider label="Brightness" value={brightness} min={0}   max={200} unit="%" onChange={onBrightness}/>
          <Slider label="Contrast"   value={contrast}   min={0}   max={200} unit="%" onChange={onContrast}/>
          <Slider label="Saturation" value={saturation} min={0}   max={200} unit="%" onChange={onSaturation}/>
        </div>
      </div>

      <div style={{background:C.bgPanel,border:`1px solid ${C.border}`,borderRadius:6,padding:12}}>
        <div style={{fontSize:10,fontWeight:700,color:C.text2,textTransform:'uppercase',
          letterSpacing:'.08em',marginBottom:10}}>Transform</div>
        <Slider label="Rotation" value={rotation} min={0} max={360} unit="°" onChange={onRotation}/>
        <div style={{display:'flex',gap:6,marginTop:8,flexWrap:'wrap'}}>
          <Toggle label="Flip H" value={flipH} onChange={onFlipH}/>
          <Toggle label="Flip V" value={flipV} onChange={onFlipV}/>
          <button onClick={onReset} style={{
            padding:'4px 10px',fontSize:11,fontWeight:600,borderRadius:5,cursor:'pointer',
            background:C.bgPanel,color:C.text2,border:`1px solid ${C.border}`,
          }}>Reset</button>
        </div>
      </div>

      <div style={{background:C.bgPanel,border:`1px solid ${C.border}`,borderRadius:6,padding:12}}>
        <div style={{fontSize:10,fontWeight:700,color:C.text2,textTransform:'uppercase',
          letterSpacing:'.08em',marginBottom:8}}>Overlays</div>
        <div style={{display:'flex',gap:6}}>
          <Toggle label="Grid"      value={showGrid}  onChange={onShowGrid}/>
          <Toggle label="Crosshair" value={showCross} onChange={onShowCross}/>
        </div>
      </div>
    </div>
  )
}