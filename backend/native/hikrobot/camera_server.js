const path    = require('path');
const express = require('express');
const cors    = require('cors');

const MVS_RUNTIME = 'C:\\Program Files (x86)\\Common Files\\MVS\\Runtime\\Win64_x64';
const ADDON_DIR   = path.join(__dirname, '../../build/Release');

process.env.PATH = MVS_RUNTIME + ';' + ADDON_DIR + ';' + (process.env.PATH || '');

// Required for USB3 Vision camera discovery via GenTL producer (MvProducerU3V.cti)
process.env.GENICAM_GENTL64_PATH = MVS_RUNTIME + ';' + (process.env.GENICAM_GENTL64_PATH || '');
process.env.GENICAM_GENTL32_PATH =
  'C:\\Program Files (x86)\\Common Files\\MVS\\Runtime\\Win32_i86' + ';' +
  (process.env.GENICAM_GENTL32_PATH || '');

let cam;
try {
  cam = require(path.join(ADDON_DIR, 'hikrobot_camera.node'));
  console.log('[camera_server] Addon loaded');
} catch (err) {
  console.error('[camera_server] Failed to load addon:', err.message);
  process.exit(1);
}
const app = express();
app.use(cors());
app.use(express.json());

function safeCall(fn) {
  var args = Array.prototype.slice.call(arguments, 1);
  try { return fn.apply(null, args); }
  catch(err) { return { ok: false, error: err.message }; }
}

var autoConnected = false;
var pollCount     = 0;
var lastDevCount  = -1;

function autoPoll() {
  try {
    var devices = cam.enumDevices();
    var count = Array.isArray(devices) ? devices.length : 0;
    pollCount++;

    // Log every 10 polls (~30s) when no camera found, so user can see it's trying
    if (count === 0 && pollCount % 10 === 1) {
      console.log('[camera_server] Waiting for camera... (poll #' + pollCount + ')');
      console.log('[camera_server] If camera is plugged in but not detected:');
      console.log('[camera_server]   Run fix-camera-driver.ps1 as Administrator, then replug USB.');
    }

    if (count !== lastDevCount) {
      lastDevCount = count;
      console.log('[camera_server] Device count changed: ' + count + ' camera(s) found');
    }

    if (count > 0 && !autoConnected) {
      console.log('[camera_server] Camera detected: ' + (devices[0].model || 'USB3 Vision') + ' — connecting...');
      // Clean up any stale handle before connecting
      safeCall(cam.streamStop);
      var result = safeCall(cam.streamStart);
      if (result && result.ok) {
        autoConnected = true;
        console.log('[camera_server] Connected successfully');
      } else {
        var errMsg = (result && result.error) || 'unknown error';
        console.warn('[camera_server] Connect failed: ' + errMsg);
        if (errMsg.indexOf('admin') !== -1 || errMsg.indexOf('Access') !== -1 || errMsg.indexOf('denied') !== -1) {
          console.warn('[camera_server] ACCESS DENIED — run fix-camera-driver.ps1 as Administrator.');
        }
      }
    } else if (count === 0 && autoConnected) {
      console.log('[camera_server] Camera unplugged — stopping stream');
      safeCall(cam.streamStop);
      autoConnected = false;
    }
  } catch(e) {
    console.error('[camera_server] Poll error:', e.message);
  }
}

autoPoll();
setInterval(autoPoll, 3000);

app.post('/stream/start', function(req, res) {
  var devices = safeCall(cam.enumDevices);
  var count = Array.isArray(devices) ? devices.length : 0;
  console.log('[camera_server] /stream/start: ' + count + ' device(s)');
  if (count === 0) {
    return res.status(500).json({ ok: false, error: 'No cameras found. Check USB cable.' });
  }
  if (autoConnected) {
    var st = safeCall(cam.getStatus);
    var reso = (st && st.params && st.params.resolution) ? st.params.resolution : '';
    return res.json({ ok: true, data: { cam_info: { resolution: reso } } });
  }
  var result = safeCall(cam.streamStart);
  if (result.ok) {
    autoConnected = true;
    res.json({ ok: true, data: { cam_info: result.cam_info || {} } });
  } else {
    res.status(500).json({ ok: false, error: result.error || 'Stream start failed' });
  }
});

