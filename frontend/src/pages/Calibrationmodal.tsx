// pages/Calibrationmodal.tsx
// ─── IMPORTANT: LiveDetection is defined AND exported here.
// ─── CameraPage and CalibrationPage both import it from this file.
// ─── This avoids circular dependencies.
import React, { useState, useRef, useEffect } from 'react';
import { useToast } from '../hooks/useToast';
import { Calibration } from '../utils/shared';
import './CalibrationModal.css';

// ─────────────────────────────────────────────────────────────
// EXPORTED — imported by CameraPage and CalibrationPage
// ─────────────────────────────────────────────────────────────
export interface LiveDetection {
  xPx:  number;
  yPx:  number;
  d1Px: number;
  d2Px: number;
  xMm:  number;
  yMm:  number;
  d1Um: number;
  d2Um: number;
}

// ─────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────
interface HardnessEntry {
  id: number; no: number; zoomTime: string; force: string;
  hardnessLevel: string; pixelX: string; pixelY: string;
  d1Px: string; d2Px: string; d1Um: string; d2Um: string;
  hardness: string; pxmm: string; mode: 'Auto'|'Manual';
  cvtTo: string; cvtVal: string; status: 'PASS'|'WARN'|'FAIL'; time: string;
}
interface LengthEntry {
  id: number; no: number; planeMode: 'Linear'|'Radial';
  zoomTime: string; force: string; hardnessLevel: string;
  pixelX: string; pixelY: string;
  realDist1: string; realDist2: string;
  pxPerUm: string; pxmm: string; time: string;
}

const ZOOM_OPTIONS    = ['2.5x','5x','10x','20x','40x','50x'];
const FORCE_OPTIONS   = ['0.01 kgf','0.025 kgf','0.05 kgf','0.1 kgf','0.2 kgf','0.3 kgf','0.5 kgf','1 kgf'];
const HARDNESS_LEVELS = ['Low','Medium','High'];
const LOADS_KGF       = [0.1,0.3,0.5,1,5,10,30,50];
const CVT_LIST        = ['None','HK','HBW','HRA','HRB','HRC','HRD','HRF','HR15N','HR30N','HR45N','HR15T','HR30T','HR45T'];
const H_KEY = 'htp_cm_h_entries';
const L_KEY = 'htp_cm_l_entries';
const loadH = (): HardnessEntry[] => { try { return JSON.parse(localStorage.getItem(H_KEY)||'[]'); } catch { return []; } };
const saveH = (e: HardnessEntry[]) => localStorage.setItem(H_KEY, JSON.stringify(e));
const loadL = (): LengthEntry[]   => { try { return JSON.parse(localStorage.getItem(L_KEY)||'[]'); } catch { return []; } };
const saveL = (e: LengthEntry[])  => localStorage.setItem(L_KEY, JSON.stringify(e));

function convertHV(hv: number, to: string): string {
  if (!to||to==='None'||isNaN(hv)||hv<=0) return '—';
  const r = ((): number|null => {
    switch(to) {
      case 'HK':    return hv*1.05;
      case 'HBW':   return hv*0.9608;
      case 'HRA':   return 100-100/(0.0006*hv+1.3);
      case 'HRB':   return Math.min(0.2917*hv-5.833,100);
      case 'HRC':   { const v=-0.0006*hv*hv+0.37*hv-13.2; return v>0?v:null; }
      case 'HRD':   { const v=-0.0004*hv*hv+0.31*hv-3.0;  return v>0?v:null; }
      case 'HRF':   return Math.min(0.335*hv-4.48,100);
      case 'HR15N': return Math.min(0.0546*hv+62.3,100);
      case 'HR30N': return Math.min(0.0819*hv+33.2,100);
      case 'HR45N': return Math.min(0.109*hv+8.8,100);
      case 'HR15T': return Math.min(0.0602*hv+67.0,100);
      case 'HR30T': return Math.min(0.0874*hv+34.5,100);
      case 'HR45T': return Math.min(0.114*hv+9.1,100);
      default:      return null;
    }
  })();
  return r!==null ? r.toFixed(2) : '—';
}
function qualify(hv: number): 'PASS'|'WARN'|'FAIL' {
  if (isNaN(hv)||hv<=0||hv>2000) return 'FAIL';
  if (hv>=60&&hv<=1800) return 'PASS';
  return 'WARN';
}

// ─────────────────────────────────────────────────────────────
// PROPS — explicit React.FC typing so TypeScript resolves props
// ─────────────────────────────────────────────────────────────
interface CalibrationModalProps {
  feedRef:        React.RefObject<HTMLImageElement | null>;
  liveDetection?: LiveDetection | null;
  onClose:        () => void;
  onCalibResult?: (hv: number) => void;
}

