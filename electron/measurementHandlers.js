/**
 * measurementHandlers.js — Electron main process
 *
 * Uses better-sqlite3 (synchronous, no async needed).
 * DB stored at: userData/htp.db
 *
 * IPC channels:
 *   db:measurements:save / getAll / getRecent / delete / clear / stats
 *   db:snapshots:save / getAll / getRecent / getById / delete / clear
 *   db:settings:set / get / getAll
 *   db:calibration:save / history
 */

const { ipcMain, app } = require('electron');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db = null;

function getDb() {
  if (db) return db;

  const dbDir  = app.getPath('userData');
  const dbPath = path.join(dbDir, 'htp.db');
  fs.mkdirSync(dbDir, { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS measurements (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      measured_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      d1_um         REAL, d2_um REAL, d_avg_um REAL,
      d1_px         INTEGER, d2_px INTEGER,
      hv            REAL, hv_converted REAL, convert_to TEXT,
      load_kgf      REAL, pxmm REAL,
      pos_x_px      INTEGER, pos_y_px INTEGER,
      material      TEXT, note TEXT
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      image_data    TEXT    NOT NULL,
      d1_um         TEXT, d2_um TEXT,
      d1_px         REAL, d2_px REAL,
      pxmm          REAL,
      operator      TEXT, material TEXT, note TEXT
    );

    CREATE TABLE IF NOT EXISTS calibration_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      saved_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      px_per_mm     REAL    NOT NULL,
      offset_hv     REAL    NOT NULL DEFAULT 0,
      ref_hv        REAL, revision TEXT, note TEXT
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key           TEXT    PRIMARY KEY,
      value         TEXT    NOT NULL,
      updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);

  return db;
}

function registerMeasurementHandlers() {

  // ── MEASUREMENTS ────────────────────────────────────────────

  ipcMain.handle('db:measurements:save', (_e, m) => {
    try {
      const info = getDb().prepare(`
        INSERT INTO measurements
          (d1_um,d2_um,d_avg_um,d1_px,d2_px,
           hv,hv_converted,convert_to,
           load_kgf,pxmm,pos_x_px,pos_y_px,material,note)
        VALUES
          (@d1_um,@d2_um,@d_avg_um,@d1_px,@d2_px,
           @hv,@hv_converted,@convert_to,
           @load_kgf,@pxmm,@pos_x_px,@pos_y_px,@material,@note)
      `).run({
        d1_um:        m.d1_um        ?? null,
        d2_um:        m.d2_um        ?? null,
        d_avg_um:     m.d_avg_um     ?? null,
        d1_px:        m.d1_px        ?? null,
        d2_px:        m.d2_px        ?? null,
        hv:           m.hv           ?? null,
        hv_converted: m.hv_converted ?? null,
        convert_to:   m.convert_to   ?? null,
        load_kgf:     m.load_kgf     ?? null,
        pxmm:         m.pxmm         ?? null,
        pos_x_px:     m.pos_x_px     ?? null,
        pos_y_px:     m.pos_y_px     ?? null,
        material:     m.material     ?? null,
        note:         m.note         ?? null,
      });
      return { id: info.lastInsertRowid };
    } catch (e) { console.error('[db:measurements:save]', e); throw e; }
  });

  ipcMain.handle('db:measurements:getAll', () => {
    try { return getDb().prepare('SELECT * FROM measurements ORDER BY measured_at DESC').all(); }
    catch (e) { console.error('[db:measurements:getAll]', e); return []; }
  });

  ipcMain.handle('db:measurements:getRecent', (_e, limit = 50) => {
    try { return getDb().prepare('SELECT * FROM measurements ORDER BY measured_at DESC LIMIT ?').all(limit); }
    catch (e) { console.error('[db:measurements:getRecent]', e); return []; }
  });

  ipcMain.handle('db:measurements:delete', (_e, id) => {
    try { getDb().prepare('DELETE FROM measurements WHERE id = ?').run(id); }
    catch (e) { console.error('[db:measurements:delete]', e); throw e; }
  });

  ipcMain.handle('db:measurements:clear', () => {
    try { getDb().prepare('DELETE FROM measurements').run(); }
    catch (e) { console.error('[db:measurements:clear]', e); throw e; }
  });

  ipcMain.handle('db:measurements:stats', () => {
    try {
      const d     = getDb();
      const total = d.prepare('SELECT COUNT(*) as n FROM measurements').get().n;
      const avgHV = d.prepare('SELECT AVG(hv) as v FROM measurements WHERE hv IS NOT NULL').get().v;
      const maxHV = d.prepare('SELECT MAX(hv) as v FROM measurements WHERE hv IS NOT NULL').get().v;
      const minHV = d.prepare('SELECT MIN(hv) as v FROM measurements WHERE hv IS NOT NULL').get().v;
      const today = d.prepare("SELECT COUNT(*) as n FROM measurements WHERE date(measured_at,'unixepoch')=date('now')").get().n;
      return { total, avgHV, maxHV, minHV, today };
    } catch (e) { console.error('[db:measurements:stats]', e); return { total:0, avgHV:null, maxHV:null, minHV:null, today:0 }; }
  });

  // ── SNAPSHOTS ────────────────────────────────────────────────

  ipcMain.handle('db:snapshots:save', (_e, s) => {
    try {
      const d     = getDb();
      const count = d.prepare('SELECT COUNT(*) as n FROM snapshots').get().n;
      if (count >= 20) {
        d.prepare('DELETE FROM snapshots WHERE id IN (SELECT id FROM snapshots ORDER BY captured_at ASC LIMIT ?)').run(count - 19);
      }
      const info = d.prepare(`
        INSERT INTO snapshots (image_data,d1_um,d2_um,d1_px,d2_px,pxmm,operator,material,note)
        VALUES (@image_data,@d1_um,@d2_um,@d1_px,@d2_px,@pxmm,@operator,@material,@note)
      `).run({
        image_data: s.image_data,
        d1_um:      s.d1_um    ?? null,
        d2_um:      s.d2_um    ?? null,
        d1_px:      s.d1_px    ?? null,
        d2_px:      s.d2_px    ?? null,
        pxmm:       s.pxmm     ?? null,
        operator:   s.operator ?? null,
        material:   s.material ?? null,
        note:       s.note     ?? null,
      });
      const total = d.prepare('SELECT COUNT(*) as n FROM snapshots').get().n;
      return { id: Number(info.lastInsertRowid), total };
    } catch (e) { console.error('[db:snapshots:save]', e); throw e; }
  });

  ipcMain.handle('db:snapshots:getAll', () => {
    try {
      return getDb().prepare(`
        SELECT id,captured_at,d1_um,d2_um,d1_px,d2_px,pxmm,operator,material,note
        FROM snapshots ORDER BY captured_at DESC
      `).all();
    } catch (e) { console.error('[db:snapshots:getAll]', e); return []; }
  });

  ipcMain.handle('db:snapshots:getRecent', (_e, limit = 20) => {
    try { return getDb().prepare('SELECT * FROM snapshots ORDER BY captured_at DESC LIMIT ?').all(limit); }
    catch (e) { console.error('[db:snapshots:getRecent]', e); return []; }
  });

  ipcMain.handle('db:snapshots:getById', (_e, id) => {
    try { return getDb().prepare('SELECT * FROM snapshots WHERE id = ?').get(id) ?? null; }
    catch (e) { console.error('[db:snapshots:getById]', e); return null; }
  });

  ipcMain.handle('db:snapshots:delete', (_e, id) => {
    try { getDb().prepare('DELETE FROM snapshots WHERE id = ?').run(id); return { ok: true }; }
    catch (e) { console.error('[db:snapshots:delete]', e); throw e; }
  });

  ipcMain.handle('db:snapshots:clear', () => {
    try { getDb().prepare('DELETE FROM snapshots').run(); return { ok: true }; }
    catch (e) { console.error('[db:snapshots:clear]', e); throw e; }
  });

  // ── APP SETTINGS — key/value store ───────────────────────────

  ipcMain.handle('db:settings:set', (_e, key, value) => {
    try {
      const json = typeof value === 'string' ? value : JSON.stringify(value);
      getDb().prepare(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, strftime('%s','now'))
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
      `).run(key, json);
      return { ok: true };
    } catch (e) { console.error('[db:settings:set]', e); throw e; }
  });

  ipcMain.handle('db:settings:get', (_e, key) => {
    try {
      const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
      if (!row) return null;
      try { return JSON.parse(row.value); } catch { return row.value; }
    } catch (e) { console.error('[db:settings:get]', e); return null; }
  });

  ipcMain.handle('db:settings:getAll', () => {
    try {
      const rows = getDb().prepare('SELECT key, value FROM app_settings').all();
      const out = {};
      for (const row of rows) {
        try { out[row.key] = JSON.parse(row.value); } catch { out[row.key] = row.value; }
      }
      return out;
    } catch (e) { console.error('[db:settings:getAll]', e); return {}; }
  });

  // ── CALIBRATION LOG ──────────────────────────────────────────

  ipcMain.handle('db:calibration:save', (_e, c) => {
    try {
      getDb().prepare(`
        INSERT INTO calibration_log (px_per_mm,offset_hv,ref_hv,revision,note)
        VALUES (@px_per_mm,@offset_hv,@ref_hv,@revision,@note)
      `).run({
        px_per_mm: c.px_per_mm,
        offset_hv: c.offset_hv,
        ref_hv:    c.ref_hv    ?? null,
        revision:  c.revision  ?? null,
        note:      c.note      ?? null,
      });
    } catch (e) { console.error('[db:calibration:save]', e); throw e; }
  });

  ipcMain.handle('db:calibration:history', () => {
    try { return getDb().prepare('SELECT * FROM calibration_log ORDER BY saved_at DESC LIMIT 100').all(); }
    catch (e) { return []; }
  });
}

function closeMeasurementDb() {
  if (db) { db.close(); db = null; }
}

module.exports = { registerMeasurementHandlers, closeMeasurementDb };