app.post('/stream/stop', function(req, res) {
  safeCall(cam.streamStop);
  autoConnected = false;
  res.json({ ok: true });
});

app.get('/frame', function(req, res) {
  var r = safeCall(cam.getFrame);
  if (r.ok) {
    res.json({ ok: true, data: { frame: r.frame, format: r.format || 'jpeg', width: r.width, height: r.height, frameNum: r.frameNum } });
  } else {
    res.status(503).json({ ok: false, error: r.error || 'No frame' });
  }
});

app.post('/settings', function(req, res) {
  var r = safeCall(cam.setSettings, req.body || {});
  res.json({ ok: r.ok !== false, error: r.error || '' });
});

app.post('/capture', function(req, res) {
  var body = req.body || {};
  var r = safeCall(cam.capture, {
    load_kgf:  body.load_kgf  || 10,
    px_per_mm: body.px_per_mm || 100,
    canny_t1:  body.canny_t1  || 0,
    canny_t2:  body.canny_t2  || 0
  });
  if (r.ok) {
    res.json({ ok: true, data: {
      hv: r.hv, d1_mm: r.d1_mm, d2_mm: r.d2_mm,
      d_mean_mm: r.d_mean_mm, confidence: r.confidence, px_per_mm: r.px_per_mm,
      // Normalised overlay coords (0-1 of original image)
      cx_frac: r.cx_frac, cy_frac: r.cy_frac,
      lx_frac: r.lx_frac, ly_frac: r.ly_frac,
      rx_frac: r.rx_frac, ry_frac: r.ry_frac,
      tx_frac: r.tx_frac, ty_frac: r.ty_frac,
      bx_frac: r.bx_frac, by_frac: r.by_frac,
      img_w: r.img_w, img_h: r.img_h
    }});
  } else {
    res.status(422).json({ ok: false, error: r.error || 'Detection failed' });
  }
});

app.get('/status', function(req, res) {
  var s = safeCall(cam.getStatus);
  if (s && typeof s === 'object') s.autoConnected = autoConnected;
  res.json({ ok: true, data: s });
});

app.get('/devices', function(req, res) {
  var d = safeCall(cam.enumDevices);
  res.json({ ok: true, data: { devices: Array.isArray(d) ? d : [] } });
});

app.get('/health', function(req, res) {
  var d = safeCall(cam.enumDevices);
  res.json({ ok: true, cameraFound: Array.isArray(d) && d.length > 0, autoConnected: autoConnected });
});

app.get('/diagnose', function(req, res) {
  var devices = safeCall(cam.enumDevices);
  var status  = safeCall(cam.getStatus);
  var isAdmin = false;
  try {
    // Check if running as admin by testing a privileged path
    require('fs').readdirSync('C:\\Windows\\System32\\config');
    isAdmin = true;
  } catch(e) { isAdmin = false; }

  res.json({
    ok: true,
    runningAsAdmin: isAdmin,
    devicesFound: Array.isArray(devices) ? devices.length : 0,
    devices: Array.isArray(devices) ? devices : [],
    autoConnected: autoConnected,
    status: status,
    advice: Array.isArray(devices) && devices.length === 0
      ? isAdmin
        ? 'Running as admin but no cameras found — check USB cable and driver installation.'
        : 'NOT running as admin — run fix-camera-driver.ps1 as Administrator, then replug USB.'
      : 'Camera found.',
  });
});

app.listen(8765, '127.0.0.1', function() {
  console.log('[camera_server] Running on http://localhost:8765');
  console.log('[camera_server] Auto-polling every 3s - plug in camera anytime');
});

process.on('SIGTERM', function() { safeCall(cam.streamStop); process.exit(0); });
process.on('SIGINT',  function() { safeCall(cam.streamStop); process.exit(0); });