const CalibrationModal: React.FC<CalibrationModalProps> = ({
  feedRef,
  liveDetection = null,
  onClose,
  onCalibResult,
}) => {
  const { toast } = useToast();
  const [tab, setTab] = useState<'hardness'|'length'>('hardness');

  // ── Hardness state ───────────────────────────────────────────
  const [hEntries, setHEntries] = useState<HardnessEntry[]>(loadH);
  const [hSelIds,  setHSelIds]  = useState<Set<number>>(new Set());
  const hIdRef = useRef(loadH().length);

  const [hMeasMode,  setHMeasMode]  = useState<'Auto'|'Manual'>('Auto');
  const [hZoom,      setHZoom]      = useState('10x');
  const [hForce,     setHForce]     = useState('1 kgf');
  const [hLevel,     setHLevel]     = useState('Medium');
  const [hLoad,      setHLoad]      = useState(10);
  const [hvUser,     setHvUser]     = useState('');
  const [hCvtTo,     setHCvtTo]     = useState('None');

  const [hXPx,       setHXPx]       = useState<number|null>(null);
  const [hYPx,       setHYPx]       = useState<number|null>(null);
  const [hD1Px,      setHD1Px]      = useState<number|null>(null);
  const [hD2Px,      setHD2Px]      = useState<number|null>(null);
  const [hMeasuring, setHMeasuring] = useState(false);
  const [hFromLive,  setHFromLive]  = useState(false);

  // ── Auto-fill pixel measurements from liveDetection when modal opens ──
  // This fires once on mount so the fields are pre-populated immediately
  useEffect(() => {
    if (liveDetection && hXPx === null) {
      setHXPx(liveDetection.xPx);
      setHYPx(liveDetection.yPx);
      setHD1Px(liveDetection.d1Px);
      setHD2Px(liveDetection.d2Px);
      setHFromLive(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [mHXPx,  setMHXPx]  = useState('');
  const [mHYPx,  setMHYPx]  = useState('');
  const [mHD1Px, setMHD1Px] = useState('');
  const [mHD2Px, setMHD2Px] = useState('');
  const [mHComputed, setMHComputed] = useState(false);

  // ── Length state ─────────────────────────────────────────────
  const [lEntries, setLEntries] = useState<LengthEntry[]>(loadL);
  const [lSelIds,  setLSelIds]  = useState<Set<number>>(new Set());
  const lIdRef = useRef(loadL().length);

  const [lPlane,     setLPlane]     = useState<'Linear'|'Radial'>('Linear');
  const [lZoom,      setLZoom]      = useState('10x');
  const [lForce,     setLForce]     = useState('0.1 kgf');
  const [lLevel,     setLLevel]     = useState('Medium');
  const [lMeasuring, setLMeasuring] = useState(false);
  const [lXPxAuto,   setLXPxAuto]   = useState('—');
  const [lYPxAuto,   setLYPxAuto]   = useState('—');
  const [lMeasMode,  setLMeasMode]  = useState<'Auto'|'Manual'>('Auto');
  const [mLXPx,      setMLXPx]      = useState('');
  const [mLYPx,      setMLYPx]      = useState('');
  const [lRealDist1, setLRealDist1] = useState('');
  const [lRealDist2, setLRealDist2] = useState('');
  const [lMComputed, setLMComputed] = useState(false);

  // ─────────────────────────────────────────────────────────────
  // HARDNESS AUTO MEASURE
  // Priority 1: use liveDetection from camera
  // Priority 2: run fresh detection on feed frame
  // Priority 3: estimate fallback
  // ─────────────────────────────────────────────────────────────
  const autoMeasureH = async () => {
    setHMeasuring(true);
    try {
      // Priority 1: live detection already computed by camera page
      if (liveDetection) {
        setHXPx(liveDetection.xPx);
        setHYPx(liveDetection.yPx);
        setHD1Px(liveDetection.d1Px);
        setHD2Px(liveDetection.d2Px);
        setHFromLive(true);
        toast('Auto-measured from live camera ✓', 'success');
        setHMeasuring(false);
        return;
      }

      // Priority 2: read current feed frame
      const feed = feedRef.current;
      if (!feed || !feed.naturalWidth) throw new Error('No live frame — connect camera first');
      const W = feed.naturalWidth, H = feed.naturalHeight;
      const tmp = document.createElement('canvas');
      tmp.width=W; tmp.height=H;
      const ctx = tmp.getContext('2d')!;
      ctx.drawImage(feed,0,0,W,H);
      const img = ctx.getImageData(0,0,W,H).data;

      // Dark-region detection
      const BSIZ = Math.floor(Math.min(W,H)/8);
      let minMean=255, bCX=W/2, bCY=H/2;
      for (let by2=0;by2<H-BSIZ;by2+=BSIZ) {
        for (let bx2=0;bx2<W-BSIZ;bx2+=BSIZ) {
          let s=0;
          for (let dy=0;dy<BSIZ;dy++) for (let dx=0;dx<BSIZ;dx++) {
            const pi=((by2+dy)*W+(bx2+dx))*4;
            s+=(img[pi]+img[pi+1]+img[pi+2])/3;
          }
          const m=s/(BSIZ*BSIZ);
          if(m<minMean){minMean=m;bCX=bx2+BSIZ/2;bCY=by2+BSIZ/2;}
        }
      }
      const roiR=Math.floor(Math.min(W,H)*0.35);
      const x1=Math.max(0,Math.round(bCX-roiR)), y1=Math.max(0,Math.round(bCY-roiR));
      const x2=Math.min(W-1,Math.round(bCX+roiR)), y2=Math.min(H-1,Math.round(bCY+roiR));
      let rSum=0,rCnt=0;
      for(let y=y1;y<=y2;y++) for(let x=x1;x<=x2;x++){const pi=(y*W+x)*4;rSum+=(img[pi]+img[pi+1]+img[pi+2])/3;rCnt++;}
      const rMean=rSum/rCnt;
      let rVar=0;
      for(let y=y1;y<=y2;y++) for(let x=x1;x<=x2;x++){const pi=(y*W+x)*4;const d=(img[pi]+img[pi+1]+img[pi+2])/3-rMean;rVar+=d*d;}
      const thr=Math.max(20,rMean-0.7*Math.sqrt(rVar/rCnt));
      let sumX=0,sumY=0,cnt=0,lx=W,rx=0,ty=H,by=0;
      for(let y=y1;y<=y2;y++){for(let x=x1;x<=x2;x++){const pi=(y*W+x)*4;if((img[pi]+img[pi+1]+img[pi+2])/3<thr){sumX+=x;sumY+=y;cnt++;if(x<lx)lx=x;if(x>rx)rx=x;if(y<ty)ty=y;if(y>by)by=y;}}}
      if(cnt<15) throw new Error('No indentation detected');
      setHXPx(Math.round(sumX/cnt));
      setHYPx(Math.round(sumY/cnt));
      setHD1Px(rx-lx);
      setHD2Px(by-ty);
      setHFromLive(false);
      toast('Auto-measured from frame ✓', 'success');
    } catch(e: any) {
      // Priority 3: estimate from HV formula
      const feed = feedRef.current;
      const W = feed?.naturalWidth||feed?.width||800, H = feed?.naturalHeight||feed?.height||600;
      setHXPx(Math.round(W/2)); setHYPx(Math.round(H/2));
      const hv = parseFloat(hvUser), pm = Calibration.get().px_per_mm||100;
      if (!isNaN(hv)&&hv>0&&hLoad>0&&pm>0) {
        const h = (Math.sqrt(1854.4*hLoad/hv)/1000*pm)/2;
        setHD1Px(Math.round(h*2)); setHD2Px(Math.round(h*2*0.98));
      } else { setHD1Px(412); setHD2Px(408); }
      setHFromLive(false);
      toast('Estimated: '+e.message, 'warn');
    }
    setHMeasuring(false);
  };

  const manualMeasureH = () => {
    if (isNaN(parseFloat(mHXPx))||parseFloat(mHXPx)<=0||isNaN(parseFloat(mHYPx))||parseFloat(mHYPx)<=0) {
      toast('Enter X and Y pixel positions first','warn'); return;
    }
    setMHComputed(true);
    toast('Manual values calculated ✓','success');
  };

  // ─────────────────────────────────────────────────────────────
  // LENGTH AUTO MEASURE
  // ─────────────────────────────────────────────────────────────
  const autoMeasureL = async () => {
    setLMeasuring(true);
    try {
      if (liveDetection) {
        setLXPxAuto(String(liveDetection.d1Px));
        setLYPxAuto(String(liveDetection.d2Px));
        toast('Length captured from live camera ✓','success');
        setLMeasuring(false); return;
      }
      const feed = feedRef.current;
      if (!feed||!feed.naturalWidth) throw new Error('No live image');
      const W=feed.naturalWidth,H=feed.naturalHeight;
      const tmp=document.createElement('canvas');tmp.width=W;tmp.height=H;
      const ctx=tmp.getContext('2d')!;ctx.drawImage(feed,0,0,W,H);
      const img=ctx.getImageData(0,0,W,H).data;
      const thr=180;let lx=W,rx=0,ty=H,by=0;
      for(let y=Math.floor(H*0.3);y<Math.floor(H*0.7);y++){for(let x=0;x<W;x++){const i=(y*W+x)*4;if((img[i]+img[i+1]+img[i+2])/3>thr){if(x<lx)lx=x;if(x>rx)rx=x;if(y<ty)ty=y;if(y>by)by=y;}}}
      if(rx-lx<10&&by-ty<10) throw new Error('No reference feature');
      const spanX=rx-lx,spanY=by-ty;
      setLXPxAuto(String(lPlane==='Linear'?spanX:Math.round(Math.hypot(spanX,spanY))));
      setLYPxAuto(String(spanY));
      toast('Length captured ✓','success');
    } catch(e: any) {
      const feed=feedRef.current;
      const W=feed?.naturalWidth||feed?.width||800,H=feed?.naturalHeight||feed?.height||600;
      setLXPxAuto(String(Math.round(W*0.5)));setLYPxAuto(String(Math.round(H*0.3)));
      toast('Simulated: '+e.message,'warn');
    }
    setLMeasuring(false);
  };

  const manualMeasureL = () => {
    if (isNaN(parseFloat(mLXPx))||parseFloat(mLXPx)<=0||isNaN(parseFloat(mLYPx))||parseFloat(mLYPx)<=0){toast('Enter pixel X and Y first','warn');return;}
    if (isNaN(parseFloat(lRealDist1))||parseFloat(lRealDist1)<=0){toast('Enter Real Distance 1 first','warn');return;}
    setLMComputed(true);toast('Manual length values calculated ✓','success');
  };

  // ─────────────────────────────────────────────────────────────
  // Computed helpers
  // ─────────────────────────────────────────────────────────────
  const getHVals = () => {
    const pm=Calibration.get().px_per_mm||100, hv=parseFloat(hvUser);
    const xPxV  = hMeasMode==='Auto'?(hXPx??0):(parseFloat(mHXPx)||0);
    const yPxV  = hMeasMode==='Auto'?(hYPx??0):(parseFloat(mHYPx)||0);
    const d1PxV = hMeasMode==='Auto'?(hD1Px??0):(parseFloat(mHD1Px)||0);
    const d2PxV = hMeasMode==='Auto'?(hD2Px??0):(parseFloat(mHD2Px)||0);
    const xMm=(xPxV/pm).toFixed(3), yMm=(yPxV/pm).toFixed(3);
    const d1Um=(d1PxV/pm*1000).toFixed(2), d2Um=(d2PxV/pm*1000).toFixed(2);
    const d1N=parseFloat(d1Um),d2N=parseFloat(d2Um);
    const dAvg=(!isNaN(d1N)&&!isNaN(d2N)&&d1N>0&&d2N>0)?(d1N+d2N)/2:NaN;
    return{xPxV,yPxV,xMm,yMm,d1PxV,d2PxV,d1Um,d2Um,dAvg,hv,pm};
  };
  const hVals = getHVals();
  const hShowComputed = hMeasMode==='Auto'
    ?(hXPx!==null||hD1Px!==null)
    :mHComputed&&(parseFloat(mHXPx)>0||parseFloat(mHD1Px)>0);
  const hCanAdd = !isNaN(hVals.hv)&&hVals.hv>0&&
    (hMeasMode==='Auto'?hXPx!==null&&hD1Px!==null:parseFloat(mHXPx)>0&&parseFloat(mHYPx)>0&&mHComputed);

  const lActivePxX = lMeasMode==='Auto'?lXPxAuto:mLXPx||'—';
  const lActivePxY = lMeasMode==='Auto'?lYPxAuto:mLYPx||'—';
  const getLVals = () => {
    const xN=parseFloat(lActivePxX),r1=parseFloat(lRealDist1),r2=parseFloat(lRealDist2);
    if(isNaN(xN)||xN<=0||isNaN(r1)||r1<=0)return null;
    const realUm=(!isNaN(r2)&&r2>0)?(r1+r2)/2:r1;
    return{pxPerUm:(xN/realUm).toFixed(4),pxPerMm:((xN/realUm)*1000).toFixed(2)};
  };
  const lComputed = getLVals();
  const lShowComputed = lMeasMode==='Auto'?lComputed!==null:(lMComputed&&lComputed!==null);
  const lCanAdd = lMeasMode==='Auto'?lComputed!==null:lMComputed&&lComputed!==null;

  // ─────────────────────────────────────────────────────────────
  // Add entries
  // ─────────────────────────────────────────────────────────────
  const addHEntry = () => {
    const{xPxV,yPxV,d1PxV,d2PxV,d1Um,d2Um,pm}=getHVals();
    const hv=parseFloat(hvUser); hIdRef.current++;
    const now=new Date();
    const entry: HardnessEntry={
      id:Date.now()+Math.random(),no:hIdRef.current,zoomTime:hZoom,force:hForce,
      hardnessLevel:hLevel,pixelX:String(xPxV),pixelY:String(yPxV),
      d1Px:hMeasMode==='Auto'?String(d1PxV):(mHD1Px||'—'),
      d2Px:hMeasMode==='Auto'?String(d2PxV):(mHD2Px||'—'),
      d1Um,d2Um,hardness:hv.toFixed(1),pxmm:pm.toFixed(2),mode:hMeasMode,
      cvtTo:hCvtTo,cvtVal:convertHV(hv,hCvtTo),status:qualify(hv),
      time:now.toLocaleDateString()+' '+now.toLocaleTimeString(),
    };
    const updated=[...hEntries,entry];setHEntries(updated);saveH(updated);
    if(d1PxV>0&&d2PxV>0&&hLoad>0&&hv>0){
      const d_mm=Math.sqrt(1854.4*hLoad/hv)/1000;
      const c=Calibration.get();c.px_per_mm=+((d1PxV+d2PxV)/2/d_mm).toFixed(2);c.ref_hv=hv;c.date=Date.now();Calibration.set(c);
    }
    onCalibResult?.(hv);
    setHXPx(null);setHYPx(null);setHD1Px(null);setHD2Px(null);
    setMHXPx('');setMHYPx('');setMHD1Px('');setMHD2Px('');setHvUser('');setMHComputed(false);setHFromLive(false);
    toast('Hardness entry added ✓','success');
  };

  const addLEntry = () => {
    if(!lComputed)return; lIdRef.current++;
    const now=new Date();
    const entry: LengthEntry={
      id:Date.now()+Math.random(),no:lIdRef.current,planeMode:lPlane,zoomTime:lZoom,force:lForce,
      hardnessLevel:lLevel,pixelX:lActivePxX,pixelY:lActivePxY,
      realDist1:lRealDist1,realDist2:lRealDist2||'—',
      pxPerUm:lComputed.pxPerUm,pxmm:lComputed.pxPerMm,
      time:now.toLocaleDateString()+' '+now.toLocaleTimeString(),
    };
    const updated=[...lEntries,entry];setLEntries(updated);saveL(updated);
    const c=Calibration.get();c.px_per_mm=+lComputed.pxPerMm;c.date=Date.now();Calibration.set(c);
    setLXPxAuto('—');setLYPxAuto('—');setMLXPx('');setMLYPx('');setLRealDist1('');setLRealDist2('');setLMComputed(false);
    toast('Length entry added ✓','success');
  };

  const exportH = () => {
    if(!hEntries.length)return;
    const hdr=['No','Zoom','Force','Level','X(px)','Y(px)','D1(px)','D2(px)','D1(µm)','D2(µm)','HV','px/mm','Mode','CvtTo','CvtVal','Status','Time'];
    const lines=[hdr.join(','),...hEntries.map(e=>[e.no,e.zoomTime,e.force,e.hardnessLevel,e.pixelX,e.pixelY,e.d1Px,e.d2Px,e.d1Um,e.d2Um,e.hardness,e.pxmm,e.mode,e.cvtTo,e.cvtVal,e.status,e.time].join(','))];
    const b=new Blob([lines.join('\n')],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='hardness_calib_'+Date.now()+'.csv';a.click();
  };
  const exportL = () => {
    if(!lEntries.length)return;
    const hdr=['No','Mode','Zoom','Force','Level','X(px)','Y(px)','RealDist1(µm)','RealDist2(µm)','px/µm','px/mm','Time'];
    const lines=[hdr.join(','),...lEntries.map(e=>[e.no,e.planeMode,e.zoomTime,e.force,e.hardnessLevel,e.pixelX,e.pixelY,e.realDist1,e.realDist2,e.pxPerUm,e.pxmm,e.time].join(','))];
    const b=new Blob([lines.join('\n')],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='length_calib_'+Date.now()+'.csv';a.click();
  };

  const hSummary = () => {
    const hvs=hEntries.map(e=>parseFloat(e.hardness)).filter(v=>!isNaN(v));
    return{total:hEntries.length,mean:hvs.length?(hvs.reduce((a,b)=>a+b,0)/hvs.length).toFixed(1):'—',passRate:hEntries.length?Math.round(hEntries.filter(e=>e.status==='PASS').length/hEntries.length*100):0};
  };
  const lSummary = () => {
    const pxs=lEntries.map(e=>parseFloat(e.pxmm)).filter(v=>!isNaN(v));
    return{total:lEntries.length,mean:pxs.length?(pxs.reduce((a,b)=>a+b,0)/pxs.length).toFixed(2):'—'};
  };

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="cm-overlay" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="cm-modal">

        {/* HEADER */}
        <div className="cm-header">
          <div className="cm-header-left">
            <div className="cm-logo"><i className="fa-solid fa-ruler-combined"/></div>
            <div>
              <div className="cm-title">Calibration Manager</div>
              <div className="cm-sub">
                Hardness &amp; Length calibration
                {liveDetection && (
                  <span className="cm-live-badge-sm">
                    <i className="fa fa-circle-dot"/> Live: X:{liveDetect_xPx(liveDetection)} Y:{liveDetect_yPx(liveDetection)} D1:{liveDetect_d1(liveDetection)}µm D2:{liveDetect_d2(liveDetection)}µm
                  </span>
                )}
              </div>
            </div>
          </div>
          <button className="cm-close" onClick={onClose}><i className="fa fa-xmark"/></button>
        </div>

        {/* TABS */}
        <div className="cm-tabs">
          <button className={`cm-tab${tab==='hardness'?' active':''}`} onClick={()=>setTab('hardness')}><i className="fa fa-diamond"/> Hardness Calibration</button>
          <button className={`cm-tab${tab==='length'?' active':''}`} onClick={()=>setTab('length')}><i className="fa fa-ruler"/> Length Calibration</button>
        </div>

        {/* ══════════ HARDNESS TAB ══════════ */}
        {tab==='hardness' && (
          <div className="cm-body">
            {/* LEFT — table */}
            <div className="cm-left">
              <div className="cm-tbl-toolbar">
                <div className="cm-calib-type-btns">
                  <button className={`cm-type-btn${hMeasMode==='Auto'?' active':''}`} onClick={()=>{setHMeasMode('Auto');setMHComputed(false);}}><i className="fa fa-robot"/> Auto Measure</button>
                  <button className={`cm-type-btn${hMeasMode==='Manual'?' active':''}`} onClick={()=>{setHMeasMode('Manual');setMHComputed(false);}}><i className="fa fa-hand-pointer"/> Manual Entry</button>
                </div>
                <div className="cm-action-btns">
                  <button className="cm-btn" onClick={exportH}><i className="fa fa-download"/> Export</button>
                  <button className="cm-btn red" onClick={()=>{const u=hEntries.filter(e=>!hSelIds.has(e.id));setHEntries(u);saveH(u);setHSelIds(new Set());}} disabled={!hSelIds.size}><i className="fa fa-trash"/> Delete</button>
                  <button className="cm-btn red" onClick={()=>{if(!confirm('Clear all?'))return;setHEntries([]);saveH([]);}}><i className="fa fa-ban"/> Clear</button>
                </div>
              </div>
              <div className="cm-tbl-scroll">
                <table className="cm-table">
                  <thead><tr>
                    <th><input type="checkbox" checked={hSelIds.size===hEntries.length&&hEntries.length>0} onChange={e=>setHSelIds(e.target.checked?new Set(hEntries.map(x=>x.id)):new Set())}/></th>
                    <th>No</th><th>Zoom</th><th>Force</th><th>Level</th><th>X(px)</th><th>Y(px)</th><th>D1(µm)</th><th>D2(µm)</th><th>HV</th><th>px/mm</th><th>Mode</th><th>Cvt</th><th>Status</th><th>Time</th><th/>
                  </tr></thead>
                  <tbody>
                    {hEntries.length===0
                      ?<tr><td colSpan={16} className="cm-empty">No entries — fill in the right panel and click Add Calibration</td></tr>
                      :hEntries.map(e=>(
                        <tr key={e.id} className={hSelIds.has(e.id)?'cm-sel':''}>
                          <td><input type="checkbox" checked={hSelIds.has(e.id)} onChange={()=>{const n=new Set(hSelIds);n.has(e.id)?n.delete(e.id):n.add(e.id);setHSelIds(n);}}/></td>
                          <td>{e.no}</td><td>{e.zoomTime}</td><td>{e.force}</td>
                          <td><span className={`cm-level cm-level-${e.hardnessLevel.toLowerCase()}`}>{e.hardnessLevel}</span></td>
                          <td style={{color:'#0ea5e9',fontFamily:'monospace'}}>{e.pixelX}</td>
                          <td style={{color:'#10b981',fontFamily:'monospace'}}>{e.pixelY}</td>
                          <td style={{color:'#fbbf24'}}>{e.d1Um}</td>
                          <td style={{color:'#0ea5e9'}}>{e.d2Um}</td>
                          <td><b style={{color:'#0ea5e9',fontFamily:'monospace'}}>{e.hardness}</b></td>
                          <td style={{color:'#10b981'}}>{e.pxmm}</td>
                          <td><span className={`cm-level cm-level-${e.mode.toLowerCase()}`}>{e.mode}</span></td>
                          <td style={{fontSize:10,color:'#94a3b8'}}>{e.cvtTo!=='None'?`${e.cvtTo}: ${e.cvtVal}`:'—'}</td>
                          <td><span className={e.status==='PASS'?'cm-pass':e.status==='WARN'?'cm-warn':'cm-fail'}>{e.status==='PASS'?'✓ PASS':e.status==='WARN'?'⚠ WARN':'✗ FAIL'}</span></td>
                          <td style={{fontSize:10,color:'#94a3b8'}}>{e.time}</td>
                          <td><button className="cm-row-del" onClick={()=>{const u=hEntries.filter(x=>x.id!==e.id);setHEntries(u);saveH(u);}}><i className="fa fa-xmark"/></button></td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              </div>
              {hEntries.length>0&&(()=>{const s=hSummary();return(<div className="cm-summary"><div className="cm-summary-title">Summary</div><div className="cm-sum-row"><span>Total</span><b>{s.total}</b></div><div className="cm-sum-row"><span>Mean HV</span><b style={{color:'#0ea5e9'}}>{s.mean}</b></div><div className="cm-sum-row"><span>Pass rate</span><b style={{color:'#10b981'}}>{s.passRate}%</b></div></div>);})()}
            </div>

            {/* RIGHT — form */}
            <div className="cm-right">
              <div className="cm-section">
                <div className="cm-section-title"><i className="fa fa-sliders"/> Parameters</div>
                <div className="cm-field"><label>Zoom / Time</label><select value={hZoom} onChange={e=>setHZoom(e.target.value)}>{ZOOM_OPTIONS.map(o=><option key={o}>{o}</option>)}</select></div>
                <div className="cm-field"><label>Force</label><select value={hForce} onChange={e=>setHForce(e.target.value)}>{FORCE_OPTIONS.map(o=><option key={o}>{o}</option>)}</select></div>
                <div className="cm-field"><label>Hardness Level</label><div className="cm-level-btns">{HARDNESS_LEVELS.map(l=>(<button key={l} className={`cm-lvl-btn cm-lvl-${l.toLowerCase()}${hLevel===l?' active':''}`} onClick={()=>setHLevel(l)}>{l}</button>))}</div></div>
                <div className="cm-field"><label>Load (kgf)</label><select value={hLoad} onChange={e=>setHLoad(+e.target.value)}>{LOADS_KGF.map(l=><option key={l} value={l}>{l} kgf</option>)}</select></div>
              </div>

              <div className="cm-section">
                <div className="cm-section-title"><i className="fa fa-diamond"/> Hardness Value</div>
                <div className="cm-field"><label>HV Value <span style={{color:'#ef4444'}}>*</span></label>
                  <div className="cm-input-wrap"><input type="number" placeholder="e.g. 250" value={hvUser} onChange={e=>setHvUser(e.target.value)} style={{color:'#0ea5e9',fontWeight:700}}/><span className="cm-unit">HV</span></div>
                </div>
                <div className="cm-field"><label>Convert To</label><select value={hCvtTo} onChange={e=>setHCvtTo(e.target.value)}>{CVT_LIST.map(t=><option key={t}>{t}</option>)}</select></div>
                {hCvtTo!=='None'&&!isNaN(parseFloat(hvUser))&&parseFloat(hvUser)>0&&(<div className="cm-cvt-preview"><span>{hCvtTo}</span><b>{convertHV(parseFloat(hvUser),hCvtTo)}</b></div>)}
              </div>

              <div className="cm-section">
                <div className="cm-section-title">
                  <i className="fa fa-crosshairs"/> Pixel Measurements
                  {hMeasMode==='Auto'&&liveDetection&&!hXPx&&(<span className="cm-live-hint"><i className="fa fa-bolt"/> Live data ready — click Auto Measure</span>)}
                  {hMeasMode==='Auto'&&hFromLive&&hXPx!==null&&(<span className="cm-live-hint cm-live-hint-ok"><i className="fa fa-check"/> From live camera</span>)}
                </div>

                {hMeasMode==='Auto' ? (<>
                  <div className="cm-field"><label>X Position (px)</label>
                    <div className="cm-input-wrap"><input readOnly value={hXPx!==null?String(hXPx):'—'} className="cm-readonly" style={{color:hXPx!==null?'#0ea5e9':undefined}}/><span className="cm-unit">px</span></div>
                  </div>
                  <div className="cm-field"><label>Y Position (px)</label>
                    <div className="cm-input-wrap"><input readOnly value={hYPx!==null?String(hYPx):'—'} className="cm-readonly" style={{color:hYPx!==null?'#10b981':undefined}}/><span className="cm-unit">px</span></div>
                  </div>
                  <div className="cm-field"><label>D1 / D2 (px)</label>
                    <div style={{display:'flex',gap:6}}>
                      <input readOnly value={hD1Px!==null?String(hD1Px):'—'} className="cm-readonly" style={{flex:1,color:hD1Px!==null?'#d946ef':undefined}}/>
                      <input readOnly value={hD2Px!==null?String(hD2Px):'—'} className="cm-readonly" style={{flex:1,color:hD2Px!==null?'#f59e0b':undefined}}/>
                    </div>
                  </div>
                </>) : (<>
                  <div className="cm-field"><label>X Position (px) <span style={{color:'#ef4444'}}>*</span></label>
                    <div className="cm-input-wrap"><input type="number" placeholder="e.g. 960" value={mHXPx} onChange={e=>{setMHXPx(e.target.value);setMHComputed(false);}}/><span className="cm-unit">px</span></div>
                  </div>
                  <div className="cm-field"><label>Y Position (px) <span style={{color:'#ef4444'}}>*</span></label>
                    <div className="cm-input-wrap"><input type="number" placeholder="e.g. 540" value={mHYPx} onChange={e=>{setMHYPx(e.target.value);setMHComputed(false);}}/><span className="cm-unit">px</span></div>
                  </div>
                  <div className="cm-field"><label>D1 (px)</label>
                    <div className="cm-input-wrap"><input type="number" placeholder="e.g. 412" value={mHD1Px} onChange={e=>{setMHD1Px(e.target.value);setMHComputed(false);}}/><span className="cm-unit">px</span></div>
                  </div>
                  <div className="cm-field"><label>D2 (px)</label>
                    <div className="cm-input-wrap"><input type="number" placeholder="e.g. 408" value={mHD2Px} onChange={e=>{setMHD2Px(e.target.value);setMHComputed(false);}}/><span className="cm-unit">px</span></div>
                  </div>
                </>)}

                {hShowComputed && (<div className="cm-computed-grid">
                  {[['X(mm)',hVals.xMm],['Y(mm)',hVals.yMm],['D1(µm)',hVals.d1Um],['D2(µm)',hVals.d2Um]].map(([k,v])=>(
                    <div key={k} className="cm-computed-cell"><div className="cm-computed-key">{k}</div><div className="cm-computed-val">{v}</div></div>
                  ))}
                </div>)}
                {hShowComputed&&!isNaN(hVals.dAvg)&&hVals.dAvg>0&&(
                  <div className="cm-davg">D avg = <b>{hVals.dAvg.toFixed(2)} µm</b>{!isNaN(hVals.hv)&&hVals.hv>0&&hLoad>0&&(<span> · Expected {(Math.sqrt(1854.4*hLoad/hVals.hv)*1000).toFixed(0)} µm</span>)}</div>
                )}
              </div>

              <div className="cm-section">
                <div className="cm-section-title"><i className="fa fa-ruler-combined"/> Measure</div>
                <div className="cm-measure-btns">
                  <button className="cm-meas-btn auto" onClick={autoMeasureH} disabled={hMeasuring}>
                    {hMeasuring?<><i className="fa fa-spinner fa-spin"/> Measuring…</>:<><i className="fa fa-robot"/> Auto Measure{liveDetection&&!hXPx&&<span className="cm-dot-live"/>}</>}
                  </button>
                  <button className="cm-meas-btn" onClick={manualMeasureH} disabled={hMeasMode==='Manual'&&!(parseFloat(mHXPx)>0&&parseFloat(mHYPx)>0)}>
                    <i className="fa fa-hand-pointer"/> Manual Measure
                  </button>
                </div>
              </div>
              <button className="cm-add-btn" onClick={addHEntry} disabled={!hCanAdd}><i className="fa fa-plus-circle"/> Add Calibration</button>
            </div>
          </div>
        )}

        {/* ══════════ LENGTH TAB ══════════ */}
        {tab==='length' && (
          <div className="cm-body">
            <div className="cm-left">
              <div className="cm-tbl-toolbar">
                <div className="cm-calib-type-btns">
                  {(['Linear','Radial'] as const).map(m=>(<button key={m} className={`cm-type-btn${lPlane===m?' active':''}`} onClick={()=>setLPlane(m)}><i className={`fa ${m==='Linear'?'fa-arrows-left-right':'fa-circle-dot'}`}/> {m}</button>))}
                </div>
                <div className="cm-action-btns">
                  <button className="cm-btn" onClick={exportL}><i className="fa fa-download"/> Export</button>
                  <button className="cm-btn red" onClick={()=>{const u=lEntries.filter(e=>!lSelIds.has(e.id));setLEntries(u);saveL(u);setLSelIds(new Set());}} disabled={!lSelIds.size}><i className="fa fa-trash"/> Delete</button>
                  <button className="cm-btn red" onClick={()=>{if(!confirm('Clear all?'))return;setLEntries([]);saveL([]);}}><i className="fa fa-ban"/> Clear</button>
                </div>
              </div>
              <div className="cm-tbl-scroll">
                <table className="cm-table">
                  <thead><tr>
                    <th><input type="checkbox" checked={lSelIds.size===lEntries.length&&lEntries.length>0} onChange={e=>setLSelIds(e.target.checked?new Set(lEntries.map(x=>x.id)):new Set())}/></th>
                    <th>No</th><th>Mode</th><th>Zoom</th><th>Force</th><th>Level</th><th>X(px)</th><th>Y(px)</th><th>R.Dist1</th><th>R.Dist2</th><th>px/µm</th><th>px/mm</th><th>Time</th><th/>
                  </tr></thead>
                  <tbody>
                    {lEntries.length===0
                      ?<tr><td colSpan={14} className="cm-empty">No entries — fill in the right panel and click Add Calibration</td></tr>
                      :lEntries.map(e=>(
                        <tr key={e.id} className={lSelIds.has(e.id)?'cm-sel':''}>
                          <td><input type="checkbox" checked={lSelIds.has(e.id)} onChange={()=>{const n=new Set(lSelIds);n.has(e.id)?n.delete(e.id):n.add(e.id);setLSelIds(n);}}/></td>
                          <td>{e.no}</td><td><span className={`cm-level cm-level-${e.planeMode.toLowerCase()}`}>{e.planeMode}</span></td>
                          <td>{e.zoomTime}</td><td>{e.force}</td><td><span className={`cm-level cm-level-${e.hardnessLevel.toLowerCase()}`}>{e.hardnessLevel}</span></td>
                          <td style={{color:'#0ea5e9',fontFamily:'monospace'}}>{e.pixelX}</td>
                          <td style={{color:'#10b981',fontFamily:'monospace'}}>{e.pixelY}</td>
                          <td style={{color:'#fbbf24'}}>{e.realDist1} µm</td><td style={{color:'#94a3b8'}}>{e.realDist2}</td>
                          <td style={{color:'#d946ef'}}>{e.pxPerUm}</td><td style={{color:'#10b981'}}>{e.pxmm}</td>
                          <td style={{fontSize:10,color:'#94a3b8'}}>{e.time}</td>
                          <td><button className="cm-row-del" onClick={()=>{const u=lEntries.filter(x=>x.id!==e.id);setLEntries(u);saveL(u);}}><i className="fa fa-xmark"/></button></td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              </div>
              {lEntries.length>0&&(()=>{const s=lSummary();return(<div className="cm-summary"><div className="cm-summary-title">Summary</div><div className="cm-sum-row"><span>Total</span><b>{s.total}</b></div><div className="cm-sum-row"><span>Mean px/mm</span><b style={{color:'#10b981'}}>{s.mean}</b></div></div>);})()}
            </div>

            <div className="cm-right">
              <div className="cm-section">
                <div className="cm-section-title"><i className="fa fa-sliders"/> Parameters</div>
                <div className="cm-field"><label>Zoom</label><select value={lZoom} onChange={e=>setLZoom(e.target.value)}>{ZOOM_OPTIONS.map(o=><option key={o}>{o}</option>)}</select></div>
                <div className="cm-field"><label>Force</label><select value={lForce} onChange={e=>setLForce(e.target.value)}>{FORCE_OPTIONS.map(o=><option key={o}>{o}</option>)}</select></div>
                <div className="cm-field"><label>Level</label><div className="cm-level-btns">{HARDNESS_LEVELS.map(l=>(<button key={l} className={`cm-lvl-btn cm-lvl-${l.toLowerCase()}${lLevel===l?' active':''}`} onClick={()=>setLLevel(l)}>{l}</button>))}</div></div>
              </div>

              <div className="cm-section">
                <div className="cm-section-title">
                  <i className="fa fa-camera"/> Pixel Length
                  {lMeasMode==='Auto'&&liveDetection&&lXPxAuto==='—'&&(<span className="cm-live-hint"><i className="fa fa-bolt"/> Live data ready</span>)}
                </div>
                <div className="cm-meas-mode-row">
                  <button className={`cm-type-btn${lMeasMode==='Auto'?' active':''}`} onClick={()=>{setLMeasMode('Auto');setLMComputed(false);}}><i className="fa fa-robot"/> Auto</button>
                  <button className={`cm-type-btn${lMeasMode==='Manual'?' active':''}`} onClick={()=>{setLMeasMode('Manual');setLMComputed(false);}}><i className="fa fa-hand-pointer"/> Manual</button>
                </div>
                {lMeasMode==='Auto'?(<>
                  <div className="cm-field"><label>Pixel Length X</label>
                    <div className="cm-input-wrap"><input readOnly value={lXPxAuto} className="cm-readonly" style={{color:lXPxAuto!=='—'?'#0ea5e9':undefined}}/><span className="cm-unit">px</span></div>
                  </div>
                  <div className="cm-field"><label>Pixel Length Y</label>
                    <div className="cm-input-wrap"><input readOnly value={lYPxAuto} className="cm-readonly" style={{color:lYPxAuto!=='—'?'#10b981':undefined}}/><span className="cm-unit">px</span></div>
                  </div>
                </>):(<>
                  <div className="cm-field"><label>Pixel Length X <span style={{color:'#ef4444'}}>*</span></label>
                    <div className="cm-input-wrap"><input type="number" placeholder="e.g. 960" value={mLXPx} onChange={e=>{setMLXPx(e.target.value);setLMComputed(false);}}/><span className="cm-unit">px</span></div>
                  </div>
                  <div className="cm-field"><label>Pixel Length Y <span style={{color:'#ef4444'}}>*</span></label>
                    <div className="cm-input-wrap"><input type="number" placeholder="e.g. 540" value={mLYPx} onChange={e=>{setMLYPx(e.target.value);setLMComputed(false);}}/><span className="cm-unit">px</span></div>
                  </div>
                </>)}
              </div>

              <div className="cm-section">
                <div className="cm-section-title"><i className="fa fa-ruler"/> Real Distance</div>
                <div className="cm-field"><label>Real Distance 1 <span style={{color:'#ef4444'}}>*</span></label><div className="cm-input-wrap"><input type="number" placeholder="e.g. 100" value={lRealDist1} onChange={e=>{setLRealDist1(e.target.value);setLMComputed(false);}}/><span className="cm-unit">µm</span></div></div>
                <div className="cm-field"><label>Real Distance 2</label><div className="cm-input-wrap"><input type="number" placeholder="optional" value={lRealDist2} onChange={e=>{setLRealDist2(e.target.value);setLMComputed(false);}}/><span className="cm-unit">µm</span></div></div>
                {lShowComputed&&lComputed&&(<div className="cm-computed-grid">
                  {[['Pixel X',lActivePxX],['Pixel Y',lActivePxY],['px / µm',lComputed.pxPerUm],['px / mm',lComputed.pxPerMm]].map(([k,v])=>(
                    <div key={k} className="cm-computed-cell"><div className="cm-computed-key">{k}</div><div className="cm-computed-val">{v}</div></div>
                  ))}
                </div>)}
              </div>

              <div className="cm-section">
                <div className="cm-section-title"><i className="fa fa-ruler-combined"/> Measure</div>
                <div className="cm-measure-btns">
                  <button className="cm-meas-btn auto" onClick={autoMeasureL} disabled={lMeasuring}>
                    {lMeasuring?<><i className="fa fa-spinner fa-spin"/> Capturing…</>:<><i className="fa fa-camera"/> Auto Capture{liveDetection&&lXPxAuto==='—'&&<span className="cm-dot-live"/>}</>}
                  </button>
                  <button className="cm-meas-btn" onClick={manualMeasureL} disabled={!(parseFloat(mLXPx)>0&&parseFloat(mLYPx)>0&&parseFloat(lRealDist1)>0)}>
                    <i className="fa fa-hand-pointer"/> Manual Measure
                  </button>
                </div>
              </div>
              <button className="cm-add-btn" onClick={addLEntry} disabled={!lCanAdd}><i className="fa fa-plus-circle"/> Add Calibration</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Helper display functions (avoid inline ternaries in JSX header)
const liveDetect_xPx = (ld: LiveDetection) => ld.xPx;
const liveDetect_yPx = (ld: LiveDetection) => ld.yPx;
const liveDetect_d1  = (ld: LiveDetection) => ld.d1Um;
const liveDetect_d2  = (ld: LiveDetection) => ld.d2Um;

export default CalibrationModal;