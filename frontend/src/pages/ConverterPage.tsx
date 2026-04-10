// pages/ConverterPage.tsx
import '../styles/global.css';
import '../styles/layout.css';
import { useState, useEffect } from 'react';
import Layout from '../components/common/Layout';
import { useToast } from '../hooks/useToast';
import { Store, hvToHRC, hvToHRB } from '../utils/shared';
import './ConverterPage.css';

type Scale = 'HV'|'HK'|'HBW'|'HRA'|'HRB'|'HRC'|'HRD'|'HR15N'|'HR30N'|'HR45N'|'HR15T'|'HR30T'|'HR45T';

const SCALE_GROUPS = [
  { title:'Vickers / Knoop / Brinell', scales:['HV','HK','HBW'] as Scale[] },
  { title:'Rockwell standard',         scales:['HRA','HRB','HRC','HRD'] as Scale[] },
  { title:'Rockwell superficial N',    scales:['HR15N','HR30N','HR45N'] as Scale[] },
  { title:'Rockwell superficial T',    scales:['HR15T','HR30T','HR45T'] as Scale[] },
];

const REF_DATA = [
  { mat:'Tool steel',       band:'hard',   hv:940, hrc:68,  hrb:'—', hb:617, uts:2874 },
  { mat:'High-speed steel', band:'hard',   hv:800, hrc:64,  hrb:'—', hb:560, uts:2640 },
  { mat:'Carburised steel', band:'hard',   hv:700, hrc:60,  hrb:'—', hb:515, uts:2310 },
  { mat:'Hardened alloy',   band:'hard',   hv:600, hrc:57,  hrb:'—', hb:481, uts:1980 },
  { mat:'Alloy steel',      band:'medium', hv:500, hrc:48,  hrb:'—', hb:471, uts:1650 },
  { mat:'Medium hard steel',band:'medium', hv:400, hrc:41,  hrb:'—', hb:380, uts:1320 },
  { mat:'Structural steel', band:'medium', hv:300, hrc:29,  hrb:105, hb:286, uts:990  },
  { mat:'Low carbon steel', band:'soft',   hv:200, hrc:13,  hrb:93,  hb:190, uts:660  },
  { mat:'Soft iron',        band:'soft',   hv:120, hrc:'—', hrb:68,  hb:114, uts:396  },
  { mat:'Aluminium alloy',  band:'soft',   hv:90,  hrc:'—', hrb:48,  hb:86,  uts:297  },
  { mat:'Soft copper',      band:'soft',   hv:50,  hrc:'—', hrb:20,  hb:48,  uts:165  },
];

const BAND_COLOR: Record<string,string> = {
  hard: 'var(--red)', medium: 'var(--amber)', soft: 'var(--green)',
};

function toHV(raw: number, scale: Scale): number {
  switch (scale) {
    case 'HV':    return raw;
    case 'HK':    return raw / 1.05;
    case 'HBW':   return raw / 0.95;
    case 'HRA':   return raw * 10.5;
    case 'HRB':   return (raw + 5.833) / 0.2917;
    case 'HRC':   return (raw + 13.2) / 0.37;
    case 'HRD':   return raw * 7.5;
    case 'HR15N': return raw * 11.5;
    case 'HR30N': return raw * 10.2;
    case 'HR45N': return raw * 9.4;
    case 'HR15T': return raw * 4.5;
    case 'HR30T': return raw * 4.0;
    case 'HR45T': return raw * 3.6;
    default:      return raw;
  }
}

