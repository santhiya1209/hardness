// components/SettingsModal.tsx
// Reusable settings modal — Line Color, Serial Port, XY Platform, Z Axis,
// Auto Measure, Generic, Other, Restore Factory
import { useState } from 'react';
import './SettingsModal.css';

// ─────────────────────────────────────────────────────────────
// LINE COLOR SETTINGS
// ─────────────────────────────────────────────────────────────
const LINE_COLORS_KEY = 'htp_line_colors';
export interface LineColors {
  measureLine: string;
  crosshair:   string;
  grid:        string;
  edgeRing:    string;
  scaleBar:    string;
}
const DEFAULT_COLORS: LineColors = {
  measureLine: '#c832dc',
  crosshair:   '#0ea5e9',
  grid:        '#1e3a5f',
  edgeRing:    '#10b981',
  scaleBar:    '#0ea5e9',
};
export function loadLineColors(): LineColors {
  try { return { ...DEFAULT_COLORS, ...JSON.parse(localStorage.getItem(LINE_COLORS_KEY) || '{}') }; }
  catch { return DEFAULT_COLORS; }
}

// ─────────────────────────────────────────────────────────────
// AUTO MEASURE SETTINGS
// ─────────────────────────────────────────────────────────────
const AUTO_MEAS_KEY = 'htp_auto_meas_settings';
export interface AutoMeasSettings {
  intervalMs:      number;
  minIndentSizePx: number;
  maxIndentSizePx: number;
  bgThresholdPct:  number;
  wallThresholdPct:number;
  showLiveLines:   boolean;
}
const DEFAULT_AUTO: AutoMeasSettings = {
  intervalMs: 2500, minIndentSizePx: 20, maxIndentSizePx: 400,
  bgThresholdPct: 65, wallThresholdPct: 60, showLiveLines: true,
};
export function loadAutoMeasSettings(): AutoMeasSettings {
  try { return { ...DEFAULT_AUTO, ...JSON.parse(localStorage.getItem(AUTO_MEAS_KEY) || '{}') }; }
  catch { return DEFAULT_AUTO; }
}

// ─────────────────────────────────────────────────────────────
// SERIAL PORT SETTINGS
// ─────────────────────────────────────────────────────────────
const SERIAL_KEY = 'htp_serial_settings';
export interface SerialSettings { port: string; baudRate: number; dataBits: number; stopBits: number; parity: string; }
const DEFAULT_SERIAL: SerialSettings = { port: 'COM1', baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'None' };
export function loadSerialSettings(): SerialSettings {
  try { return { ...DEFAULT_SERIAL, ...JSON.parse(localStorage.getItem(SERIAL_KEY) || '{}') }; }
  catch { return DEFAULT_SERIAL; }
}

// ─────────────────────────────────────────────────────────────
// XY PLATFORM SETTINGS
// ─────────────────────────────────────────────────────────────
const XY_KEY = 'htp_xy_settings';
export interface XYSettings { stepSizeUm: number; speedMmPerMin: number; accelMmPerS2: number; xRange: number; yRange: number; invertX: boolean; invertY: boolean; }
const DEFAULT_XY: XYSettings = { stepSizeUm: 1, speedMmPerMin: 10, accelMmPerS2: 5, xRange: 50, yRange: 50, invertX: false, invertY: false };
export function loadXYSettings(): XYSettings {
  try { return { ...DEFAULT_XY, ...JSON.parse(localStorage.getItem(XY_KEY) || '{}') }; }
  catch { return DEFAULT_XY; }
}

// ─────────────────────────────────────────────────────────────
// Z AXIS SETTINGS
// ─────────────────────────────────────────────────────────────
const Z_KEY = 'htp_z_settings';
export interface ZSettings { stepSizeUm: number; speedMmPerMin: number; maxDepthMm: number; autoFocus: boolean; }
const DEFAULT_Z: ZSettings = { stepSizeUm: 0.5, speedMmPerMin: 5, maxDepthMm: 10, autoFocus: false };
export function loadZSettings(): ZSettings {
  try { return { ...DEFAULT_Z, ...JSON.parse(localStorage.getItem(Z_KEY) || '{}') }; }
  catch { return DEFAULT_Z; }
}

