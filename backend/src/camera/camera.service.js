// backend/src/camera/camera.service.js
// Camera service - uses native HikRobot addon or simulator fallback

const path   = require('path');
const logger = { info: console.log, warn: console.warn, error: console.error };

// ── Try to load native addon ──
let native       = null;
let useSimulator = false;

try {
  const addonPath = path.join(__dirname, '../../build/Release/hikrobot_camera.node');
  native = require(addonPath);
  logger.info('HikRobot native addon loaded');
} catch (err) {
  logger.warn('Native addon not available, using simulator: ' + err.message);
  useSimulator = true;
}

// ── Simulator state (no image — just returns blank frame data) ──
const sim = {
  open:       false,
  grabbing:   false,
  frameCount: 0,
  exposureUs: 10000,
  gainDb:     0,
  width:      1280,
  height:     1024,
  px_per_mm:  100.0,
  offset_hv:  0.0,
};

// Minimal 1×1 white JPEG as placeholder when no camera and no sample image
// This prevents the "sample.jpg not found" error entirely
const BLANK_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U' +
  'HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARC' +
  'AABAAEDASIA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/' +
  'xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/' +
  'aAAwDAQACEQMRAD8AJQAB/9k=';

class CameraService {
  constructor() {
    this.initialized = false;
    this._reconnectTimer = null;
    this._init();
  }

  async _init() {
    if (useSimulator) {
      this.initialized = true;
      logger.info('Camera simulator ready (no physical camera detected)');
      return;
    }
    await this._tryConnect();
    // Retry every 5 seconds if not connected
    this._reconnectTimer = setInterval(() => {
      if (useSimulator || !native) return;
      try {
        const status = native.getStatus();
        if (!status.cameraOpen) this._tryConnect();
      } catch {}
    }, 5000);
  }

  destroy() {
    if (this._reconnectTimer) {
      clearInterval(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  async _tryConnect() {
    try {
      const devices = native.enumDevices();
      if (devices && devices.length > 0) {
        const res = native.streamStart();
        if (res && res.ok) {
          useSimulator = false;
          this.initialized = true;
          logger.info('✅ Camera connected: ' + devices[0].model + ' S/N:' + devices[0].serial);
        } else {
          logger.warn('Could not open camera — check USB/GigE connection');
          useSimulator = true;
          this.initialized = true;
        }
      } else {
        logger.warn('No HikRobot cameras found — is the camera plugged in?');
        useSimulator = true;
        this.initialized = true;
      }
    } catch (err) {
      logger.error('Camera init error: ' + err.message);
      useSimulator = true;
      this.initialized = true;
    }
  }

  // ── Status ──
  getStatus() {
    if (useSimulator) {
      return {
        ok:         true,
        sdk:        false,
        sdkVersion: 'Simulator',
        cameraOpen: sim.open,
        grabbing:   sim.grabbing,
        simulator:  true,
        device: { model: 'No camera — connect HikRobot camera', serial: '', type: '' },
        params: {
          exposure_us: sim.exposureUs,
          gain_db:     sim.gainDb,
          width:       sim.width,
          height:      sim.height,
        },
        px_per_mm: sim.px_per_mm,
        offset:    sim.offset_hv,
      };
    }
    try {
      const s = native.getStatus();
      return { ok: true, simulator: false, ...s };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // ── Devices ──
  getDevices() {
    if (useSimulator) {
      return { ok: true, devices: [] };
    }
    try {
      return { ok: true, devices: native.enumDevices() };
    } catch (err) {
      return { ok: false, devices: [], error: err.message };
    }
  }

  // ── Start stream ──
  startStream() {
    if (useSimulator) {
      sim.open     = true;
      sim.grabbing = true;
      logger.warn('Simulator stream started — connect a real HikRobot camera for live feed');
      return {
        ok:       true,
        success:  true,
        cam_info: { model: 'Simulator', resolution: `${sim.width}x${sim.height}` },
      };
    }
    try {
      const res = native.streamStart();
      return { ok: res.ok, ...res };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // ── Stop stream ──
  stopStream() {
    if (useSimulator) {
      sim.grabbing = false;
      return { ok: true };
    }
    try {
      native.streamStop();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // ── Get frame ──
  // Returns blank JPEG when in simulator mode (no sample.jpg needed)
  getFrame() {
    if (useSimulator) {
      sim.frameCount++;
      return {
        ok:        true,
        success:   true,
        frame:     BLANK_JPEG_B64,
        width:     sim.width,
        height:    sim.height,
        frameNum:  sim.frameCount,
        timestamp: Date.now(),
        simulator: true,
      };
    }
    try {
      const res = native.getFrame();
      return { ok: res.ok, ...res };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // ── Capture + Measure ──
  async capture(scale, loadKgf) {
    if (useSimulator) {
      // Simulator returns placeholder values — real measurement needs camera
      logger.warn('Capture called in simulator mode — no real measurement possible');
      return {
        success:    false,
        error:      'No camera connected — please connect a HikRobot camera',
        simulator:  true,
      };
    }
    try {
      const pxPerMm = sim.px_per_mm;
      const res = native.capture({ load_kgf: loadKgf, px_per_mm: pxPerMm });
      return { success: res.ok, ...res };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ── Calibrate ──
  async calibrate(refHV, loadKgf) {
    if (useSimulator) {
      return { success: false, error: 'No camera connected — cannot calibrate' };
    }
    try {
      const res = native.calibrate({ ref_hv: refHV, load_kgf: loadKgf });
      if (res.success) {
        sim.px_per_mm = res.px_per_mm;
        sim.offset_hv = res.offset_hv;
      }
      return {
        success:   res.success,
        px_per_mm: res.px_per_mm,
        offset:    res.offset_hv,
        measured:  res.measured_hv,
        error_pct: res.error_pct,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ── Update settings ──
  async updateSettings(settings) {
    if (useSimulator) {
      if (settings.exposure_us != null) sim.exposureUs = settings.exposure_us;
      if (settings.gain_db     != null) sim.gainDb     = settings.gain_db;
      if (settings.width)               sim.width      = settings.width;
      if (settings.height)              sim.height     = settings.height;
      return { ok: true };
    }
    try {
      const res = native.setSettings({
        exposure_us: settings.exposure_us,
        gain_db:     settings.gain_db,
        gamma:       settings.gamma,
        contrast:    settings.contrast,
        black_level: settings.black_level,
        resolution:  settings.resolution,
        res_mode:    settings.res_mode,
      });
      return { ok: res.ok };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // ── Snapshot ──
  async takeSnapshot() {
    const frame = this.getFrame();
    if (!frame.ok) return { success: false, error: 'No frame available' };
    return {
      success: true,
      snapshot: {
        data:      frame.frame,
        width:     frame.width,
        height:    frame.height,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

module.exports = new CameraService();