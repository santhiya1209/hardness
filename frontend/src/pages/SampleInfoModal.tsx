// components/SampleInfoModal.tsx
import { useState } from 'react';
import './SampleInfoModal.css';

export interface SampleInfo {
  sampleName:  string;
  material:    string;
  operator:    string;
  loadKgf:     string;
  preparation: string;
  note:        string;
}

const STORAGE_KEY = 'htp_sample_info';

const DEFAULT: SampleInfo = {
  sampleName:  '',
  material:    '',
  operator:    '',
  loadKgf:     '10',
  preparation: '',
  note:        '',
};

const MATERIALS = ['Steel','Stainless Steel','Aluminum','Copper','Brass','Titanium','Cast Iron','Tool Steel','HSS','Other'];
const LOADS     = ['0.01','0.025','0.05','0.1','0.2','0.3','0.5','1','2','3','5','10','20','30','50'];

export function loadSampleInfo(): SampleInfo {
  try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
  catch { return DEFAULT; }
}

interface Props { onClose: () => void; }

export default function SampleInfoModal({ onClose }: Props) {
  const [info, setInfo] = useState<SampleInfo>(loadSampleInfo);
  const [saved, setSaved] = useState(false);

  const set = (k: keyof SampleInfo, v: string) => setInfo(p => ({ ...p, [k]: v }));

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(info));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleClear = () => { setInfo(DEFAULT); };

  return (
    <div className="sim-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sim-modal">
        <div className="sim-hdr">
          <div className="sim-title"><i className="fa-solid fa-flask"/> Sample Information</div>
          <button className="sim-close" onClick={onClose}><i className="fa fa-xmark"/></button>
        </div>
        <div className="sim-body">
          <div className="sim-row">
            <label className="sim-label">Sample Name</label>
            <input className="sim-input" value={info.sampleName}
              onChange={e => set('sampleName', e.target.value)}
              placeholder="e.g. Sample-001" />
          </div>
          <div className="sim-row">
            <label className="sim-label">Material</label>
            <select className="sim-select" value={info.material}
              onChange={e => set('material', e.target.value)}>
              <option value="">— Select material —</option>
              {MATERIALS.map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div className="sim-row">
            <label className="sim-label">Operator</label>
            <input className="sim-input" value={info.operator}
              onChange={e => set('operator', e.target.value)}
              placeholder="Operator name" />
          </div>
          <div className="sim-row">
            <label className="sim-label">Test Load (kgf)</label>
            <select className="sim-select" value={info.loadKgf}
              onChange={e => set('loadKgf', e.target.value)}>
              {LOADS.map(l => <option key={l} value={l}>{l} kgf</option>)}
            </select>
          </div>
          <div className="sim-row">
            <label className="sim-label">Surface Preparation</label>
            <input className="sim-input" value={info.preparation}
              onChange={e => set('preparation', e.target.value)}
              placeholder="e.g. Polished, Ground, As-received" />
          </div>
          <div className="sim-row sim-row-tall">
            <label className="sim-label">Notes</label>
            <textarea className="sim-textarea" value={info.note}
              onChange={e => set('note', e.target.value)}
              placeholder="Additional notes…" rows={3} />
          </div>
        </div>
        <div className="sim-footer">
          <button className="sim-btn sim-btn-ghost" onClick={handleClear}>
            <i className="fa fa-rotate-left"/> Clear
          </button>
          <button className="sim-btn sim-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="sim-btn sim-btn-primary" onClick={handleSave}>
            <i className={`fa ${saved ? 'fa-check' : 'fa-floppy-disk'}`}/>
            {saved ? ' Saved!' : ' Save'}
          </button>
        </div>
      </div>
    </div>
  );
}