export default function ConverterPage() {
  const { toasts } = useToast();
  const [inputVal, setInputVal] = useState('');
  const [activeScale, setActiveScale] = useState<Scale>('HV');
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    const raw = parseFloat(inputVal);
    if (isNaN(raw) || raw <= 0) { setRows([]); return; }
    const hv = toHV(raw, activeScale);
    if (!hv || hv <= 0) { setRows([]); return; }
    const hrcVal = hvToHRC(hv);
    const hrbVal = hvToHRB(hv);
    setRows([
      { scale:'HV  — Vickers',       val: hv.toFixed(1),                         cls:'',      note:'Direct (ISO 6507)' },
      { scale:'HK  — Knoop',         val: (hv*1.05).toFixed(1),                  cls:'',      note:'Microhardness' },
      { scale:'HBW — Brinell',       val: (hv*0.95).toFixed(1),                  cls:'amber', note:'ASTM E140' },
      { scale:'HRA — Rockwell A',    val: hv>400?(100-5480/(hv+186)).toFixed(1):'—', cls:'', note:'Diamond, 60 kgf' },
      { scale:'HRB — Rockwell B',    val: hrbVal?hrbVal.toFixed(1):'—',          cls:hrbVal?'green':'muted', note:'Ball, 100 kgf' },
      { scale:'HRC — Rockwell C',    val: hrcVal?hrcVal.toFixed(1):'—',          cls:hrcVal?'amber':'muted', note:'Diamond, 150 kgf' },
      { scale:'HRD — Rockwell D',    val: (hv/7.5).toFixed(1),                   cls:'',      note:'Diamond, 100 kgf' },
      { scale:'HR15N — Superficial', val: (hv/11.5).toFixed(1),                  cls:'',      note:'15 kgf load' },
      { scale:'HR30N — Superficial', val: (hv/10.2).toFixed(1),                  cls:'',      note:'30 kgf load' },
      { scale:'HR45N — Superficial', val: (hv/9.4).toFixed(1),                   cls:'',      note:'45 kgf load' },
      { scale:'HR15T — Superficial', val: (hv/4.5).toFixed(1),                   cls:'',      note:'Ball 15 kgf' },
      { scale:'HR30T — Superficial', val: (hv/4.0).toFixed(1),                   cls:'',      note:'Ball 30 kgf' },
      { scale:'HR45T — Superficial', val: (hv/3.6).toFixed(1),                   cls:'',      note:'Ball 45 kgf' },
      { scale:'UTS — Steel (MPa)',   val: (hv*3.3).toFixed(0),                   cls:'green', note:'Approx ~3.3 × HV' },
    ]);
  }, [inputVal, activeScale]);

  useEffect(() => {
    const last = Store.get().slice(-1)[0];
    if (last?.hv) setInputVal((+last.hv).toFixed(1));
  }, []);

  return (
    <Layout toasts={toasts}>
      <div className="page-header">
        <div>
          <div className="page-title">HV <span>Converter</span></div>
          <div className="page-sub">// Bidirectional hardness scale conversion · ASTM E140</div>
        </div>
      </div>

      <div className="conv-content">
        <div className="converter-grid">

          {/* LEFT */}
          <div className="input-panel fade-up">
            {/* Big input */}
            <div className="value-card">
              <div className="value-card-label">Enter hardness value</div>
              <div className="value-input-row">
                <input className="big-input" type="number" placeholder="250"
                  value={inputVal} onChange={e => setInputVal(e.target.value)} />
                <span className="big-unit">{activeScale}</span>
              </div>
              <div className="value-hint">Type a value and select the scale below</div>
            </div>

            {/* Scale selector */}
            <div className="scale-card">
              <div className="scale-card-label">Input scale</div>
              {SCALE_GROUPS.map(group => (
                <div key={group.title} className="scale-group">
                  <div className="scale-group-title">{group.title}</div>
                  <div className="scale-pills">
                    {group.scales.map(sc => (
                      <div key={sc} className={`scale-pill${activeScale===sc?' active':''}`} onClick={() => setActiveScale(sc)}>
                        {sc}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Results table */}
            <div className="results-card">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Scale</th>
                    <th style={{textAlign:'right'}}>Value</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="empty-state">
                        <i className="fa fa-arrows-rotate" style={{fontSize:24,display:'block',marginBottom:8,opacity:.25}} />
                        Enter a value above to see conversions
                      </td>
                    </tr>
                  ) : rows.map((r, i) => {
                    const isActive = r.scale.startsWith(activeScale.split(' ')[0]);
                    return (
                      <tr key={i} style={isActive?{background:'var(--sky-pale)'}:{}}>
                        <td className="scale-name">{r.scale}</td>
                        <td className={`scale-val ${r.cls}`}>{r.val}</td>
                        <td className="scale-note">{r.note}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* RIGHT — Reference table */}
          <div className="ref-section fade-up" style={{animationDelay:'.05s'}}>
            <div className="card" style={{padding:0,overflow:'hidden'}}>
              <div className="card-header" style={{padding:'14px 18px 12px',borderBottom:'1px solid var(--grey-100)'}}>
                <span className="card-title"><i className="fa fa-table" style={{color:'var(--sky)'}} /> Reference Conversion Table</span>
                <span className="badge badge-cyan">ASTM E140</span>
              </div>
              <div style={{overflowX:'auto'}}>
                <table className="ref-tbl">
                  <thead>
                    <tr>
                      <th>Material / Grade</th>
                      <th>HV</th><th>HRC</th><th>HRB</th><th>HB</th><th>UTS MPa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {REF_DATA.map((r, i) => (
                      <tr key={i} style={i%2!==0?{background:'var(--grey-50)'}:{}}>
                        <td>
                          <span style={{display:'inline-block',width:8,height:8,borderRadius:'50%',background:BAND_COLOR[r.band],marginRight:8,verticalAlign:'middle'}} />
                          {r.mat}
                        </td>
                        <td className="hl">{r.hv}</td>
                        <td className="hrc">{r.hrc}</td>
                        <td className="hrb">{String(r.hrb)}</td>
                        <td>{r.hb}</td>
                        <td className="uts">{r.uts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card" style={{marginTop:14,padding:'14px 18px'}}>
              <div className="card-header" style={{padding:'0 0 10px',borderBottom:'1px solid var(--grey-100)',marginBottom:12}}>
                <span className="card-title"><i className="fa fa-circle-info" style={{color:'var(--sky)'}} /> Column colour legend</span>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
                {[
                  ['var(--sky-deep)', 'HV — Vickers hardness'],
                  ['var(--amber)',    'HRC — Rockwell C scale'],
                  ['var(--green)',    'HRB — Rockwell B scale'],
                ].map(([color, label]) => (
                  <div key={label} style={{display:'flex',alignItems:'center',gap:8,fontFamily:'Share Tech Mono,monospace',fontSize:10,color:'var(--grey-600)'}}>
                    <div style={{width:10,height:10,borderRadius:2,background:color,flexShrink:0}} />
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
