// pages/ReportsPage.tsx — Professional Industrial Hardness Tester Pro Reports
// @ts-ignore
import '../styles/global.css';
import '../styles/layout.css';
import './ReportsPage.css';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../hooks/useToast';
import MenuBar from './MenuBar';
import './MenuBar.css';

// ─────────────────────────────────────────────────────────────────
// Types & Data
// ─────────────────────────────────────────────────────────────────
interface Measurement {
  id:     number;
  hv:     number;
  scale:  string;
  d1_mm:  number;
  d2_mm:  number;
  load:   number;
  conf:   number;
  ts:     number;
  image?: string; // base64 snapshot with overlay lines
  note?:  string;
  material?: string;
  operator?: string;
}

const STORE_KEY      = 'htp_measurements';
const Store = {
  get: (): Measurement[] => {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
    catch { return []; }
  },
  set: (d: Measurement[]) => localStorage.setItem(STORE_KEY, JSON.stringify(d)),
  clear: () => localStorage.removeItem(STORE_KEY),
};

// ── Snapshot type from SQLite (matches snapshots table columns) ──
interface SnapRecord {
  id:           number;
  captured_at:  number;  // unix epoch seconds
  image_data:   string;  // base64 PNG
  d1_um:        string | null;
  d2_um:        string | null;
  d1_px:        number | null;
  d2_px:        number | null;
  pxmm:         number | null;
  operator:     string | null;
  material:     string | null;
  note:         string | null;
}

function hvTable(hv: number) {
  if (!hv || isNaN(hv)) return { HRC: '—', HRB: '—', HB: '—' };
  const HRC = hv >= 240 ? Math.max(0, -0.0006*hv*hv + 0.37*hv - 13.2).toFixed(1) : '—';
  const HRB = hv < 240 ? Math.min(100, 0.2917*hv - 5.833).toFixed(1) : '—';
  const HB  = (hv * 0.9608).toFixed(1);
  return { HRC, HRB, HB };
}

