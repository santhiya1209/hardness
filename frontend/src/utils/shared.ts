// utils/shared.ts — Hardness Tester Pro

// ── HV calculation ──
export function hvFromDiagonals(d1_mm: number, d2_mm: number, load_kgf: number): number {
  const d = (d1_mm + d2_mm) / 2;
  return 1.8544 * load_kgf / (d * d);
}

export function hvTable(hv: number): { HRC: string; HRB: string; HB: string } {
  const hrc = hv >= 240 ? (-0.0006 * hv * hv + 0.37 * hv - 13.2).toFixed(1) : '—';
  const hrb = hv <= 240 ? (0.2917 * hv - 5.833).toFixed(1) : '—';
  const hb  = (hv * 0.9608).toFixed(0);
  return { HRC: hrc, HRB: hrb, HB: hb };
}

export function hvToHRC(hv: number): number | null {
  if (hv < 240) return null;
  return -0.0006 * hv * hv + 0.37 * hv - 13.2;
}

export function hvToHRB(hv: number): number | null {
  if (hv > 240) return null;
  return 0.2917 * hv - 5.833;
}

export function hrcToHV(hrc: number): number {
  return (hrc + 13.2) / 0.37;
}

export function hrbToHV(hrb: number): number {
  return (hrb + 5.833) / 0.2917;
}

// ── Interfaces ──
export interface Measurement {
  hv: number;
  scale: string;
  d1_mm: number;
  d2_mm: number;
  load: number;
  conf: number;
  ts: number;
}

export interface CalibData {
  px_per_mm: number;
  offset_hv: number;
  ref_hv?: number;
  measured_hv?: number;
  date?: number;
}

// ── Local storage store ──
const STORE_KEY = 'htp_measurements';

export const Store = {
  get(): Measurement[] {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    } catch { return []; }
  },
  set(data: Measurement[]) {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  },
  push(entry: Measurement) {
    const data = Store.get();
    data.push(entry);
    Store.set(data);
  },
  clear() {
    localStorage.removeItem(STORE_KEY);
  },
};

// ── Calibration ──
const CALIB_KEY = 'htp_calib';

export const Calibration = {
  get(): CalibData {
    try {
      return JSON.parse(localStorage.getItem(CALIB_KEY) || '{"px_per_mm":100,"offset_hv":0}');
    } catch { return { px_per_mm: 100, offset_hv: 0 }; }
  },
  set(data: CalibData) {
    localStorage.setItem(CALIB_KEY, JSON.stringify(data));
  },
};

// ── Server endpoints ──
//   PORT 3000 — general backend (measurements, reports, BOM, etc.)
//   PORT 8765 — HikRobot camera server (stream, frame, capture, settings)
const BACKEND  = 'http://127.0.0.1:3000';
const CAM_BASE = 'http://127.0.0.1:8765';

// ── Generic API helper (port 3000) ──
export const api = {
  async get(path: string, timeout = 5000): Promise<any> {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(BACKEND + path, { signal: ctrl.signal });
      clearTimeout(tid);
      return await r.json();
    } catch (e) {
      clearTimeout(tid);
      throw e;
    }
  },
  async post(path: string, body: object, timeout = 8000): Promise<any> {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(BACKEND + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      return await r.json();
    } catch (e) {
      clearTimeout(tid);
      throw e;
    }
  },
  async put(path: string, body: object, timeout = 8000): Promise<any> {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(BACKEND + path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      return await r.json();
    } catch (e) {
      clearTimeout(tid);
      throw e;
    }
  },
  async delete(path: string, timeout = 8000): Promise<any> {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(BACKEND + path, {
        method: 'DELETE',
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      return await r.json();
    } catch (e) {
      clearTimeout(tid);
      throw e;
    }
  },
};

// ── Camera API helper (port 8765) ──
// Used exclusively by CameraPage.tsx
export const cam = {
  async get(path: string, timeout = 3000): Promise<any> {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(CAM_BASE + path, { signal: ctrl.signal });
      clearTimeout(tid);
      return await r.json();
    } catch (e) {
      clearTimeout(tid);
      throw e;
    }
  },
  async post(path: string, body: object, timeout = 5000): Promise<any> {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(CAM_BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      return await r.json();
    } catch (e) {
      clearTimeout(tid);
      throw e;
    }
  },
};

// ── Electron API types ──
declare global {
  interface Window {
    api?: {
      minimize:   () => void;
      maximize:   () => void;
      close:      () => void;
      nav:        (page: string) => void;
      camReq:     (opts: any) => Promise<any>;
      appVer:     () => Promise<string>;
      saveReport: (opts: { name: string; data: string }) => Promise<{ saved: boolean }>;
      invoke:     (channel: string, ...args: any[]) => Promise<any>;
    };
  }
}

export function electronNav(path: string, reactNavigate: (p: string) => void) {
  if (window.api?.nav) window.api.nav(path);
  else reactNavigate('/' + path.replace('.html', ''));
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function fmtISODate(): string {
  return new Date().toISOString().slice(0, 10);
}