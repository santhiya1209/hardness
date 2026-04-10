// pages/SettingsPage.tsx
import '../styles/global.css';
import '../styles/layout.css';
import './SettingsPage.css';
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { cam } from '../components/camera/CameraShell';
import { Calibration } from '../utils/shared';
import { useToast } from '../hooks/useToast';
import MenuBar from './MenuBar';
import './MenuBar.css';

// ─────────────────────────────────────────────────────────────
// Types & constants
// ─────────────────────────────────────────────────────────────
interface Device { model: string; serial: string; index: number; type: string; }

const DET_METHODS = [
  { value: 'ellipse', label: 'Ellipse fitting — Vickers (recommended)' },
  { value: 'contour', label: 'Contour fitting — accurate' },
  { value: 'hough',   label: 'HoughCircles — fast' },
  { value: 'manual',  label: 'Manual entry only' },
];
const STANDARDS  = ['ISO 6507', 'ASTM E92', 'JIS Z 2244', 'EN ISO 6507'];
const RESOLUTIONS = ['1280×1024', '2048×1536', '2592×1944', '4096×3072'];
const LOADS       = ['0.1', '1', '5', '10', '30', '50'];

// ─────────────────────────────────────────────────────────────
// Slider component
// ─────────────────────────────────────────────────────────────
function SliderRow({
  label, value, min, max, step, unit,
  onChange, decimals = 0,
}: {
  label: string; value: number; min: number; max: number;
  step: number; unit: string; onChange: (v: number) => void; decimals?: number;
}) {
  const pct     = ((value - min) / (max - min) * 100).toFixed(1);
  const display = decimals > 0 ? value.toFixed(decimals) : String(value);
  return (
    <div className="st-slider-row">
      <div className="st-slider-meta">
        <span className="st-slider-label">{label}</span>
        <span className="st-slider-val">{display}<span className="st-slider-unit">{unit}</span></span>
      </div>
      <input
        type="range" className="st-range"
        min={min} max={max} step={step} value={value}
        style={{ '--pct': pct + '%' } as any}
        onChange={e => onChange(+e.target.value)}
      />
      <div className="st-range-ticks">
        <span>{min}</span><span>{((min + max) / 2).toFixed(0)}</span><span>{max}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Section header component
// ─────────────────────────────────────────────────────────────
function SectionHdr({
  icon, title, sub, status, onAction, actionLabel, actionIcon, actionDisabled,
}: {
  icon: string; title: string; sub?: string; status?: 'online' | 'offline' | 'idle';
  onAction?: () => void; actionLabel?: string; actionIcon?: string; actionDisabled?: boolean;
}) {
  return (
    <div className="st-sec-hdr">
      <div className="st-sec-hdr-left">
        <div className={`st-sec-icon${status === 'online' ? ' online' : status === 'offline' ? ' offline' : ''}`}>
          <i className={`fa-solid ${icon}`}/>
        </div>
        <div>
          <div className="st-sec-title">{title}</div>
          {sub && <div className="st-sec-sub">{sub}</div>}
        </div>
        {status && (
          <div className={`st-status-pill ${status}`}>
            <span className="st-status-dot"/>
            {status === 'online' ? 'ONLINE' : status === 'offline' ? 'OFFLINE' : 'IDLE'}
          </div>
        )}
      </div>
      {onAction && (
        <button className="st-action-btn" onClick={onAction} disabled={actionDisabled}>
          {actionIcon && <i className={`fa-solid ${actionIcon}`}/>}
          {actionLabel}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  // ── Camera state ──────────────────────────────────────────
  const [camRes,    setCamRes]    = useState('1280×1024');
  const [exposure,  setExposure]  = useState(10000);
  const [gainDb,    setGainDb]    = useState(0);
  const [devices,   setDevices]   = useState<Device[]>([]);
  const [camStatus, setCamStatus] = useState('Checking camera…');
  const [camOnline, setCamOnline] = useState(false);
  const [scanning,  setScanning]  = useState(false);

  // ── Detection state ───────────────────────────────────────
  const [detMethod, setDetMethod] = useState('ellipse');
  const [clahe,     setClahe]     = useState(2.0);
  const [blur,      setBlur]      = useState(7);
  const [p2,        setP2]        = useState(25);
  const [minR,      setMinR]      = useState(5);

  // ── Acceptance / sample state ─────────────────────────────
  const [specMin,   setSpecMin]   = useState('');
  const [specMax,   setSpecMax]   = useState('');
  const [defLoad,   setDefLoad]   = useState('10');
  const [material,  setMaterial]  = useState('');
  const [operator,  setOperator]  = useState('');
  const [standard,  setStandard]  = useState('ISO 6507');

  // ── System info ───────────────────────────────────────────
  const [sysRows,   setSysRows]   = useState<[string, string][]>([['Status', 'Loading…']]);
  const [activeTab,     setActiveTab]     = useState<'camera'|'detection'|'acceptance'|'system'>('camera');
  const [dbStatus,      setDbStatus]      = useState<'idle'|'testing'|'ok'|'error'>('idle');
  const [dbTestLog,     setDbTestLog]     = useState<{msg:string;ok:boolean}[]>([]);

  // ── Load saved settings (SQLite first, localStorage fallback) ──
  useEffect(() => {
    const load = async () => {
      try {
        // Try SQLite first (most up-to-date)
        const api = (window as any).api;
        if (api?.invoke) {
          const s  = await api.invoke('db:settings:get', 'camera_settings');
          const sp = await api.invoke('db:settings:get', 'spec_settings');
          if (s) {
            if (s.exposure_us)    setExposure(s.exposure_us);
            if (s.gain_db != null) setGainDb(s.gain_db);
            if (s.resolution)     setCamRes(s.resolution);
            if (s.det_method)     setDetMethod(s.det_method);
            if (s.clahe)          setClahe(s.clahe);
            if (s.blur)           setBlur(s.blur);
            if (s.p2)             setP2(s.p2);
            if (s.minr)           setMinR(s.minr);
          }
          if (sp) {
            if (sp.min)      setSpecMin(String(sp.min));
            if (sp.max)      setSpecMax(String(sp.max));
            if (sp.material) setMaterial(sp.material);
            if (sp.operator) setOperator(sp.operator);
            if (sp.standard) setStandard(sp.standard);
            if (sp.load)     setDefLoad(sp.load);
          }
          if (s || sp) return; // loaded from SQLite — done
        }
      } catch (err) {
        console.warn('[SettingsPage] SQLite load failed, using localStorage:', err);
      }

      // Fallback: localStorage
      try {
        const s = JSON.parse(localStorage.getItem('ht_settings') || '{}');
        if (s.exposure_us)     setExposure(s.exposure_us);
        if (s.gain_db != null) setGainDb(s.gain_db);
        if (s.resolution)      setCamRes(s.resolution);
        if (s.det_method)      setDetMethod(s.det_method);
        if (s.clahe)           setClahe(s.clahe);
        if (s.blur)            setBlur(s.blur);
        if (s.p2)              setP2(s.p2);
        if (s.minr)            setMinR(s.minr);
        const sp = JSON.parse(localStorage.getItem('ht_spec') || '{}');
        if (sp.min)      setSpecMin(String(sp.min));
        if (sp.max)      setSpecMax(String(sp.max));
        if (sp.material) setMaterial(sp.material);
        if (sp.operator) setOperator(sp.operator);
        if (sp.standard) setStandard(sp.standard);
        if (sp.load)     setDefLoad(sp.load);
      } catch {}
    };
    load();
  }, []);

  // ── Scan devices ──────────────────────────────────────────
  const doRefreshDevices = useCallback(async () => {
    setScanning(true); setDevices([]);
    setCamStatus('Scanning for cameras…'); setCamOnline(false);
    try {
      const r = await cam.get('/devices');
      if (!r?.ok) throw new Error('offline');
      if (!r.data?.devices?.length) {
        setCamStatus('No cameras found — check USB / GigE cable'); return;
      }
      setDevices(r.data.devices);
      setCamOnline(true);
      setCamStatus(`${r.data.devices.length} camera${r.data.devices.length > 1 ? 's' : ''} detected`);
    } catch {
      setCamStatus('Camera server not responding');
    } finally { setScanning(false); }
  }, []);

  // ── Load system info ──────────────────────────────────────
  const doLoadSysInfo = useCallback(async () => {
    setSysRows([['Status', 'Loading…']]);
    try {
      const r = await cam.get('/status');
      if (!r?.ok) throw new Error('offline');
      const d = r.data, c = Calibration.get();
      setSysRows([
        ['SDK',        d.sdk ? 'Loaded ✓'   : 'ERROR'],
        ['Camera',     d.device?.model       || '—'],
        ['Serial',     d.device?.serial      || '—'],
        ['Interface',  d.device?.type        || '—'],
        ['Exposure',   d.params?.exposure_us ? d.params.exposure_us + ' µs' : '—'],
        ['Gain',       d.params?.gain_db != null ? (+d.params.gain_db).toFixed(1) + ' dB' : '—'],
        ['Resolution', d.params?.width ? d.params.width + '×' + d.params.height : '—'],
        ['Grabbing',   d.grabbing ? 'Yes ✓'  : 'No'],
        ['HV Offset',  d.offset != null ? (+d.offset).toFixed(2) + ' HV' : '—'],
        ['px / mm',    c.px_per_mm ? String(c.px_per_mm) : '—'],
        ['Backend',    'localhost:3000'],
        ['App ver',    'v1.0.0'],
      ]);
    } catch {
      setSysRows([['Status', 'Server offline']]);
    }
  }, []);

  useEffect(() => { doRefreshDevices(); doLoadSysInfo(); }, [doRefreshDevices, doLoadSysInfo]);

  // ── DB Test ───────────────────────────────────────────────
  const runDbTest = async () => {
    setDbStatus('testing');
    setDbTestLog([]);
    const log = (msg: string, ok: boolean) =>
      setDbTestLog(prev => [...prev, { msg, ok }]);

    const api = (window as any).api;
    if (!api?.invoke) {
      log('window.api.invoke not found — preload not loaded', false);
      setDbStatus('error'); return;
    }
    log('window.api.invoke found ✓', true);

    // Test 1: write a setting
    try {
      await api.invoke('db:settings:set', '_db_test', { ts: Date.now(), ok: true });
      log('db:settings:set → wrote _db_test ✓', true);
    } catch (e: any) {
      log('db:settings:set FAILED: ' + e.message, false);
      setDbStatus('error'); return;
    }

    // Test 2: read it back
    try {
      const val = await api.invoke('db:settings:get', '_db_test');
      if (val?.ok === true) log('db:settings:get → read back correctly ✓', true);
      else { log('db:settings:get returned unexpected value: ' + JSON.stringify(val), false); setDbStatus('error'); return; }
    } catch (e: any) {
      log('db:settings:get FAILED: ' + e.message, false);
      setDbStatus('error'); return;
    }

    // Test 3: getAll
    try {
      const all = await api.invoke('db:settings:getAll');
      log(`db:settings:getAll → ${Object.keys(all).length} keys found ✓`, true);
    } catch (e: any) {
      log('db:settings:getAll FAILED: ' + e.message, false);
    }

    // Test 4: measurements stats
    try {
      const stats = await api.invoke('db:measurements:stats');
      log(`db:measurements:stats → total=${stats.total} ✓`, true);
    } catch (e: any) {
      log('db:measurements:stats FAILED: ' + e.message, false);
    }

    // Test 5: snapshots count
    try {
      const snaps = await api.invoke('db:snapshots:getAll');
      log(`db:snapshots:getAll → ${snaps.length} snapshots in DB ✓`, true);
    } catch (e: any) {
      log('db:snapshots:getAll FAILED: ' + e.message, false);
    }

    log('All tests passed — SQLite is working correctly ✓', true);
    setDbStatus('ok');
  };

  // ── Save — writes to BOTH localStorage and SQLite ────────
  const doSaveAll = async () => {
    const camSettings  = { exposure_us: exposure, gain_db: gainDb, resolution: camRes, det_method: detMethod, clahe, blur, p2, minr: minR };
    const specSettings = { min: +specMin || 0, max: +specMax || 9999, material, operator, standard, load: defLoad };

    // 1. Save to localStorage (instant, works offline)
    localStorage.setItem('ht_settings', JSON.stringify(camSettings));
    localStorage.setItem('ht_spec',     JSON.stringify(specSettings));
    localStorage.setItem('spec_min',    String(specSettings.min));
    localStorage.setItem('spec_max',    String(specSettings.max));
    localStorage.setItem('si-mat',      material);
    localStorage.setItem('si-op',       operator);
    localStorage.setItem('si-std',      standard);

    // 2. Save to SQLite via IPC (persistent across reinstalls)
    try {
      const api = (window as any).api;
      if (api?.invoke) {
        await api.invoke('db:settings:set', 'camera_settings',  camSettings);
        await api.invoke('db:settings:set', 'spec_settings',    specSettings);
        await api.invoke('db:settings:set', 'app_version',      'v1.0.0');
        await api.invoke('db:settings:set', 'last_saved',       new Date().toISOString());
      }
    } catch (err) {
      console.warn('[SettingsPage] SQLite save failed (falling back to localStorage):', err);
    }

    toast('Settings saved ✓', 'success');
  };

  // ── Apply to camera ───────────────────────────────────────
  const doApplyCam = async () => {
    const [w, h] = camRes.replace('×', 'x').split('x').map(Number);
    const r = await cam.post('/settings', {
      exposure_us: exposure, gain_db: gainDb,
      det_method: detMethod, clahe, blur, p2, minr: minR,
      width: w, height: h,
    }).catch(() => null);
    if (r?.ok && r.data?.success) toast('Applied to camera ✓', 'success');
    else toast('Could not apply — camera offline?', 'warn');
  };

  // ── NAV ───────────────────────────────────────────────────
  const NAV = [
    { sec: 'Main', items: [
      { label: 'Dashboard',   icon: 'fa-solid fa-gauge-high',        path: '/' },
      { label: 'Measurement', icon: 'fa-solid fa-crosshairs',        path: '/measurement' },
      { label: 'Live Camera', icon: 'fa-solid fa-video',             path: '/live' },
    ]},
    { sec: 'Analysis', items: [
      { label: 'Reports',     icon: 'fa-solid fa-chart-line',        path: '/reports' },
      { label: 'History',     icon: 'fa-solid fa-clock-rotate-left', path: '/history' },
      { label: 'HV Converter',icon: 'fa-solid fa-arrows-rotate',     path: '/converter' },
    ]},
    { sec: 'System', items: [
      { label: 'Calibration', icon: 'fa-solid fa-ruler-combined',    path: '/calibration' },
      { label: 'Settings',    icon: 'fa-solid fa-gear',              path: '/settings', active: true },
      { label: 'Help',        icon: 'fa-solid fa-circle-question',   path: '/help' },
    ]},
  ];

  const TABS = [
    { id: 'camera',     icon: 'fa-camera',        label: 'Camera' },
    { id: 'detection',  icon: 'fa-eye',            label: 'Detection' },
    { id: 'acceptance', icon: 'fa-circle-check',   label: 'Acceptance' },
    { id: 'system',     icon: 'fa-server',         label: 'System Info' },
  ] as const;

  // ─────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────
  return (
    <div className="st-root">
      <style>{`
        .st-root { display:flex !important; flex-direction:column !important; height:100vh; overflow:hidden; background:#f1f5f9; }
        .st-body  { flex:1; overflow:hidden; display:flex; }
        .menubar  { flex-shrink:0; width:100%; }
        .menubar-dropdown { position:fixed !important; z-index:99999 !important; }
      `}</style>

      {/* TITLE BAR */}
      <div className="st-tb">
        <div className="st-tb-brand">
          <div className="st-tb-logo"><i className="fa-solid fa-diamond"/></div>
          <span className="st-tb-title">Hardness <span>Tester</span> Pro</span>
        </div>
        <div className="st-tb-clock">{new Date().toTimeString().slice(0, 8)}</div>
        <div className="st-tb-ctrls">
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
        onCameraSetting={doApplyCam}
        onSerialPortSetting={() => setActiveTab('system')}
      />

      {/* BODY */}
      <div className="st-body">

        {/* SIDEBAR */}
        <nav className="st-sidebar">
          <div className="st-sb-brand">
            <div className="st-sb-ico"><i className="fa-solid fa-diamond"/></div>
            <div>
              <div className="st-sb-nm">HT <span>Pro</span></div>
              <div className="st-sb-ver">v1.0.0</div>
            </div>
          </div>
          {NAV.map(g => (
            <div key={g.sec}>
              <div className="st-sb-sec">{g.sec}</div>
              {g.items.map(item => (
                <div key={item.path}
                  className={`st-nav-item${(item as any).active ? ' active' : ''}`}
                  onClick={() => navigate(item.path)}>
                  <i className={item.icon}/>{item.label}
                </div>
              ))}
            </div>
          ))}
        </nav>

        {/* MAIN */}
        <div className="st-main">

          {/* PAGE HEADER */}
          <div className="st-hdr">
            <div>
              <div className="page-title">System <span>Settings</span></div>
              <div className="page-sub">// Camera · Detection · Acceptance · System info</div>
            </div>
            <button className="st-save-btn" onClick={doSaveAll}>
              <i className="fa-solid fa-floppy-disk"/> Save All Settings
            </button>
          </div>

          {/* TABS */}
          <div className="st-tabs">
            {TABS.map(tab => (
              <button
                key={tab.id}
                className={`st-tab${activeTab === tab.id ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.id)}>
                <i className={`fa-solid ${tab.icon}`}/>
                {tab.label}
                {tab.id === 'camera' && camOnline && (
                  <span className="st-tab-dot online"/>
                )}
                {tab.id === 'camera' && !camOnline && scanning && (
                  <span className="st-tab-dot scanning"/>
                )}
              </button>
            ))}
          </div>

          {/* CONTENT */}
          <div className="st-scroll">

            {/* ── CAMERA TAB ── */}
            {activeTab === 'camera' && (
              <div className="st-grid">

                {/* Device status */}
                <div className="st-card st-card-full">
                  <SectionHdr
                    icon="fa-camera" title="Camera Device"
                    sub="HikRobot USB3 / GigE"
                    status={camOnline ? 'online' : 'offline'}
                    onAction={doRefreshDevices}
                    actionLabel={scanning ? 'Scanning…' : 'Scan Devices'}
                    actionIcon={scanning ? 'fa-spinner fa-spin' : 'fa-rotate'}
                    actionDisabled={scanning}
                  />
                  <div className="st-card-body">
                    <div className="st-status-bar">
                      <div className={`st-status-indicator ${camOnline ? 'on' : 'off'}`}/>
                      <span className="st-status-text">{camStatus}</span>
                    </div>
                    {scanning && (
                      <div className="st-scanning-bar">
                        <div className="st-scanning-fill"/>
                      </div>
                    )}
                    {devices.length > 0 && (
                      <div className="st-device-list">
                        {devices.map((d, i) => (
                          <div key={i} className="st-device-row">
                            <div className="st-device-icon"><i className="fa-solid fa-camera"/></div>
                            <div className="st-device-info">
                              <div className="st-device-name">{d.model}</div>
                              <div className="st-device-meta">S/N: {d.serial} · Index: {d.index}</div>
                            </div>
                            <span className={`st-device-badge ${d.type?.toLowerCase()}`}>{d.type}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Resolution */}
                <div className="st-card">
                  <SectionHdr icon="fa-expand" title="Resolution" sub="Capture image size"/>
                  <div className="st-card-body">
                    <div className="st-res-grid">
                      {RESOLUTIONS.map(r => (
                        <button
                          key={r}
                          className={`st-res-btn${camRes === r ? ' active' : ''}`}
                          onClick={() => setCamRes(r)}>
                          <span className="st-res-label">{r}</span>
                          <span className="st-res-mp">
                            {(parseInt(r) * parseInt(r.split('×')[1]) / 1e6).toFixed(1)} MP
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Exposure & Gain */}
                <div className="st-card">
                  <SectionHdr icon="fa-sun" title="Exposure & Gain" sub="Light sensitivity control"/>
                  <div className="st-card-body">
                    <SliderRow label="Exposure Time" value={exposure} min={100} max={100000} step={100} unit=" µs" onChange={setExposure}/>
                    <SliderRow label="Analog Gain" value={gainDb} min={0} max={24} step={0.5} unit=" dB" onChange={setGainDb} decimals={1}/>
                    <button className="st-apply-btn" onClick={doApplyCam}>
                      <i className="fa-solid fa-upload"/> Apply to Camera
                    </button>
                  </div>
                </div>

              </div>
            )}

            {/* ── DETECTION TAB ── */}
            {activeTab === 'detection' && (
              <div className="st-grid">

                {/* Method */}
                <div className="st-card st-card-full">
                  <SectionHdr icon="fa-eye" title="Detection Method" sub="Algorithm used to find indentation diagonals"/>
                  <div className="st-card-body">
                    <div className="st-method-grid">
                      {DET_METHODS.map(m => (
                        <button
                          key={m.value}
                          className={`st-method-btn${detMethod === m.value ? ' active' : ''}`}
                          onClick={() => setDetMethod(m.value)}>
                          <div className="st-method-radio">
                            {detMethod === m.value && <div className="st-method-radio-dot"/>}
                          </div>
                          <div className="st-method-info">
                            <div className="st-method-name">{m.value.charAt(0).toUpperCase() + m.value.slice(1)}</div>
                            <div className="st-method-desc">{m.label.split('—')[1]?.trim()}</div>
                          </div>
                          {m.value === 'ellipse' && <span className="st-method-badge">Recommended</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Preprocessing */}
                <div className="st-card">
                  <SectionHdr icon="fa-wand-magic-sparkles" title="Image Preprocessing" sub="CLAHE and blur settings"/>
                  <div className="st-card-body">
                    <SliderRow label="CLAHE Clip Limit" value={clahe} min={0.5} max={8} step={0.5} unit="" onChange={setClahe} decimals={1}/>
                    <SliderRow label="Gaussian Blur" value={blur} min={3} max={21} step={2} unit=" px" onChange={setBlur}/>
                  </div>
                </div>

                {/* Hough */}
                <div className="st-card">
                  <SectionHdr icon="fa-circle-dot" title="Hough Parameters" sub="Circle detection tuning"/>
                  <div className="st-card-body">
                    <SliderRow label="Param2 Threshold" value={p2} min={5} max={80} step={1} unit="" onChange={setP2}/>
                    <SliderRow label="Min Radius" value={minR} min={2} max={50} step={1} unit=" px" onChange={setMinR}/>
                  </div>
                </div>

              </div>
            )}

            {/* ── ACCEPTANCE TAB ── */}
            {activeTab === 'acceptance' && (
              <div className="st-grid">

                {/* HV Range */}
                <div className="st-card">
                  <SectionHdr icon="fa-circle-check" title="HV Acceptance Range" sub="Pass / Fail thresholds"/>
                  <div className="st-card-body">
                    <div className="st-hv-range-row">
                      <div className="st-hv-range-item">
                        <label className="st-label">Min HV</label>
                        <div className="st-hv-input-wrap min">
                          <i className="fa-solid fa-arrow-down-to-line"/>
                          <input className="st-hv-input" type="number" placeholder="0"
                            value={specMin} onChange={e => setSpecMin(e.target.value)}/>
                          <span className="st-hv-unit">HV</span>
                        </div>
                      </div>
                      <div className="st-hv-range-arrow"><i className="fa-solid fa-arrows-left-right"/></div>
                      <div className="st-hv-range-item">
                        <label className="st-label">Max HV</label>
                        <div className="st-hv-input-wrap max">
                          <i className="fa-solid fa-arrow-up-to-line"/>
                          <input className="st-hv-input" type="number" placeholder="9999"
                            value={specMax} onChange={e => setSpecMax(e.target.value)}/>
                          <span className="st-hv-unit">HV</span>
                        </div>
                      </div>
                    </div>

                    {/* Visual range bar */}
                    {specMin && specMax && (
                      <div className="st-range-vis">
                        <div className="st-range-vis-bar">
                          <div className="st-range-vis-fill"
                            style={{
                              left: `${Math.min(+specMin/10, 90)}%`,
                              right: `${Math.max(100 - +specMax/10, 5)}%`
                            }}/>
                        </div>
                        <div className="st-range-vis-labels">
                          <span>0</span><span>500</span><span>1000+</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Load & Standard */}
                <div className="st-card">
                  <SectionHdr icon="fa-weight-hanging" title="Test Parameters" sub="Load and standard"/>
                  <div className="st-card-body">
                    <label className="st-label">Default Test Load</label>
                    <div className="st-load-grid">
                      {LOADS.map(l => (
                        <button key={l}
                          className={`st-load-btn${defLoad === l ? ' active' : ''}`}
                          onClick={() => setDefLoad(l)}>
                          <span className="st-load-val">HV{l}</span>
                          <span className="st-load-kgf">{l} kgf</span>
                        </button>
                      ))}
                    </div>
                    <label className="st-label" style={{marginTop:16}}>Test Standard</label>
                    <select className="st-select" value={standard} onChange={e => setStandard(e.target.value)}>
                      {STANDARDS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                {/* Sample info */}
                <div className="st-card st-card-full">
                  <SectionHdr icon="fa-flask" title="Sample Information" sub="Material and operator metadata"/>
                  <div className="st-card-body">
                    <div className="st-form-row">
                      <div className="st-form-group">
                        <label className="st-label">Material / Grade</label>
                        <input className="st-input" type="text" placeholder="e.g. AISI 4140 HT"
                          value={material} onChange={e => setMaterial(e.target.value)}/>
                      </div>
                      <div className="st-form-group">
                        <label className="st-label">Operator Name</label>
                        <input className="st-input" type="text" placeholder="Operator name"
                          value={operator} onChange={e => setOperator(e.target.value)}/>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* ── SYSTEM INFO TAB ── */}
            {activeTab === 'system' && (
              <div className="st-grid">
                <div className="st-card st-card-full">
                  <SectionHdr
                    icon="fa-server" title="System Status"
                    sub="Live camera and backend diagnostics"
                    onAction={doLoadSysInfo}
                    actionLabel="Refresh"
                    actionIcon="fa-rotate"
                  />
                  <div className="st-card-body">
                    <div className="st-sysinfo-grid">
                      {sysRows.map(([k, v]) => (
                        <div key={k} className="st-sysinfo-row">
                          <span className="st-sysinfo-key">
                            <i className={`fa-solid ${
                              k === 'SDK'        ? 'fa-microchip' :
                              k === 'Camera'     ? 'fa-camera' :
                              k === 'Serial'     ? 'fa-barcode' :
                              k === 'Interface'  ? 'fa-plug' :
                              k === 'Exposure'   ? 'fa-sun' :
                              k === 'Gain'       ? 'fa-sliders' :
                              k === 'Resolution' ? 'fa-expand' :
                              k === 'Grabbing'   ? 'fa-video' :
                              k === 'HV Offset'  ? 'fa-diamond' :
                              k === 'px / mm'    ? 'fa-ruler' :
                              k === 'Backend'    ? 'fa-server' :
                              'fa-info-circle'
                            }`}/>
                            {k}
                          </span>
                          <span className={`st-sysinfo-val${
                            v === 'ERROR' || v === 'Server offline' ? ' err' :
                            v.includes('✓') ? ' ok' : ''
                          }`}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Quick actions */}
                <div className="st-card st-card-full">
                  <SectionHdr icon="fa-bolt" title="Quick Actions" sub="Common operations"/>
                  <div className="st-card-body">
                    <div className="st-quick-actions">
                      {[
                        { icon: 'fa-ruler-combined', label: 'Open Calibration',    action: () => navigate('/calibration') },
                        { icon: 'fa-video',          label: 'Open Live Camera',    action: () => navigate('/live') },
                        { icon: 'fa-chart-line',     label: 'View Reports',        action: () => navigate('/reports') },
                        { icon: 'fa-rotate-left',    label: 'Reset All Settings',  action: async () => {
                          if (!confirm('Reset all settings to defaults?')) return;
                          localStorage.removeItem('ht_settings');
                          localStorage.removeItem('ht_spec');
                          try {
                            const api = (window as any).api;
                            if (api?.invoke) {
                              await api.invoke('db:settings:set', 'camera_settings', {});
                              await api.invoke('db:settings:set', 'spec_settings', {});
                            }
                          } catch {}
                          toast('Settings reset to defaults', 'info');
                        }},
                      ].map(({ icon, label, action }) => (
                        <button key={label} className="st-quick-btn" onClick={action}>
                          <i className={`fa-solid ${icon}`}/>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>


                {/* DB Test Panel */}
                <div className="st-card st-card-full">
                  <SectionHdr
                    icon="fa-database"
                    title="SQLite Database Test"
                    sub="Verify DB connection and IPC channels are working"
                    onAction={runDbTest}
                    actionLabel={dbStatus === 'testing' ? 'Testing…' : 'Run Test'}
                    actionIcon={dbStatus === 'testing' ? 'fa-spinner fa-spin' : 'fa-play'}
                    actionDisabled={dbStatus === 'testing'}
                  />
                  <div className="st-card-body">
                    {dbStatus === 'idle' && (
                      <div className="st-db-idle">
                        <i className="fa-solid fa-database"/>
                        <span>Click <b>Run Test</b> to verify SQLite is connected and all IPC channels work correctly.</span>
                      </div>
                    )}
                    {dbTestLog.length > 0 && (
                      <div className="st-db-log">
                        {dbTestLog.map((entry, i) => (
                          <div key={i} className={`st-db-log-row ${entry.ok ? 'ok' : 'err'}`}>
                            <i className={`fa-solid ${entry.ok ? 'fa-circle-check' : 'fa-circle-xmark'}`}/>
                            <span>{entry.msg}</span>
                          </div>
                        ))}
                        {dbStatus === 'ok' && (
                          <div className="st-db-result ok">
                            <i className="fa-solid fa-shield-check"/> SQLite is fully operational
                          </div>
                        )}
                        {dbStatus === 'error' && (
                          <div className="st-db-result err">
                            <i className="fa-solid fa-triangle-exclamation"/> Test failed — check Electron console for details
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

              </div>
            )}

          </div>{/* st-scroll */}
        </div>{/* st-main */}
      </div>{/* st-body */}
    </div>
  );
}