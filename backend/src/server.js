// backend/src/server.js
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ── Load camera service ──
let camera;
try {
  camera = require('./camera/camera.service');
} catch (err) {
  console.warn('Camera service load error:', err.message);
  // Fallback inline camera service
  camera = {
    getStatus:      () => ({ ok: true, sdk: false, sdkVersion: 'Unavailable', cameraOpen: false, grabbing: false }),
    getDevices:     () => ({ ok: true, devices: [] }),
    startStream:    () => ({ success: false, error: 'Service unavailable' }),
    stopStream:     () => ({ success: false }),
    getFrame:       () => ({ ok: false, error: 'Service unavailable' }),
    capture:        async () => ({ success: false, error: 'Service unavailable' }),
    calibrate:      async () => ({ success: false, error: 'Service unavailable' }),
    updateSettings: async () => ({ success: false }),
    takeSnapshot:   async () => ({ success: false }),
  };
}

// ── Routes ──
app.get('/health', async (req, res) => {
  try {
    let status = camera.getStatus();
    // Auto-start stream on first health check if not already running
    if (!status.cameraOpen || !status.grabbing) {
      camera.startStream();
      status = camera.getStatus();
    }
    const autoConnected = !!(status.cameraOpen && status.grabbing);
    res.json({ ok: true, autoConnected, cameraFound: status.cameraOpen, simulator: !!status.simulator });
  } catch (e) {
    res.json({ ok: true, autoConnected: false, cameraFound: false });
  }
});

app.get('/status', (req, res) => {
  try { res.json({ ok: true, data: camera.getStatus() }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/devices', (req, res) => {
  try { res.json({ ok: true, data: camera.getDevices() }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/stream/start', async (req, res) => {
  try { res.json({ ok: true, data: camera.startStream() }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/stream/stop', async (req, res) => {
  try { res.json({ ok: true, data: camera.stopStream() }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/frame', (req, res) => {
  try {
    const result = camera.getFrame();
    res.json({ ok: result.ok, data: result });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/capture', async (req, res) => {
  try {
    const { scale = 'HV10', load_kgf = 10 } = req.body;
    const result = await camera.capture(scale, load_kgf);
    res.json({ ok: true, data: result });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/calibrate', async (req, res) => {
  try {
    const { reference = 200, load_kgf = 10 } = req.body;
    const result = await camera.calibrate(reference, load_kgf);
    res.json({ ok: true, data: result });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/settings', async (req, res) => {
  try {
    const result = await camera.updateSettings(req.body);
    res.json({ ok: true, data: result });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/snapshot', async (req, res) => {
  try {
    const result = await camera.takeSnapshot();
    res.json({ ok: true, data: result });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/detect', async (req, res) => {
  try {
    const loadKgf = parseFloat(req.query.loadKgf) || 10;
    const result  = await camera.capture('HV10', loadKgf);
    res.json({ ok: true, data: result });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── Manual connect ──
app.post('/connect', async (req, res) => {
  try {
    await camera._tryConnect();
    const status = camera.getStatus();
    res.json({ ok: true, data: status });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── Start ──
const PORT = process.env.PORT || 8765;
app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});

module.exports = app;