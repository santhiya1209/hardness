// pages/HelpPage.tsx
import '../styles/global.css';
import '../styles/layout.css';
import './HelpPage.css';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MenuBar from './MenuBar';
import './MenuBar.css';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface AccItem { title: string; icon: string; content: React.ReactNode; }

// ─────────────────────────────────────────────────────────────
// Content Data
// ─────────────────────────────────────────────────────────────
const GETTING_STARTED: AccItem[] = [
  {
    title: 'How to take a measurement',
    icon: 'fa-play',
    content: (
      <div className="hlp-step-list">
        {[
          'Navigate to Measurement in the sidebar.',
          'Select the test scale (e.g. HV 10) from the dropdown.',
          'Click Stream — the live camera feed starts.',
          'Apply the indenter load manually on the hardness tester.',
          'Click Measure (or press Enter) — auto diagonal detection computes HV.',
          'HV result with PASS/FAIL badge appears. Results auto-saved to History.',
        ].map((s, i) => (
          <div key={i} className="hlp-step-row">
            <div className="hlp-step-num">{i + 1}</div>
            <div className="hlp-step-text">{s}</div>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'How to calibrate the system',
    icon: 'fa-ruler-combined',
    content: (
      <div className="hlp-step-list">
        {[
          'Place a certified Vickers reference block under the indenter.',
          'Apply the load and make a fresh indentation.',
          'Go to Calibration → enter certified HV and load → click Run Calibration.',
          'System calculates px/mm scale factor and HV offset. Error < ±2% is acceptable.',
          'Or use Calculate px/mm from optics — enter objective magnification and sensor pitch.',
        ].map((s, i) => (
          <div key={i} className="hlp-step-row">
            <div className="hlp-step-num">{i + 1}</div>
            <div className="hlp-step-text">{s}</div>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'Setting up the live camera feed',
    icon: 'fa-video',
    content: (
      <div className="hlp-step-list">
        {[
          'Connect the HikRobot USB3 camera to a blue USB 3.0 port.',
          'Close MVS Studio completely — it holds an exclusive lock on the camera.',
          <span>The HikRobot native addon (<code className="hlp-code">MvCameraControl.node</code>) loads automatically when the backend starts.</span>,
          <span>Run <code className="hlp-code">npm run dev</code> from the project root — the addon initialises on startup.</span>,
          'Go to Live Camera page → click Connect.',
          'Adjust exposure and gain sliders until the indentation is clearly visible.',
        ].map((s, i) => (
          <div key={i} className="hlp-step-row">
            <div className="hlp-step-num">{i + 1}</div>
            <div className="hlp-step-text">{s}</div>
          </div>
        ))}
      </div>
    ),
  },
];

const TROUBLE: AccItem[] = [
  {
    title: 'Camera offline / not detected',
    icon: 'fa-camera-slash',
    content: (
      <div className="hlp-step-list">
        {[
          'Check USB3 cable is in a blue USB3 port — not a black USB2 port.',
          'Close MVS Studio completely — it holds an exclusive lock on the camera.',
          <span>Check the backend console — it should print <code className="hlp-code">HikRobot native addon loaded</code> on startup.</span>,
          <span>If it prints <code className="hlp-code">No HikRobot cameras found — using simulator</code>, the camera is not detected by the addon.</span>,
          'Check Windows Device Manager — camera should appear without a warning triangle.',
          'If multiple cameras are connected, select the correct device index in Settings.',
        ].map((s, i) => (
          <div key={i} className="hlp-step-row">
            <div className="hlp-step-num">{i + 1}</div>
            <div className="hlp-step-text">{s}</div>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'Indentation not detected',
    icon: 'fa-eye-slash',
    content: (
      <div className="hlp-step-list">
        {[
          'Adjust focus until indentation edges are sharp in the live view.',
          'Increase exposure time in Settings or the Live Camera toolbar slider.',
          'Switch detection method: try Ellipse → Contour → HoughCircles in Settings.',
          'Lower the CLAHE clip limit in Settings if image appears over-enhanced.',
          'Enter diagonals manually in the D1/D2 fields on the Measurement page.',
        ].map((s, i) => (
          <div key={i} className="hlp-step-row">
            <div className="hlp-step-num">{i + 1}</div>
            <div className="hlp-step-text">{s}</div>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'App not starting / blank screen',
    icon: 'fa-triangle-exclamation',
    content: (
      <div className="hlp-step-list">
        {[
          <span>Run <code className="hlp-code">npm run dev</code> from the project root and check the console for errors.</span>,
          <span>Make sure dependencies are installed: run <code className="hlp-code">npm install</code> in the root folder.</span>,
          'Check that the Electron version matches requirements (≥ 28).',
          <span>Delete <code className="hlp-code">dist/</code> and <code className="hlp-code">.vite/</code> folders and rebuild.</span>,
          'Ensure no other app is using port 3000 (backend) or 5173 (Vite frontend).',
        ].map((s, i) => (
          <div key={i} className="hlp-step-row">
            <div className="hlp-step-num">{i + 1}</div>
            <div className="hlp-step-text">{s}</div>
          </div>
        ))}
      </div>
    ),
  },
];

const SHORTCUTS = [
  { key: 'Enter',  action: 'Take measurement',         icon: 'fa-crosshairs' },
  { key: 'S',      action: 'Start / stop camera stream',icon: 'fa-video' },
  { key: 'P',      action: 'Save snapshot',             icon: 'fa-camera' },
  { key: 'C',      action: 'Toggle crosshair overlay',  icon: 'fa-crosshairs' },
  { key: 'H',      action: 'Toggle HUD overlay',        icon: 'fa-layer-group' },
  { key: '+ / =',  action: 'Zoom in camera view',       icon: 'fa-magnifying-glass-plus' },
  { key: '−',      action: 'Zoom out camera view',      icon: 'fa-magnifying-glass-minus' },
  { key: '0',      action: 'Reset zoom to 100%',        icon: 'fa-rotate-left' },
  { key: 'F1',     action: 'Auto measure (menu bar)',   icon: 'fa-robot' },
  { key: 'F2',     action: 'Manual measure (menu bar)', icon: 'fa-hand-pointer' },
  { key: 'F5',     action: 'Open camera (menu bar)',    icon: 'fa-plug' },
  { key: 'F6',     action: 'Close camera (menu bar)',   icon: 'fa-stop' },
];

const SYSREQ = [
  { key: 'OS',        val: 'Windows 10 / 11 (64-bit)',   icon: 'fa-windows' },
  { key: 'Node.js',   val: '≥ 18 LTS',                   icon: 'fa-node-js' },
  { key: 'Electron',  val: '≥ 28',                       icon: 'fa-bolt' },
  { key: 'MVS SDK',   val: 'HikRobot MVS latest',        icon: 'fa-camera' },
  { key: 'Camera',    val: 'HikRobot USB3 / GigE',       icon: 'fa-video' },
  { key: 'Interface', val: 'USB 3.0 or GigE Cat6',       icon: 'fa-ethernet' },
  { key: 'Backend',   val: 'Node.js + Express (port 3000)', icon: 'fa-server' },
  { key: 'Addon',     val: 'HikRobot MvCameraControl.node', icon: 'fa-puzzle-piece' },
  { key: 'Frontend',  val: 'Vite dev server (port 5173)', icon: 'fa-globe' },
  { key: 'Database',  val: 'SQLite via sql.js',           icon: 'fa-database' },
  { key: 'RAM',       val: '≥ 4 GB recommended',         icon: 'fa-memory' },
  { key: 'Storage',   val: '≥ 500 MB free',              icon: 'fa-hard-drive' },
  { key: 'Display',   val: '≥ 1280 × 720',               icon: 'fa-display' },
];

// ─────────────────────────────────────────────────────────────
// Accordion Component
// ─────────────────────────────────────────────────────────────
function AccordionPanel({ items }: { items: AccItem[] }) {
  const [open, setOpen] = useState<number[]>([0]);
  const toggle = (i: number) =>
    setOpen(o => o.includes(i) ? o.filter(x => x !== i) : [...o, i]);

  return (
    <div className="hlp-accordion">
      {items.map((item, i) => (
        <div key={i} className={`hlp-acc-item${open.includes(i) ? ' open' : ''}`}>
          <button className="hlp-acc-trigger" onClick={() => toggle(i)}>
            <span className="hlp-acc-icon"><i className={`fa-solid ${item.icon}`}/></span>
            <span className="hlp-acc-title">{item.title}</span>
            <i className={`fa-solid fa-chevron-down hlp-acc-arrow${open.includes(i) ? ' rotated' : ''}`}/>
          </button>
          {open.includes(i) && (
            <div className="hlp-acc-body">{item.content}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────
export default function HelpPage() {
  const navigate = useNavigate();

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
      { label: 'Settings',    icon: 'fa-solid fa-gear',              path: '/settings' },
      { label: 'Help',        icon: 'fa-solid fa-circle-question',   path: '/help', active: true },
    ]},
  ];

  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="hlp-root">
      <style>{`
        .hlp-root { display:flex !important; flex-direction:column !important; height:100vh; overflow:hidden; background:#ffffff; }
        .hlp-body { flex:1; overflow:hidden; display:flex; }
        .menubar  { flex-shrink:0; width:100%; }
        .menubar-dropdown { position:fixed !important; z-index:99999 !important; }
      `}</style>

      {/* TITLE BAR */}
      <div className="hlp-tb">
        <div className="hlp-tb-brand">
          <div className="hlp-tb-logo"><i className="fa-solid fa-diamond"/></div>
          <span className="hlp-tb-title">Hardness <span>Tester</span> Pro</span>
        </div>
        <div className="hlp-tb-clock">{new Date().toTimeString().slice(0, 8)}</div>
        <div className="hlp-tb-ctrls">
          <button onClick={() => (window as any).api?.minimize()}><i className="fa fa-minus"/></button>
          <button onClick={() => (window as any).api?.maximize()}><i className="fa fa-square"/></button>
          <button className="tb-x" onClick={() => (window as any).api?.close()}><i className="fa fa-xmark"/></button>
        </div>
      </div>

      {/* MENU BAR */}
      <MenuBar onCalibration={() => navigate('/calibration')} onOpenCamera={() => navigate('/live')}/>

      {/* BODY */}
      <div className="hlp-body">

        {/* SIDEBAR */}
        <nav className="hlp-sidebar">
          <div className="hlp-sb-brand">
            <div className="hlp-sb-ico"><i className="fa-solid fa-diamond"/></div>
            <div>
              <div className="hlp-sb-nm">HT <span>Pro</span></div>
              <div className="hlp-sb-ver">v1.0.0</div>
            </div>
          </div>
          {NAV.map(g => (
            <div key={g.sec}>
              <div className="hlp-sb-sec">{g.sec}</div>
              {g.items.map(item => (
                <div key={item.path}
                  className={`hlp-nav-item${(item as any).active ? ' active' : ''}`}
                  onClick={() => navigate(item.path)}>
                  <i className={item.icon}/>{item.label}
                </div>
              ))}
            </div>
          ))}
        </nav>

        {/* MAIN */}
        <div className="hlp-main">

          {/* PAGE HEADER */}
          <div className="hlp-hdr">
            <div>
              <div className="page-title">Help &amp; <span>Reference</span></div>
              <div className="page-sub">// User manual · Troubleshooting · Shortcuts · System requirements</div>
            </div>
          </div>

          {/* CONTENT */}
          <div className="hlp-scroll">
            <div className="hlp-layout">

              {/* LEFT QUICK-NAV */}
              <aside className="hlp-quicknav">
                <div className="hlp-qn-title">Quick navigation</div>
                {[
                  { id: 'sec-start',    icon: 'fa-rocket',              label: 'Getting started' },
                  { id: 'sec-keyboard', icon: 'fa-keyboard',            label: 'Keyboard shortcuts' },
                  { id: 'sec-trouble',  icon: 'fa-triangle-exclamation', label: 'Troubleshooting' },
                  { id: 'sec-sysreq',   icon: 'fa-server',              label: 'System requirements' },
                ].map(({ id, icon, label }) => (
                  <button key={id} className="hlp-qn-item" onClick={() => scrollTo(id)}>
                    <i className={`fa-solid ${icon}`}/>{label}
                  </button>
                ))}

                {/* Quick reference card */}
                <div className="hlp-ref-card">
                  <div className="hlp-ref-card-title">
                    <i className="fa-solid fa-bolt"/> Quick Reference
                  </div>
                  <div className="hlp-ref-card-body">
                    <div className="hlp-ref-row"><span>HV</span> = 1.854 × F / d²</div>
                    <div className="hlp-ref-row">d = (d1 + d2) / 2</div>
                    <div className="hlp-ref-row">UTS ≈ <span>HV</span> × 3.3 MPa</div>
                    <div className="hlp-ref-row">HB ≈ <span>HV</span> / 1.05</div>
                    <div className="hlp-ref-divider"/>
                    <div className="hlp-ref-row">Addon auto-loads on start</div>
                    <div className="hlp-ref-row"><span>Enter</span> → Measure</div>
                    <div className="hlp-ref-row"><span>S</span> → Stream toggle</div>
                    <div className="hlp-ref-row"><span>P</span> → Snapshot</div>
                  </div>
                </div>

                {/* Version card */}
                <div className="hlp-ver-card">
                  <div className="hlp-ver-title"><i className="fa-solid fa-circle-info"/> Version info</div>
                  <div className="hlp-ver-body">
                    <div>App v1.0.0</div>
                    <div>ISO 6507 / ASTM E92</div>
                    <div>ASTM E140 conversions</div>
                    <div>SQLite via sql.js</div>
                  </div>
                </div>
              </aside>

              {/* RIGHT CONTENT */}
              <div className="hlp-content">

                {/* Getting started */}
                <section className="hlp-section" id="sec-start">
                  <div className="hlp-section-hdr">
                    <div className="hlp-section-icon"><i className="fa-solid fa-rocket"/></div>
                    <div>
                      <div className="hlp-section-title">Getting started</div>
                      <div className="hlp-section-sub">Basic workflow</div>
                    </div>
                  </div>
                  <AccordionPanel items={GETTING_STARTED}/>
                </section>

                {/* Keyboard shortcuts */}
                <section className="hlp-section" id="sec-keyboard">
                  <div className="hlp-section-hdr">
                    <div className="hlp-section-icon"><i className="fa-solid fa-keyboard"/></div>
                    <div>
                      <div className="hlp-section-title">Keyboard shortcuts</div>
                      <div className="hlp-section-sub">Global &amp; page-specific</div>
                    </div>
                  </div>
                  <div className="hlp-kbd-grid">
                    {SHORTCUTS.map(({ key, action, icon }) => (
                      <div key={key} className="hlp-kbd-row">
                        <span className="hlp-kbd-key">{key}</span>
                        <span className="hlp-kbd-icon"><i className={`fa-solid ${icon}`}/></span>
                        <span className="hlp-kbd-action">{action}</span>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Troubleshooting */}
                <section className="hlp-section" id="sec-trouble">
                  <div className="hlp-section-hdr">
                    <div className="hlp-section-icon" style={{background:'linear-gradient(135deg,#f59e0b,#d97706)'}}>
                      <i className="fa-solid fa-triangle-exclamation"/>
                    </div>
                    <div>
                      <div className="hlp-section-title">Troubleshooting</div>
                      <div className="hlp-section-sub">Common issues &amp; fixes</div>
                    </div>
                  </div>
                  <AccordionPanel items={TROUBLE}/>
                </section>

                {/* System requirements */}
                <section className="hlp-section" id="sec-sysreq">
                  <div className="hlp-section-hdr">
                    <div className="hlp-section-icon" style={{background:'linear-gradient(135deg,#10b981,#059669)'}}>
                      <i className="fa-solid fa-server"/>
                    </div>
                    <div>
                      <div className="hlp-section-title">System requirements</div>
                      <div className="hlp-section-sub">Software &amp; hardware</div>
                    </div>
                  </div>
                  <div className="hlp-sysreq-grid">
                    {SYSREQ.map(({ key, val, icon }) => (
                      <div key={key} className="hlp-sysreq-row">
                        <span className="hlp-sysreq-icon"><i className={`fa-solid ${icon}`}/></span>
                        <span className="hlp-sysreq-key">{key}</span>
                        <span className="hlp-sysreq-val">{val}</span>
                      </div>
                    ))}
                  </div>
                  <div className="hlp-install-block">
                    <div className="hlp-install-title">
                      <i className="fa-solid fa-terminal"/> Install commands
                    </div>
                    <div className="hlp-install-code">
                      <div><span className="hlp-cmt"># Install all dependencies</span></div>
                      <div>npm install</div>
                      <div style={{marginTop:8}}><span className="hlp-cmt"># Start app (frontend + backend + Electron)</span></div>
                      <div>npm run dev</div>
                      <div style={{marginTop:8}}><span className="hlp-cmt"># HikRobot addon loads automatically</span></div>
                      <div><span className="hlp-cmt"># (MvCameraControl.node in backend/src/)</span></div>
                      <div style={{marginTop:8}}><span className="hlp-cmt"># Build for production</span></div>
                      <div>npm run build</div>
                    </div>
                  </div>
                </section>

              </div>{/* hlp-content */}
            </div>{/* hlp-layout */}
          </div>{/* hlp-scroll */}
        </div>{/* hlp-main */}
      </div>{/* hlp-body */}
    </div>
  );
}