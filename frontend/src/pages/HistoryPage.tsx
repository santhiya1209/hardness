// pages/HistoryPage.tsx
import '../styles/global.css';
import '../styles/layout.css';
import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/common/Layout';
import { Store, hvTable } from '../utils/shared';
import { useToast } from '../hooks/useToast';
import './HistoryPage.css';

interface Measurement {
  hv: number;
  scale: string;
  d1_mm: number;
  d2_mm: number;
  load: number;
  conf: number;
  ts: number;
}

type SortMode = 'ts-desc'|'ts-asc'|'hv-desc'|'hv-asc'|'conf-desc';

const SORT_LABELS: {mode:SortMode;label:string}[] = [
  {mode:'ts-desc',   label:'Newest first'},
  {mode:'ts-asc',    label:'Oldest first'},
  {mode:'hv-desc',   label:'HV high → low'},
  {mode:'hv-asc',    label:'HV low → high'},
  {mode:'conf-desc', label:'Confidence'},
];

export default function HistoryPage() {
  const { toasts, toast } = useToast();
  const [allData, setAllData]   = useState<Measurement[]>([]);
  const [filtered, setFiltered] = useState<Measurement[]>([]);
  const [search, setSearch]     = useState('');
  const [scaleF, setScaleF]     = useState('');
  const [resultF, setResultF]   = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('ts-desc');
  const specMin = parseFloat(localStorage.getItem('spec_min') || '0');
  const specMax = parseFloat(localStorage.getItem('spec_max') || '9999');
  const hvMax   = allData.length ? Math.max(...allData.map(m => +m.hv)) : 1;

  const loadAll = useCallback(() => {
    const data = Store.get();
    setAllData(data);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    let f = allData.filter(m => {
      if (search) {
        const hay = [m.hv, m.scale, new Date(m.ts).toLocaleString(), m.d1_mm, m.d2_mm].join(' ').toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      if (scaleF && m.scale !== scaleF) return false;
      if (resultF) {
        const pass = +m.hv >= specMin && +m.hv <= specMax;
        if (resultF === 'pass' && !pass) return false;
        if (resultF === 'fail' && pass) return false;
      }
      return true;
    });
    f.sort((a, b) => {
      if (sortMode === 'ts-desc')   return b.ts - a.ts;
      if (sortMode === 'ts-asc')    return a.ts - b.ts;
      if (sortMode === 'hv-desc')   return (+b.hv) - (+a.hv);
      if (sortMode === 'hv-asc')    return (+a.hv) - (+b.hv);
      if (sortMode === 'conf-desc') return (+b.conf||0) - (+a.conf||0);
      return 0;
    });
    setFiltered(f);
  }, [allData, search, scaleF, resultF, sortMode, specMin, specMax]);

  const stats = () => {
    const hvs = allData.map(m => +m.hv).filter(v => !isNaN(v));
    if (!hvs.length) return { avg:'—', med:'—', range:'—', pass:0 };
    const avg  = hvs.reduce((a,b)=>a+b,0)/hvs.length;
    const s    = [...hvs].sort((a,b)=>a-b);
    const med  = hvs.length%2 ? s[Math.floor(hvs.length/2)] : (s[hvs.length/2-1]+s[hvs.length/2])/2;
    const pass = hvs.filter(hv=>hv>=specMin&&hv<=specMax).length;
    return { avg:avg.toFixed(1), med:med.toFixed(1), range:`${Math.min(...hvs).toFixed(0)} / ${Math.max(...hvs).toFixed(0)}`, pass };
  };
  const s = stats();

  const del = (ts: number) => {
    Store.set(allData.filter(m=>m.ts!==ts));
    loadAll(); toast('Record deleted','info');
  };
  const clearAll = () => {
    if (!confirm('Delete ALL measurement history?')) return;
    Store.clear(); loadAll(); toast('History cleared','warn');
  };
  const exportCSV = async () => {
    if (!allData.length) { toast('No data to export','warn'); return; }
    const hdr = 'N,HV,Scale,D1_mm,D2_mm,Load_kgf,HRC,HRB,HB,UTS_MPa,Confidence,Timestamp\n';
    const rows = allData.map((m,i) => {
      const t = hvTable(+m.hv);
      return [i+1,m.hv,m.scale||'HV10',m.d1_mm||'',m.d2_mm||'',m.load||'',t.HRC,t.HRB,t.HB,(+m.hv*3.3).toFixed(0),m.conf?(+m.conf*100).toFixed(0)+'%':'',new Date(m.ts).toISOString()].join(',');
    }).join('\n');
    const r = await window.api?.saveReport({ name:`history_${new Date().toISOString().slice(0,10)}.csv`, data:hdr+rows });
    if (r?.saved) toast('CSV exported','success');
    else if (r && !r.saved) toast('Cancelled','info');
  };

  return (
    <Layout toasts={toasts}>
      <div className="page-header">
        <div>
          <div className="page-title">Measurement <span>History</span></div>
          <div className="page-sub">// Full log · Search · Filter · Export</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost btn-sm" onClick={exportCSV}><i className="fa fa-file-csv" /> Export CSV</button>
          <button className="btn btn-danger btn-sm" onClick={clearAll}><i className="fa fa-trash" /> Clear All</button>
        </div>
      </div>

      <div className="hist-content">
        {/* Gauge strip */}
        <div className="summary-strip fade-up">
          {[
            {label:'Total records', val:allData.length,  cls:'bright'},
            {label:'Mean HV',       val:s.avg,           cls:''},
            {label:'Median HV',     val:s.med,           cls:'muted'},
            {label:'Min / Max HV',  val:s.range,         cls:'muted', small:true},
            {label:'Pass count',    val:s.pass,          cls:'bright'},
            {label:'Showing',       val:filtered.length, cls:'muted'},
          ].map(({label,val,cls,small}) => (
            <div key={label} className="gauge-cell">
              <div className="gauge-label">{label}</div>
              <div className={`gauge-val ${cls}${small?' small':''}`}>{val}</div>
              <div className="gauge-unit">{label.includes('Pass')?'within spec':label.includes('Total')?'tests':label.includes('Showing')?'filtered':''}</div>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div className="control-panel fade-up" style={{animationDelay:'.04s'}}>
          <div className="cp-header">
            <div className="cp-led" /><span className="cp-header-title">Search &amp; filter controls</span>
          </div>
          <div className="cp-body">
            <div className="ind-search">
              <i className="fa fa-magnifying-glass" />
              <input type="text" placeholder="Search HV, scale, date, diagonal..." value={search} onChange={e=>setSearch(e.target.value)} />
            </div>
            <select className="ind-select" value={scaleF} onChange={e=>setScaleF(e.target.value)}>
              <option value="">All scales</option>
              {['HV0.1','HV0.3','HV0.5','HV1','HV5','HV10','HV30','HV50','HV100'].map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            <select className="ind-select" value={resultF} onChange={e=>setResultF(e.target.value)}>
              <option value="">All results</option>
              <option value="pass">Pass only</option>
              <option value="fail">Fail only</option>
            </select>
            <button className="btn btn-ghost btn-sm" onClick={()=>{setSearch('');setScaleF('');setResultF('');setSortMode('ts-desc');}}>
              <i className="fa fa-xmark" /> Reset
            </button>
          </div>
          <div className="cp-sort-row">
            <span className="sort-label">Sort</span>
            {SORT_LABELS.map(({mode,label}) => (
              <div key={mode} className={`sort-chip${sortMode===mode?' active':''}`} onClick={()=>setSortMode(mode)}>{label}</div>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="tbl-card fade-up" style={{animationDelay:'.08s'}}>
          <div className="tbl-card-header">
            <div className="tbl-card-title"><i className="fa fa-table-cells-large" /> Measurement data log</div>
            <div className="tbl-card-count">{filtered.length} record{filtered.length!==1?'s':''}</div>
          </div>
          <div className="tbl-scroll">
            {filtered.length === 0 ? (
              <div className="tbl-empty">
                <div className="tbl-empty-icon"><i className="fa fa-database" /></div>
                <div className="tbl-empty-title">No records found</div>
                <div className="tbl-empty-sub">Go to Measurement page to begin testing</div>
              </div>
            ) : (
              <table className="ind-tbl">
                <thead>
                  <tr>
                    <th>#</th><th>HV</th><th>Scale</th><th>D1 mm</th><th>D2 mm</th>
                    <th>Load kgf</th><th>HRC</th><th>HRB</th><th>HB</th>
                    <th>UTS MPa</th><th>Conf %</th><th>Result</th><th>Date / Time</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((m, i) => {
                    const hv   = +m.hv;
                    const pass = hv >= specMin && hv <= specMax;
                    const t    = hvTable(hv);
                    const barW = Math.max(4, Math.round((hv/hvMax)*56));
                    const confPct = m.conf ? Math.round(+m.conf*100) : null;
                    const confCls = confPct ? (confPct>=80?'conf-hi':confPct>=60?'conf-med':'conf-lo') : '';
                    const hasSpec = specMin > 0 || specMax < 9999;
                    return (
                      <tr key={m.ts}>
                        <td className="td-idx">{filtered.length-i}</td>
                        <td className="td-hv">
                          <div className="hv-bar-wrap">
                            <div className="hv-bar" style={{width:barW}} />
                            {hv.toFixed(1)}
                          </div>
                        </td>
                        <td><span className="scale-badge">{m.scale||'HV10'}</span></td>
                        <td className="td-diag">{m.d1_mm!=null?(+m.d1_mm).toFixed(4):'—'}</td>
                        <td className="td-diag">{m.d2_mm!=null?(+m.d2_mm).toFixed(4):'—'}</td>
                        <td className="td-diag">{m.load||'—'}</td>
                        <td className="td-conv">{t.HRC}</td>
                        <td className="td-conv">{t.HRB}</td>
                        <td className="td-conv">{t.HB}</td>
                        <td className="td-conv">{(hv*3.3).toFixed(0)}</td>
                        <td className="td-conf">{confPct?<span className={confCls}>{confPct}%</span>:'—'}</td>
                        <td>
                          {hasSpec
                            ? <span className={`res-badge ${pass?'pass':'fail'}`}>{pass?'PASS':'FAIL'}</span>
                            : <span className="res-badge ok">OK</span>
                          }
                        </td>
                        <td className="td-time">{new Date(m.ts).toLocaleString()}</td>
                        <td className="td-del"><button className="del-btn" onClick={()=>del(m.ts)}><i className="fa fa-times" /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