function getGrade(hv: number): { label: string; color: string } {
  if (hv >= 800) return { label: 'VERY HARD', color: '#ef4444' };
  if (hv >= 600) return { label: 'HARD', color: '#f97316' };
  if (hv >= 400) return { label: 'MEDIUM', color: '#f59e0b' };
  if (hv >= 200) return { label: 'MODERATE', color: '#22c55e' };
  return { label: 'SOFT', color: '#0ea5e9' };
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [data,        setData]        = useState<Measurement[]>([]);
  const [snapshots,   setSnapshots]   = useState<SnapRecord[]>([]);
  const [filter,      setFilter]      = useState('');
  const [sortKey,     setSortKey]     = useState<keyof Measurement>('ts');
  const [sortAsc,     setSortAsc]     = useState(false);
  const [activeTab,   setActiveTab]   = useState<'overview'|'table'|'gallery'>('overview');
  const [selectedId,    setSelectedId]    = useState<number|null>(null);
  const [selectedSnapId, setSelectedSnapId] = useState<number|null>(null);

  const trendRef  = useRef<HTMLCanvasElement>(null);
  const distRef   = useRef<HTMLCanvasElement>(null);
  const radialRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Load measurement stats from localStorage (or could be IPC too)
    setData(Store.get());
    // Load snapshots from SQLite via IPC
    const loadSnaps = async () => {
      try {
        const rows = await (window as any).api?.invoke('db:snapshots:getRecent', 20);
        if (Array.isArray(rows)) setSnapshots(rows);
      } catch (err) {
        console.error('[ReportsPage] loadSnaps error:', err);
      }
    };
    loadSnaps();
  }, []);

  // ── Derived stats ─────────────────────────────────────────────
  const hvs  = data.map(m => +m.hv).filter(v => !isNaN(v) && v > 0);
  const n    = hvs.length;
  const avg  = n ? hvs.reduce((a,b) => a+b, 0) / n : 0;
  const sorted = [...hvs].sort((a,b) => a-b);
  const med  = n ? (n%2 ? sorted[Math.floor(n/2)] : (sorted[n/2-1]+sorted[n/2])/2) : 0;
  const sd   = n > 1 ? Math.sqrt(hvs.map(v=>(v-avg)**2).reduce((a,b)=>a+b,0)/(n-1)) : 0;
  const mn   = n ? Math.min(...hvs) : 0;
  const mx   = n ? Math.max(...hvs) : 0;
  const cv   = avg > 0 ? (sd/avg)*100 : 0; // coefficient of variation

  const pass = hvs.filter(v => v >= 200 && v <= 900).length;
  const passRate = n ? (pass/n*100) : 0;

  // Recent trend (up/down)
  const recent5 = hvs.slice(-5);
  const trendUp = recent5.length > 1 && recent5[recent5.length-1] > recent5[0];

  // ── Filtered & sorted table data ─────────────────────────────
  const tableData = [...data]
    .filter(m => {
      if (!filter) return true;
      const q = filter.toLowerCase();
      return (
        String(m.hv).includes(q) ||
        (m.scale||'').toLowerCase().includes(q) ||
        (m.material||'').toLowerCase().includes(q) ||
        (m.operator||'').toLowerCase().includes(q) ||
        new Date(m.ts).toLocaleString().toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const va = a[sortKey] as any, vb = b[sortKey] as any;
      return sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });

  const toggleSort = (key: keyof Measurement) => {
    if (sortKey === key) setSortAsc(v => !v);
    else { setSortKey(key); setSortAsc(false); }
  };

  // ── Trend chart ───────────────────────────────────────────────
  const drawTrend = useCallback(() => {
    const canvas = trendRef.current; if (!canvas) return;
    const pts = data.slice(-60);
    const ctx = canvas.getContext('2d')!;
    const W = canvas.clientWidth || 600, H = canvas.clientHeight || 200;
    canvas.width = W * devicePixelRatio; canvas.height = H * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    if (!pts.length) {
      ctx.fillStyle = '#94a3b8'; ctx.font = '12px monospace';
      ctx.textAlign = 'center'; ctx.fillText('No measurement data yet', W/2, H/2);
      return;
    }

    const hvs2 = pts.map(m => +m.hv);
    const mn2 = Math.min(...hvs2), mx2 = Math.max(...hvs2) || mn2 + 10;
    // Add 5% padding to Y range so lines don't touch top/bottom
    const yPad = (mx2 - mn2) * 0.12 || 20;
    const yMin = mn2 - yPad, yMax = mx2 + yPad;

    const pad = { t: 24, r: 60, b: 36, l: 56 };
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    const xp = (i: number) => pad.l + (i / (hvs2.length-1||1)) * pw;
    const yp = (v: number) => pad.t + ph - ((v - yMin) / (yMax - yMin)) * ph;

    // Light grid lines
    ctx.strokeStyle = 'rgba(203,213,225,0.8)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    for (let i = 0; i <= 5; i++) {
      const y = pad.t + ph * (i/5);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
      const val = yMax - (yMax - yMin) * (i/5);
      ctx.fillStyle = '#64748b'; ctx.font = 'bold 9px Arial,sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(val.toFixed(0), pad.l - 6, y + 3);
    }
    // Vertical grid lines
    const xStep = Math.max(1, Math.floor(hvs2.length / 6));
    ctx.strokeStyle = 'rgba(203,213,225,0.5)';
    for (let i = 0; i < hvs2.length; i += xStep) {
      ctx.beginPath(); ctx.moveTo(xp(i), pad.t); ctx.lineTo(xp(i), pad.t + ph); ctx.stroke();
    }
    ctx.setLineDash([]);

    // X axis baseline
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t + ph); ctx.lineTo(W - pad.r, pad.t + ph); ctx.stroke();
    // Y axis line
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + ph); ctx.stroke();

    // X axis labels
    ctx.fillStyle = '#64748b'; ctx.font = '9px Arial,sans-serif'; ctx.textAlign = 'center';
    for (let i = 0; i < hvs2.length; i += xStep) {
      ctx.fillText(String(i+1), xp(i), H - pad.b + 14);
    }

    // Min/Max reference lines
    ctx.strokeStyle = 'rgba(239,68,68,0.4)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(pad.l, yp(mn2)); ctx.lineTo(W - pad.r, yp(mn2)); ctx.stroke();
    ctx.strokeStyle = 'rgba(16,185,129,0.4)';
    ctx.beginPath(); ctx.moveTo(pad.l, yp(mx2)); ctx.lineTo(W - pad.r, yp(mx2)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '8px Arial,sans-serif'; ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(239,68,68,0.7)';
    ctx.fillText(`min ${mn2.toFixed(0)}`, W - pad.r + 4, yp(mn2) + 3);
    ctx.fillStyle = 'rgba(16,185,129,0.7)';
    ctx.fillText(`max ${mx2.toFixed(0)}`, W - pad.r + 4, yp(mx2) + 3);

    // Average line
    const avg2 = hvs2.reduce((a,b)=>a+b,0)/hvs2.length;
    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(pad.l, yp(avg2)); ctx.lineTo(W - pad.r, yp(avg2)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#f59e0b'; ctx.font = 'bold 9px Arial,sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`avg ${avg2.toFixed(1)}`, W - pad.r + 4, yp(avg2) + 3);

    // Gradient fill under line
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ph);
    grad.addColorStop(0, 'rgba(14,165,233,0.18)');
    grad.addColorStop(1, 'rgba(14,165,233,0.01)');
    ctx.beginPath(); ctx.moveTo(xp(0), yp(hvs2[0]));
    for (let i = 1; i < hvs2.length; i++) ctx.lineTo(xp(i), yp(hvs2[i]));
    ctx.lineTo(xp(hvs2.length-1), pad.t + ph);
    ctx.lineTo(pad.l, pad.t + ph); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // Main HV trend line
    ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(xp(0), yp(hvs2[0]));
    for (let i = 1; i < hvs2.length; i++) ctx.lineTo(xp(i), yp(hvs2[i]));
    ctx.stroke();

    // Data point dots — show value labels on hover by drawing all near max/min
    hvs2.forEach((v, i) => {
      const isSelected = data.slice(-60)[i]?.id === selectedId;
      const isExtreme  = v === mn2 || v === mx2;
      const r = isSelected ? 6 : isExtreme ? 5 : 3.5;

      ctx.beginPath(); ctx.arc(xp(i), yp(v), r, 0, Math.PI*2);
      ctx.fillStyle = isSelected ? '#f59e0b' : isExtreme ? (v === mx2 ? '#10b981' : '#ef4444') : '#0ea5e9';
      ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
      ctx.stroke();

      // Label extreme values
      if (isExtreme || isSelected) {
        ctx.fillStyle = isSelected ? '#f59e0b' : (v === mx2 ? '#10b981' : '#ef4444');
        ctx.font = 'bold 8px Arial,sans-serif'; ctx.textAlign = 'center';
        const labelY = yp(v) + (v === mn2 ? 14 : -8);
        ctx.fillText(v.toFixed(0), xp(i), labelY);
      }
    });

    // Axis labels
    ctx.fillStyle = '#94a3b8'; ctx.font = '9px Arial,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Measurement #', W/2, H - 2);
    ctx.save(); ctx.translate(12, H/2); ctx.rotate(-Math.PI/2);
    ctx.fillText('HV', 0, 0); ctx.restore();
  }, [data, selectedId]);

  // ── Distribution chart ────────────────────────────────────────
  const drawDist = useCallback(() => {
    const canvas = distRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.clientWidth || 300, H = canvas.clientHeight || 200;
    canvas.width = W * devicePixelRatio; canvas.height = H * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    if (hvs.length < 2) {
      ctx.fillStyle = '#94a3b8'; ctx.font = '11px Arial,sans-serif';
      ctx.textAlign = 'center'; ctx.fillText('Need ≥2 measurements', W/2, H/2); return;
    }

    const B = 10, range = mx - mn || 1, step = range / B;
    const counts = Array(B).fill(0);
    hvs.forEach(v => { const b = Math.min(B-1, Math.floor((v - mn) / step)); counts[b]++; });
    const maxC = Math.max(...counts) || 1;

    const pad = { t: 16, r: 16, b: 32, l: 36 };
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    const barW = pw / B;

    ctx.strokeStyle = 'rgba(203,213,225,0.8)'; ctx.lineWidth = 1; ctx.setLineDash([3,2]);
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ph * (i/4);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = '#64748b'; ctx.font = '8px Arial,sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(maxC * (1 - i/4))), pad.l - 4, y + 3);
    }

    counts.forEach((c, i) => {
      const x = pad.l + i * barW;
      const bh = (c / maxC) * ph;
      const y = pad.t + ph - bh;
      const grad = ctx.createLinearGradient(0, y, 0, y + bh);
      grad.addColorStop(0, '#0ea5e9');
      grad.addColorStop(1, 'rgba(14,165,233,0.3)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x + 2, y, barW - 4, bh, [3, 3, 0, 0]);
      ctx.fill();

      if (c > 0) {
        ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
        ctx.fillText(String(c), x + barW/2, y - 3);
      }

      ctx.fillStyle = '#94a3b8'; ctx.font = '7px Arial,sans-serif'; ctx.textAlign = 'center';
      ctx.fillText((mn + i * step).toFixed(0), x + barW/2, H - pad.b + 12);
    });

    ctx.fillStyle = '#94a3b8'; ctx.font = '9px Arial,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('HV Range', W/2, H - 2);
  }, [hvs, mn, mx]);

  // ── Gauge / radial chart ──────────────────────────────────────
  const drawRadial = useCallback(() => {
    const canvas = radialRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const S = Math.min(canvas.clientWidth, canvas.clientHeight) || 180;
    canvas.width = S * devicePixelRatio; canvas.height = S * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, S, S);

    const cx = S/2, cy = S/2, r = S * 0.38, sw = S * 0.08;
    const startA = Math.PI * 0.75, endA = Math.PI * 2.25;
    const totalA = endA - startA;

    // Background arc
    ctx.beginPath(); ctx.arc(cx, cy, r, startA, endA);
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = sw; ctx.lineCap = 'round';
    ctx.stroke();

    if (n > 0) {
      const pct = Math.min(1, avg / 1000);
      const endVal = startA + totalA * pct;
      const grade = getGrade(avg);

      const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
      grad.addColorStop(0, '#0ea5e9');
      grad.addColorStop(0.5, '#10b981');
      grad.addColorStop(1, grade.color);

      ctx.beginPath(); ctx.arc(cx, cy, r, startA, endVal);
      ctx.strokeStyle = grad; ctx.lineWidth = sw; ctx.lineCap = 'round';
      ctx.stroke();

      // Tick marks
      for (let i = 0; i <= 10; i++) {
        const a = startA + totalA * (i/10);
        const ir = r - sw/2 - 4, or = r + sw/2 + 4;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a)*ir, cy + Math.sin(a)*ir);
        ctx.lineTo(cx + Math.cos(a)*or, cy + Math.sin(a)*or);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.lineCap = 'butt';
        ctx.stroke();
      }

      // Center text
      ctx.fillStyle = '#1e293b'; ctx.font = `bold ${S*0.14}px Arial,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(avg.toFixed(0), cx, cy - S*0.04);
      ctx.fillStyle = '#64748b'; ctx.font = `${S*0.07}px Arial,sans-serif`;
      ctx.fillText('HV avg', cx, cy + S*0.1);
      ctx.fillStyle = grade.color; ctx.font = `bold ${S*0.07}px monospace`;
      ctx.fillText(grade.label, cx, cy + S*0.2);
    } else {
      ctx.fillStyle = '#94a3b8'; ctx.font = `${S*0.08}px Arial,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('—', cx, cy);
    }
  }, [n, avg]);

  useEffect(() => { drawTrend(); }, [drawTrend]);
  useEffect(() => { drawDist();  }, [drawDist]);
  useEffect(() => { drawRadial();}, [drawRadial]);

  // ── Actions ───────────────────────────────────────────────────
  const delRow = (id: number) => {
    const updated = Store.get().filter(m => m.id !== id);
    Store.set(updated); setData(updated);
    if (selectedId === id) setSelectedId(null);
    toast('Record deleted', 'info');
  };

  const clearAll = () => {
    if (!data.length) { toast('No data', 'warn'); return; }
    if (!confirm('Delete ALL measurements? This cannot be undone.')) return;
    Store.clear(); setData([]); setSelectedId(null);
    toast('All records cleared', 'warn');
  };

  const exportExcel = () => {
    if (!data.length) { toast('No data to export', 'warn'); return; }
    // Build a multi-sheet workbook using SheetJS (xlsx library)
    // Dynamically import to keep bundle size manageable
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    script.onload = () => {
      const XLS = (window as any).XLSX;

      // ── Sheet 1: Summary ─────────────────────────────────
      const hvVals = data.map(m => +m.hv).filter(v => !isNaN(v) && v > 0);
      const cnt  = hvVals.length;
      const mean = cnt ? hvVals.reduce((a,b)=>a+b,0)/cnt : 0;
      const srt  = [...hvVals].sort((a,b)=>a-b);
      const mdn  = cnt ? (cnt%2 ? srt[Math.floor(cnt/2)] : (srt[cnt/2-1]+srt[cnt/2])/2) : 0;
      const std  = cnt > 1 ? Math.sqrt(hvVals.map(v=>(v-mean)**2).reduce((a,b)=>a+b,0)/(cnt-1)) : 0;
      const vMin = cnt ? Math.min(...hvVals) : 0;
      const vMax = cnt ? Math.max(...hvVals) : 0;
      const cvPct = mean > 0 ? (std/mean*100) : 0;
      const passR = cnt ? (hvVals.filter(v=>v>=200&&v<=900).length/cnt*100) : 0;

      const summaryData = [
        ['HARDNESS TESTER PRO — TEST REPORT'],
        [`Generated: ${new Date().toLocaleString()}  |  Measurements: ${cnt}`],
        [],
        ['STATISTICAL SUMMARY'],
        ['Parameter', 'Value', 'Unit'],
        ['Total Tests',        cnt,                ''],
        ['Arithmetic Mean',    +mean.toFixed(2),   'HV'],
        ['Median',             +mdn.toFixed(2),    'HV'],
        ['Std Deviation',      +std.toFixed(2),    'HV ±'],
        ['Variance',           +(std*std).toFixed(2), 'HV²'],
        ['CV (Consistency)',   +cvPct.toFixed(2),  '%'],
        ['Minimum',            +vMin.toFixed(2),   'HV'],
        ['Maximum',            +vMax.toFixed(2),   'HV'],
        ['Range',              +(vMax-vMin).toFixed(2), 'HV'],
        ['Pass Rate (200–900)',+passR.toFixed(1),  '%'],
        ['HRC Equivalent',     vMax >= 240 ? +(-0.0006*mean*mean+0.37*mean-13.2).toFixed(1) : '—', ''],
        ['HB Equivalent',      +(mean*0.9608).toFixed(1), ''],
        ['UTS Equivalent',     +(mean*3.3).toFixed(0), 'MPa'],
      ];
      const ws1 = XLS.utils.aoa_to_sheet(summaryData);
      ws1['!cols'] = [{wch:24},{wch:14},{wch:10}];

      // ── Sheet 2: Measurements ──────────────────────────────
      const measHeaders = [
        '#','Date/Time','HV','Scale','D1 mm','D2 mm','Load kgf',
        'HRC','HRB','HB','UTS MPa','Conf %','Material','Operator','Grade'
      ];
      const measRows = data.map((m, i) => {
        const hv = +m.hv;
        const hrc = hv >= 240 ? +(-0.0006*hv*hv+0.37*hv-13.2).toFixed(1) : '—';
        const hrb = hv < 240  ? +(0.2917*hv-5.833).toFixed(1) : '—';
        const hb  = +(hv*0.9608).toFixed(1);
        const grade = hv<200?'SOFT':hv<400?'MODERATE':hv<600?'MEDIUM':hv<800?'HARD':'VERY HARD';
        return [
          i+1,
          new Date(m.ts).toLocaleString(),
          hv,
          m.scale||'HV10',
          m.d1_mm!=null ? +m.d1_mm : '',
          m.d2_mm!=null ? +m.d2_mm : '',
          m.load||'',
          hrc, hrb, hb,
          +(hv*3.3).toFixed(0),
          m.conf ? +(+m.conf*100).toFixed(0) : '',
          m.material||'',
          m.operator||'',
          grade,
        ];
      });
      const ws2 = XLS.utils.aoa_to_sheet([measHeaders, ...measRows]);
      ws2['!cols'] = [
        {wch:5},{wch:18},{wch:8},{wch:7},{wch:10},{wch:10},
        {wch:9},{wch:7},{wch:7},{wch:8},{wch:9},{wch:7},
        {wch:14},{wch:12},{wch:11}
      ];
      ws2['!autofilter'] = { ref: `A1:O${data.length+1}` };

      // ── Sheet 3: HV Conversion Reference ─────────────────
      const convHeaders = ['HV','HRC','HRB','HB','UTS MPa','Grade','Application'];
      const convRows = [
        [100,'—','53','96',330,'SOFT','Aluminum, soft copper'],
        [150,'—','78',144,495,'SOFT','Annealed steel, brass'],
        [200,13,'95',192,660,'MODERATE','Mild steel'],
        [250,22,'99',240,825,'MODERATE','Normalized carbon steel'],
        [300,30,'—',285,990,'MEDIUM','Heat treated alloy steel'],
        [350,35,'—',335,1155,'MEDIUM','High carbon steel'],
        [400,40,'—',380,1320,'MEDIUM','Hardened tool steel'],
        [450,45,'—',430,1485,'MEDIUM','Die steel, spring steel'],
        [500,49,'—',475,1650,'HARD','HSS tools'],
        [550,52,'—',525,1815,'HARD','Drill bits, cutting tools'],
        [600,55,'—',570,1980,'HARD','Cold work tool steel'],
        [700,60,'—',665,2310,'VERY HARD','Carbide-tipped tools'],
        [800,64,'—',760,2640,'VERY HARD','Ceramic coatings'],
        [900,67,'—',855,2970,'VERY HARD','CVD/PVD coatings'],
      ];
      const ws3 = XLS.utils.aoa_to_sheet([convHeaders, ...convRows]);
      ws3['!cols'] = [{wch:7},{wch:7},{wch:7},{wch:7},{wch:10},{wch:12},{wch:30}];

      // ── Workbook ───────────────────────────────────────────
      const wb2 = XLS.utils.book_new();
      XLS.utils.book_append_sheet(wb2, ws1, 'Summary');
      XLS.utils.book_append_sheet(wb2, ws2, 'Measurements');
      XLS.utils.book_append_sheet(wb2, ws3, 'HV Conversion');

      const filename = `HTP_Report_${new Date().toISOString().slice(0,10)}.xlsx`;
      XLS.writeFile(wb2, filename);
      toast('Excel report exported ✓', 'success');
    };
    script.onerror = () => toast('Failed to load Excel library', 'error');
    document.head.appendChild(script);
  };

  const printReport = () => window.print();

  // ── Selected record ───────────────────────────────────────────
  const selectedRecord = data.find(m => m.id === selectedId);

  // ── NAV ───────────────────────────────────────────────────────
  const NAV = [
    { sec: 'Main', items: [
      { label: 'Dashboard',   icon: 'fa-solid fa-gauge-high',        path: '/' },
      { label: 'Measurement', icon: 'fa-solid fa-crosshairs',        path: '/measurement' },
      { label: 'Live Camera', icon: 'fa-solid fa-video',             path: '/live' },
    ]},
    { sec: 'Analysis', items: [
      { label: 'Reports',     icon: 'fa-solid fa-chart-line',        path: '/reports', active: true },
      { label: 'History',     icon: 'fa-solid fa-clock-rotate-left', path: '/history' },
      { label: 'HV Converter',icon: 'fa-solid fa-arrows-rotate',     path: '/converter' },
    ]},
    { sec: 'System', items: [
      { label: 'Calibration', icon: 'fa-solid fa-ruler-combined',    path: '/calibration' },
      { label: 'Settings',    icon: 'fa-solid fa-gear',              path: '/settings' },
      { label: 'Help',        icon: 'fa-solid fa-circle-question',   path: '/help' },
    ]},
  ];

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="rpt-root">
      <style>{`
        .rpt-root { display:flex !important; flex-direction:column !important; height:100vh; overflow:hidden; background:#ffffff; }
        .rpt-body { flex:1; overflow:hidden; display:flex; }
        .menubar  { flex-shrink:0; width:100%; }
        .menubar-dropdown { position:fixed !important; z-index:99999 !important; }
        .menubar { background:#1e3a5f !important; }
        .menubar-btn { color:#e2e8f0 !important; }
        .menubar-btn:hover, .menubar-item.open .menubar-btn { background:#0ea5e9 !important; color:#fff !important; }
        .menubar-dropdown { background:#1e3a5f !important; border-color:#2d4a6b !important; }
        .menubar-dd-item { color:#cbd5e1 !important; }
        .menubar-dd-item:hover:not(:disabled) { background:#0ea5e9 !important; color:#fff !important; }
        .menubar-sep { background:#2d4a6b !important; }
      `}</style>

      {/* TITLE BAR */}
      <div className="rpt-tb">
        <div className="rpt-tb-brand">
          <div className="rpt-tb-logo"><i className="fa-solid fa-diamond"/></div>
          <span className="rpt-tb-title">Hardness <span>Tester</span> Pro</span>
        </div>
        <div className="rpt-tb-clock">{new Date().toTimeString().slice(0,8)}</div>
        <div className="rpt-tb-ctrls">
          <button onClick={() => (window as any).api?.minimize()}><i className="fa fa-minus"/></button>
          <button onClick={() => (window as any).api?.maximize()}><i className="fa fa-square"/></button>
          <button className="tb-x" onClick={() => (window as any).api?.close()}><i className="fa fa-xmark"/></button>
        </div>
      </div>

      {/* MENU BAR */}
      <MenuBar
        onCalibration={() => navigate('/calibration')}
        onOpenCamera={() => navigate('/live')}
        onAutoMeasure={() => navigate('/measurement')}
      />

      {/* BODY */}
      <div className="rpt-body">

        {/* SIDEBAR */}
        <nav className="rpt-sidebar">
          <div className="rpt-sb-brand">
            <div className="rpt-sb-ico"><i className="fa-solid fa-diamond"/></div>
            <div>
              <div className="rpt-sb-nm">HT <span>Pro</span></div>
              <div className="rpt-sb-ver">v1.0.0</div>
            </div>
          </div>
          {NAV.map(g => (
            <div key={g.sec}>
              <div className="rpt-sb-sec">{g.sec}</div>
              {g.items.map(item => (
                <div key={item.path}
                  className={`rpt-nav-item${(item as any).active ? ' active' : ''}`}
                  onClick={() => navigate(item.path)}>
                  <i className={item.icon}/>{item.label}
                </div>
              ))}
            </div>
          ))}
        </nav>

        {/* MAIN */}
        <div className="rpt-main">

          {/* HEADER */}
          <div className="rpt-hdr">
            <div>
              <div className="page-title">Test <span>Report</span></div>
              <div className="page-sub">// Statistics · Trend · Distribution · Export</div>
            </div>
            <div className="rpt-hdr-actions">
              <button className="rpt-exp-btn excel" onClick={exportExcel}><i className="fa-solid fa-file-excel"/> Export Excel</button>
              <button className="rpt-exp-btn pdf" onClick={printReport}><i className="fa-solid fa-print"/> Print / PDF</button>
              <button className="rpt-exp-btn danger" onClick={clearAll}><i className="fa fa-trash"/> Clear All</button>
            </div>
          </div>

          {/* TABS */}
          <div className="rpt-tabs">
            {(['overview','table','gallery'] as const).map(tab => (
              <button key={tab}
                className={`rpt-tab${activeTab === tab ? ' active' : ''}`}
                onClick={() => setActiveTab(tab)}>
                <i className={`fa fa-${tab === 'overview' ? 'chart-line' : tab === 'table' ? 'table' : 'images'}`}/>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {tab === 'table' && <span className="rpt-tab-badge">{n}</span>}
                {tab === 'gallery' && <span className="rpt-tab-badge">{snapshots.length}</span>}
              </button>
            ))}
          </div>

          <div className="rpt-scroll">

            {/* ── OVERVIEW TAB ── */}
            {activeTab === 'overview' && (
              <div className="rpt-overview">

                {/* KPI CARDS */}
                <div className="rpt-kpi-row">
                  {[
                    { label: 'Total Tests',   val: n || '—',              unit: 'measurements', icon: 'fa-hashtag',     color: '#0ea5e9' },
                    { label: 'Mean HV',       val: n ? avg.toFixed(1):'—',unit: 'HV average',   icon: 'fa-chart-line',  color: '#f59e0b' },
                    { label: 'Std Deviation', val: n>1?sd.toFixed(1):'—', unit: '± σ',          icon: 'fa-wave-square', color: '#8b5cf6' },
                    { label: 'Range',         val: n?(mx-mn).toFixed(0):'—',unit:'HV spread',   icon: 'fa-arrows-left-right', color: '#10b981' },
                    { label: 'Pass Rate',     val: n?passRate.toFixed(0)+'%':'—', unit:'200–900 HV', icon:'fa-circle-check', color: passRate >= 80 ? '#10b981' : '#ef4444' },
                    { label: 'CV',            val: n?cv.toFixed(1)+'%':'—',unit:'consistency',  icon: 'fa-percent',     color: cv < 5 ? '#10b981' : cv < 10 ? '#f59e0b' : '#ef4444' },
                  ].map(({ label, val, unit, icon, color }) => (
                    <div key={label} className="rpt-kpi">
                      <div className="rpt-kpi-icon" style={{ color }}><i className={`fa-solid ${icon}`}/></div>
                      <div className="rpt-kpi-val" style={{ color }}>{val}</div>
                      <div className="rpt-kpi-unit">{unit}</div>
                      <div className="rpt-kpi-label">{label}</div>
                    </div>
                  ))}
                </div>

                {/* CHARTS ROW */}
                <div className="rpt-charts-row">

                  {/* Trend chart */}
                  <div className="rpt-card rpt-card-trend">
                    <div className="rpt-card-hdr">
                      <span className="rpt-card-title">
                        <i className="fa fa-chart-line" style={{color:'#0ea5e9'}}/>
                        Hardness Trend
                      </span>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        {n > 1 && (
                          <span className={`rpt-trend-badge ${trendUp ? 'up' : 'down'}`}>
                            <i className={`fa fa-arrow-${trendUp ? 'up' : 'down'}`}/>
                            {trendUp ? 'Rising' : 'Falling'}
                          </span>
                        )}
                        <span className="rpt-badge">{Math.min(n, 60)} pts</span>
                      </div>
                    </div>
                    <div className="rpt-chart-box">
                      <canvas ref={trendRef} style={{width:'100%',height:'100%',display:'block'}}/>
                    </div>
                    <div className="rpt-chart-legend">
                      <span className="rpt-legend-item"><span className="rpt-legend-dot" style={{background:'#0ea5e9'}}/> HV value</span>
                      <span className="rpt-legend-item"><span className="rpt-legend-dash" style={{background:'#f59e0b'}}/> Average</span>
                      {selectedRecord && <span className="rpt-legend-item"><span className="rpt-legend-dot" style={{background:'#f59e0b'}}/> Selected #{selectedId}</span>}
                    </div>
                  </div>

                  {/* Right column: radial + distribution */}
                  <div className="rpt-charts-right">

                    {/* Radial gauge */}
                    <div className="rpt-card rpt-card-radial">
                      <div className="rpt-card-hdr">
                        <span className="rpt-card-title">
                          <i className="fa fa-gauge-high" style={{color:'#f59e0b'}}/>
                          Average Grade
                        </span>
                      </div>
                      <div className="rpt-radial-wrap">
                        <canvas ref={radialRef} style={{width:'100%',height:'100%',display:'block'}}/>
                      </div>
                      <div className="rpt-grade-row">
                        {[200,400,600,800].map(v => (
                          <div key={v} className={`rpt-grade-chip ${avg >= v ? 'active' : ''}`}>{v}+</div>
                        ))}
                      </div>
                    </div>

                    {/* Distribution */}
                    <div className="rpt-card rpt-card-dist">
                      <div className="rpt-card-hdr">
                        <span className="rpt-card-title">
                          <i className="fa fa-chart-bar" style={{color:'#8b5cf6'}}/>
                          Distribution
                        </span>
                      </div>
                      <div className="rpt-chart-box rpt-chart-box-dist">
                        <canvas ref={distRef} style={{width:'100%',height:'100%',display:'block'}}/>
                      </div>
                    </div>

                  </div>
                </div>

                {/* SUMMARY STATS TABLE */}
                {n > 0 && (
                  <div className="rpt-card rpt-card-stats">
                    <div className="rpt-card-hdr">
                      <span className="rpt-card-title">
                        <i className="fa fa-square-root-variable" style={{color:'#10b981'}}/>
                        Statistical Summary
                      </span>
                      <span className="rpt-badge">{n} measurements</span>
                    </div>
                    <div className="rpt-stats-grid">
                      {[
                        ['Count',      n,                     '',    '#0ea5e9'],
                        ['Mean',       avg.toFixed(2),        'HV',  '#f59e0b'],
                        ['Median',     med.toFixed(2),        'HV',  '#0ea5e9'],
                        ['Std Dev',    sd.toFixed(2),         '±HV', '#8b5cf6'],
                        ['Min',        mn.toFixed(2),         'HV',  '#22c55e'],
                        ['Max',        mx.toFixed(2),         'HV',  '#ef4444'],
                        ['Range',      (mx-mn).toFixed(2),    'HV',  '#10b981'],
                        ['CV',         cv.toFixed(2),         '%',   cv < 5 ? '#10b981' : '#f59e0b'],
                        ['HRC equiv',  hvTable(avg).HRC,      '',    '#94a3b8'],
                        ['HB equiv',   hvTable(avg).HB,       '',    '#94a3b8'],
                        ['UTS equiv',  (+avg * 3.3).toFixed(0),'MPa','#94a3b8'],
                        ['Pass Rate',  passRate.toFixed(1),   '%',   passRate >= 80 ? '#10b981' : '#ef4444'],
                      ].map(([k, v, u, c]) => (
                        <div key={k as string} className="rpt-stat-cell">
                          <div className="rpt-stat-key">{k}</div>
                          <div className="rpt-stat-val" style={{color: c as string}}>
                            {v}<span className="rpt-stat-unit">{u}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            )}

            {/* ── TABLE TAB ── */}
            {activeTab === 'table' && (
              <div className="rpt-table-wrap">
                <div className="rpt-table-toolbar">
                  <div className="rpt-search-wrap">
                    <i className="fa fa-magnifying-glass"/>
                    <input
                      className="rpt-search"
                      placeholder="Search HV, scale, material, operator…"
                      value={filter}
                      onChange={e => setFilter(e.target.value)}
                    />
                    {filter && <button className="rpt-search-clear" onClick={() => setFilter('')}><i className="fa fa-xmark"/></button>}
                  </div>
                  <span className="rpt-result-count">{tableData.length} records</span>
                </div>

                <div className="rpt-table-scroll">
                  <table className="rpt-tbl">
                    <thead>
                      <tr>
                        {[
                          ['#', 'id'], ['HV', 'hv'], ['Scale', 'scale'],
                          ['D1 mm', 'd1_mm'], ['D2 mm', 'd2_mm'], ['Load', 'load'],
                          ['HRC', null], ['HB', null], ['UTS MPa', null],
                          ['Conf %', 'conf'], ['Material', 'material'], ['Date', 'ts'], ['', null]
                        ].map(([label, key]) => (
                          <th key={label as string}
                            className={key ? 'sortable' : ''}
                            onClick={() => key && toggleSort(key as keyof Measurement)}>
                            {label}
                            {key && sortKey === key && (
                              <i className={`fa fa-caret-${sortAsc ? 'up' : 'down'}`} style={{marginLeft:4}}/>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {!tableData.length && (
                        <tr><td colSpan={13} className="rpt-empty">
                          <i className="fa fa-chart-line" style={{fontSize:28,display:'block',marginBottom:10,opacity:.3}}/>
                          {filter ? 'No results match your search' : 'No measurements yet — go to Live Camera to begin testing'}
                        </td></tr>
                      )}
                      {tableData.map((m, i) => {
                        const hv = +m.hv; const t = hvTable(hv);
                        const grade = getGrade(hv);
                        const isSelected = m.id === selectedId;
                        return (
                          <tr key={m.ts}
                            className={isSelected ? 'selected' : ''}
                            onClick={() => setSelectedId(isSelected ? null : m.id)}>
                            <td className="rpt-td-num">{tableData.length - i}</td>
                            <td className="rpt-td-hv">
                              <span className="rpt-hv-val">{hv.toFixed(1)}</span>
                              <span className="rpt-hv-grade" style={{color: grade.color}}>{grade.label}</span>
                            </td>
                            <td><span className="rpt-badge-sm">{m.scale||'HV10'}</span></td>
                            <td className="rpt-td-mono">{m.d1_mm != null ? (+m.d1_mm).toFixed(4) : '—'}</td>
                            <td className="rpt-td-mono">{m.d2_mm != null ? (+m.d2_mm).toFixed(4) : '—'}</td>
                            <td className="rpt-td-mono">{m.load||'—'}</td>
                            <td className="rpt-td-mono">{t.HRC}</td>
                            <td className="rpt-td-mono">{t.HB}</td>
                            <td className="rpt-td-mono">{(hv*3.3).toFixed(0)}</td>
                            <td className="rpt-td-mono">{m.conf ? (+m.conf*100).toFixed(0)+'%' : '—'}</td>
                            <td className="rpt-td-text">{m.material||'—'}</td>
                            <td className="rpt-td-date">{new Date(m.ts).toLocaleString()}</td>
                            <td>
                              <button className="rpt-del-btn" onClick={e => { e.stopPropagation(); delRow(m.id); }} title="Delete">
                                <i className="fa fa-times"/>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Selected record detail panel */}
                {selectedRecord && (
                  <div className="rpt-detail-panel">
                    <div className="rpt-detail-hdr">
                      <span><i className="fa fa-circle-info" style={{color:'#0ea5e9',marginRight:6}}/>Record #{selectedRecord.id} Detail</span>
                      <button className="rpt-detail-close" onClick={() => setSelectedId(null)}><i className="fa fa-xmark"/></button>
                    </div>
                    <div className="rpt-detail-body">
                      {selectedRecord.image && (
                        <div className="rpt-detail-img-wrap">
                          <img src={selectedRecord.image} alt="Indentation" className="rpt-detail-img"/>
                          <div className="rpt-detail-img-label">Indentation Image</div>
                        </div>
                      )}
                      <div className="rpt-detail-stats">
                        {[
                          ['HV', selectedRecord.hv.toFixed(2)],
                          ['Scale', selectedRecord.scale||'HV10'],
                          ['D1', selectedRecord.d1_mm != null ? (+selectedRecord.d1_mm).toFixed(4)+' mm' : '—'],
                          ['D2', selectedRecord.d2_mm != null ? (+selectedRecord.d2_mm).toFixed(4)+' mm' : '—'],
                          ['Load', (selectedRecord.load||'—')+' kgf'],
                          ['Confidence', selectedRecord.conf ? (+selectedRecord.conf*100).toFixed(0)+'%' : '—'],
                          ['HRC', hvTable(+selectedRecord.hv).HRC],
                          ['HB',  hvTable(+selectedRecord.hv).HB],
                          ['UTS', (+selectedRecord.hv*3.3).toFixed(0)+' MPa'],
                          ['Material', selectedRecord.material||'—'],
                          ['Operator', selectedRecord.operator||'—'],
                          ['Date', new Date(selectedRecord.ts).toLocaleString()],
                        ].map(([k, v]) => (
                          <div key={k} className="rpt-detail-row">
                            <span className="rpt-detail-key">{k}</span>
                            <span className="rpt-detail-val">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── GALLERY TAB ── */}
            {activeTab === 'gallery' && (
              <div className="rpt-gallery">

                {/* Gallery header with count + clear */}
                {snapshots.length > 0 && (
                  <div className="rpt-gallery-toolbar">
                    <span className="rpt-gallery-toolbar-title">
                      <i className="fa fa-camera" style={{color:'#0ea5e9'}}/>
                      Snapshots from Live Camera
                      <span className="rpt-snap-count">{snapshots.length} / 20</span>
                    </span>
                    <button className="rpt-snap-clear-btn" onClick={async () => {
                      if (!confirm('Clear all saved snapshots?')) return;
                      try {
                        await (window as any).api?.invoke('db:snapshots:clear');
                      } catch (err) {
                        console.error('[ReportsPage] clear error:', err);
                      }
                      setSnapshots([]);
                      setSelectedSnapId(null);
                      toast('Snapshots cleared', 'info');
                    }}>
                      <i className="fa fa-trash"/> Clear All
                    </button>
                  </div>
                )}

                {snapshots.length === 0 ? (
                  <div className="rpt-gallery-empty">
                    <i className="fa fa-camera"/>
                    <p>No snapshots saved yet</p>
                    <span>Go to Live Camera → click the <b>Snapshot</b> button while the camera is running. Images will appear here automatically.</span>
                  </div>
                ) : (
                  <div className="rpt-gallery-grid">
                    {snapshots.map(snap => {
                      const isSelected = snap.id === selectedSnapId;
                      return (
                        <div key={snap.id}
                          className={`rpt-gallery-cell${isSelected ? ' selected' : ''}`}
                          onClick={() => setSelectedSnapId(isSelected ? null : snap.id)}>
                          <div className="rpt-gallery-img-wrap">
                            <img src={snap.image_data} alt={`Snapshot ${snap.id}`} className="rpt-gallery-img"/>
                            <div className="rpt-gallery-overlay">
                              <span className="rpt-gallery-time">
                                {new Date(snap.captured_at * 1000).toLocaleTimeString()}
                              </span>
                            </div>
                          </div>
                          <div className="rpt-gallery-footer">
                            <div className="rpt-gallery-meta">
                              <span className="rpt-gallery-scale">
                                <i className="fa fa-ruler" style={{marginRight:3,fontSize:8}}/>
                                {snap.d1_um || '—'}
                              </span>
                              <span className="rpt-gallery-date">
                                {new Date(snap.captured_at * 1000).toLocaleDateString()}
                              </span>
                            </div>
                            <div className="rpt-gallery-dims">
                              <span>D1: {snap.d1_um||'—'}</span>
                              <span>D2: {snap.d2_um||'—'}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Selected snapshot detail panel */}
                {selectedSnapId && (() => {
                  const snap: SnapRecord | undefined = snapshots.find(s => s.id === selectedSnapId);
                  if (!snap) return null;
                  return (
                    <div className="rpt-gallery-detail">
                      <div className="rpt-detail-hdr">
                        <span>
                          <i className="fa fa-image" style={{color:'#0ea5e9',marginRight:6}}/>
                          Snapshot — {new Date(snap.captured_at * 1000).toLocaleString()}
                        </span>
                        <div style={{display:'flex',gap:8}}>
                          <button className="rpt-exp-btn excel" style={{padding:'4px 10px',fontSize:11}}
                            onClick={() => {
                              const a = document.createElement('a');
                              a.href = snap.image_data;
                              a.download = `snapshot_${snap.id}.png`;
                              a.click();
                            }}>
                            <i className="fa fa-download"/> Save Image
                          </button>
                          <button className="rpt-exp-btn danger" style={{padding:'4px 10px',fontSize:11}}
                            onClick={async () => {
                              if (!confirm('Delete this snapshot from database?')) return;
                              try {
                                await (window as any).api?.invoke('db:snapshots:delete', snap.id);
                              } catch (err) {
                                console.error('[ReportsPage] delete snap error:', err);
                              }
                              setSnapshots(prev => prev.filter(s => s.id !== snap.id));
                              setSelectedSnapId(null);
                              toast('Snapshot deleted', 'info');
                            }}>
                            <i className="fa fa-trash"/> Delete
                          </button>
                          <button className="rpt-detail-close" onClick={() => setSelectedSnapId(null)}>
                            <i className="fa fa-xmark"/>
                          </button>
                        </div>
                      </div>
                      <div className="rpt-gallery-detail-body">
                        <img src={snap.image_data} alt="Snapshot" className="rpt-gallery-detail-img"/>
                        <div className="rpt-gallery-detail-stats">
                          {[
                            ['Captured',    new Date(snap.captured_at * 1000).toLocaleString(), '#374151'],
                            ['D1',          snap.d1_um  || '—',                          '#0ea5e9'],
                            ['D2',          snap.d2_um  || '—',                          '#0ea5e9'],
                            ['Scale px/mm', String(snap.pxmm || '—'),                   '#6b7280'],
                            ['Material',    snap.material  || '—',                       '#6b7280'],
                            ['Operator',    snap.operator  || '—',                       '#6b7280'],
                            ['Note',        snap.note      || '—',                       '#6b7280'],
                          ].map(([k,v,c]) => (
                            <div key={k as string} className="rpt-detail-row">
                              <span className="rpt-detail-key">{k}</span>
                              <span className="rpt-detail-val" style={{color: c as string}}>{v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

          </div>{/* rpt-scroll */}
        </div>{/* rpt-main */}
      </div>{/* rpt-body */}
    </div>
  );
}