// ─────────────────────────────────────────────────────────────
// GENERIC SETTINGS
// ─────────────────────────────────────────────────────────────
const GENERIC_KEY = 'htp_generic_settings';
export interface GenericSettings { language: string; theme: string; decimalPlaces: number; autoSave: boolean; soundFeedback: boolean; }
const DEFAULT_GENERIC: GenericSettings = { language: 'English', theme: 'Dark', decimalPlaces: 2, autoSave: true, soundFeedback: false };
export function loadGenericSettings(): GenericSettings {
  try { return { ...DEFAULT_GENERIC, ...JSON.parse(localStorage.getItem(GENERIC_KEY) || '{}') }; }
  catch { return DEFAULT_GENERIC; }
}

// ─────────────────────────────────────────────────────────────
// MODAL COMPONENT
// ─────────────────────────────────────────────────────────────
export type SettingsType =
  | 'lineColor' | 'autoMeasure' | 'serialPort'
  | 'xyPlatform' | 'zAxis' | 'generic' | 'other';

interface Props { type: SettingsType; onClose: () => void; }

export default function SettingsModal({ type, onClose }: Props) {
  const [saved, setSaved] = useState(false);

  // Line color state
  const [colors,     setColors]     = useState<LineColors>(loadLineColors);
  const [autoMeas,   setAutoMeas]   = useState<AutoMeasSettings>(loadAutoMeasSettings);
  const [serial,     setSerial]     = useState<SerialSettings>(loadSerialSettings);
  const [xy,         setXY]         = useState<XYSettings>(loadXYSettings);
  const [zAxis,      setZAxis]      = useState<ZSettings>(loadZSettings);
  const [generic,    setGeneric]    = useState<GenericSettings>(loadGenericSettings);

  const setColor = (k: keyof LineColors, v: string) => setColors(p => ({ ...p, [k]: v }));

  const save = () => {
    if (type === 'lineColor')   localStorage.setItem(LINE_COLORS_KEY, JSON.stringify(colors));
    if (type === 'autoMeasure') localStorage.setItem(AUTO_MEAS_KEY,   JSON.stringify(autoMeas));
    if (type === 'serialPort')  localStorage.setItem(SERIAL_KEY,      JSON.stringify(serial));
    if (type === 'xyPlatform')  localStorage.setItem(XY_KEY,          JSON.stringify(xy));
    if (type === 'zAxis')       localStorage.setItem(Z_KEY,           JSON.stringify(zAxis));
    if (type === 'generic')     localStorage.setItem(GENERIC_KEY,     JSON.stringify(generic));
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 800);
  };

  const titles: Record<SettingsType, string> = {
    lineColor:   'Line Color Setting',
    autoMeasure: 'Auto Measure Setting',
    serialPort:  'Serial Port Setting',
    xyPlatform:  'XY Platform Setting',
    zAxis:       'Z Axis Setting',
    generic:     'Generic Setting',
    other:       'Other Setting',
  };
  const icons: Record<SettingsType, string> = {
    lineColor: 'fa-palette', autoMeasure: 'fa-sliders', serialPort: 'fa-plug',
    xyPlatform: 'fa-up-down-left-right', zAxis: 'fa-elevator',
    generic: 'fa-gear', other: 'fa-ellipsis',
  };

  return (
    <div className="stg-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="stg-modal">
        <div className="stg-hdr">
          <div className="stg-title">
            <i className={`fa-solid ${icons[type]}`}/> {titles[type]}
          </div>
          <button className="stg-close" onClick={onClose}><i className="fa fa-xmark"/></button>
        </div>

        <div className="stg-body">
          {type === 'lineColor' && (
            <div className="stg-section">
              {([
                ['Measure Lines',   'measureLine'],
                ['Crosshair',       'crosshair'],
                ['Grid',            'grid'],
                ['Edge Ring',       'edgeRing'],
                ['Scale Bar',       'scaleBar'],
              ] as [string, keyof LineColors][]).map(([label, key]) => (
                <div key={key} className="stg-color-row">
                  <span className="stg-label">{label}</span>
                  <div className="stg-color-picker-wrap">
                    <input type="color" className="stg-color-input"
                      value={colors[key]} onChange={e => setColor(key, e.target.value)} />
                    <span className="stg-color-hex">{colors[key]}</span>
                    <div className="stg-color-swatch" style={{ background: colors[key] }}/>
                  </div>
                </div>
              ))}
            </div>
          )}

          {type === 'autoMeasure' && (
            <div className="stg-section">
              {([
                ['Detection Interval (ms)',       'intervalMs',       200, 10000, 1],
                ['Min Indent Size (px)',          'minIndentSizePx',  5,   200,   1],
                ['Max Indent Size (px)',          'maxIndentSizePx',  50,  800,   1],
                ['BG Threshold (%)',              'bgThresholdPct',   40,  90,    1],
                ['Wall Threshold (%)',            'wallThresholdPct', 40,  90,    1],
              ] as [string, keyof AutoMeasSettings, number, number, number][]).map(([label, key, mn, mx, st]) => (
                <div key={key} className="stg-row">
                  <span className="stg-label">{label}</span>
                  <div className="stg-slider-wrap">
                    <input type="range" className="stg-slider" min={mn} max={mx} step={st}
                      value={autoMeas[key] as number}
                      onChange={e => setAutoMeas(p => ({ ...p, [key]: +e.target.value }))} />
                    <span className="stg-val">{autoMeas[key]}</span>
                  </div>
                </div>
              ))}
              <div className="stg-row">
                <span className="stg-label">Show Live Lines</span>
                <label className="stg-toggle">
                  <input type="checkbox" checked={autoMeas.showLiveLines}
                    onChange={e => setAutoMeas(p => ({ ...p, showLiveLines: e.target.checked }))} />
                  <span className="stg-toggle-track"/>
                </label>
              </div>
            </div>
          )}

          {type === 'serialPort' && (
            <div className="stg-section">
              <div className="stg-row">
                <span className="stg-label">Port</span>
                <select className="stg-select" value={serial.port}
                  onChange={e => setSerial(p => ({ ...p, port: e.target.value }))}>
                  {['COM1','COM2','COM3','COM4','COM5','COM6','/dev/ttyUSB0','/dev/ttyUSB1'].map(p =>
                    <option key={p}>{p}</option>)}
                </select>
              </div>
              <div className="stg-row">
                <span className="stg-label">Baud Rate</span>
                <select className="stg-select" value={serial.baudRate}
                  onChange={e => setSerial(p => ({ ...p, baudRate: +e.target.value }))}>
                  {[1200,2400,4800,9600,19200,38400,57600,115200].map(b =>
                    <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div className="stg-row">
                <span className="stg-label">Data Bits</span>
                <select className="stg-select" value={serial.dataBits}
                  onChange={e => setSerial(p => ({ ...p, dataBits: +e.target.value }))}>
                  {[5,6,7,8].map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="stg-row">
                <span className="stg-label">Stop Bits</span>
                <select className="stg-select" value={serial.stopBits}
                  onChange={e => setSerial(p => ({ ...p, stopBits: +e.target.value }))}>
                  {[1,2].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="stg-row">
                <span className="stg-label">Parity</span>
                <select className="stg-select" value={serial.parity}
                  onChange={e => setSerial(p => ({ ...p, parity: e.target.value }))}>
                  {['None','Even','Odd','Mark','Space'].map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
            </div>
          )}

          {type === 'xyPlatform' && (
            <div className="stg-section">
              {([
                ['Step Size (µm)',       'stepSizeUm',     0.1, 100,  0.1],
                ['Speed (mm/min)',       'speedMmPerMin',  1,   100,  1],
                ['Acceleration (mm/s²)','accelMmPerS2',   0.1, 50,   0.1],
                ['X Range (mm)',         'xRange',         1,   300,  1],
                ['Y Range (mm)',         'yRange',         1,   300,  1],
              ] as [string, keyof XYSettings, number, number, number][]).map(([label, key, mn, mx, st]) => (
                <div key={key} className="stg-row">
                  <span className="stg-label">{label}</span>
                  <div className="stg-slider-wrap">
                    <input type="range" className="stg-slider" min={mn} max={mx} step={st}
                      value={xy[key] as number}
                      onChange={e => setXY(p => ({ ...p, [key]: +e.target.value }))} />
                    <span className="stg-val">{(xy[key] as number).toFixed(st < 1 ? 1 : 0)}</span>
                  </div>
                </div>
              ))}
              <div className="stg-row"><span className="stg-label">Invert X</span>
                <label className="stg-toggle"><input type="checkbox" checked={xy.invertX}
                  onChange={e => setXY(p => ({ ...p, invertX: e.target.checked }))}/><span className="stg-toggle-track"/></label>
              </div>
              <div className="stg-row"><span className="stg-label">Invert Y</span>
                <label className="stg-toggle"><input type="checkbox" checked={xy.invertY}
                  onChange={e => setXY(p => ({ ...p, invertY: e.target.checked }))}/><span className="stg-toggle-track"/></label>
              </div>
            </div>
          )}

          {type === 'zAxis' && (
            <div className="stg-section">
              {([
                ['Step Size (µm)',     'stepSizeUm',    0.1, 50,  0.1],
                ['Speed (mm/min)',     'speedMmPerMin', 0.1, 20,  0.1],
                ['Max Depth (mm)',     'maxDepthMm',    1,   50,  1],
              ] as [string, keyof ZSettings, number, number, number][]).map(([label, key, mn, mx, st]) => (
                <div key={key} className="stg-row">
                  <span className="stg-label">{label}</span>
                  <div className="stg-slider-wrap">
                    <input type="range" className="stg-slider" min={mn} max={mx} step={st}
                      value={zAxis[key] as number}
                      onChange={e => setZAxis(p => ({ ...p, [key]: +e.target.value }))} />
                    <span className="stg-val">{(zAxis[key] as number).toFixed(st < 1 ? 1 : 0)}</span>
                  </div>
                </div>
              ))}
              <div className="stg-row"><span className="stg-label">Auto Focus</span>
                <label className="stg-toggle"><input type="checkbox" checked={zAxis.autoFocus}
                  onChange={e => setZAxis(p => ({ ...p, autoFocus: e.target.checked }))}/><span className="stg-toggle-track"/></label>
              </div>
            </div>
          )}

          {type === 'generic' && (
            <div className="stg-section">
              <div className="stg-row">
                <span className="stg-label">Language</span>
                <select className="stg-select" value={generic.language}
                  onChange={e => setGeneric(p => ({ ...p, language: e.target.value }))}>
                  {['English','Chinese','Japanese','Korean','German','French','Spanish'].map(l => <option key={l}>{l}</option>)}
                </select>
              </div>
              <div className="stg-row">
                <span className="stg-label">Theme</span>
                <select className="stg-select" value={generic.theme}
                  onChange={e => setGeneric(p => ({ ...p, theme: e.target.value }))}>
                  {['Dark','Light','High Contrast'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="stg-row">
                <span className="stg-label">Decimal Places</span>
                <select className="stg-select" value={generic.decimalPlaces}
                  onChange={e => setGeneric(p => ({ ...p, decimalPlaces: +e.target.value }))}>
                  {[1,2,3,4].map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="stg-row"><span className="stg-label">Auto Save Results</span>
                <label className="stg-toggle"><input type="checkbox" checked={generic.autoSave}
                  onChange={e => setGeneric(p => ({ ...p, autoSave: e.target.checked }))}/><span className="stg-toggle-track"/></label>
              </div>
              <div className="stg-row"><span className="stg-label">Sound Feedback</span>
                <label className="stg-toggle"><input type="checkbox" checked={generic.soundFeedback}
                  onChange={e => setGeneric(p => ({ ...p, soundFeedback: e.target.checked }))}/><span className="stg-toggle-track"/></label>
              </div>
            </div>
          )}

          {type === 'other' && (
            <div className="stg-section stg-info">
              <i className="fa-solid fa-circle-info stg-info-icon"/>
              <p>Additional settings will be available in future firmware updates.</p>
              <p style={{ color: '#475569', fontSize: 11, marginTop: 8 }}>Version 1.0.0</p>
            </div>
          )}
        </div>

        <div className="stg-footer">
          <button className="stg-btn stg-btn-ghost" onClick={onClose}>Cancel</button>
          {type !== 'other' && (
            <button className="stg-btn stg-btn-primary" onClick={save}>
              <i className={`fa ${saved ? 'fa-check' : 'fa-floppy-disk'}`}/>
              {saved ? ' Saved!' : ' Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}