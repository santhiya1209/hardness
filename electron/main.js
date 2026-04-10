const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path        = require('path');
const fs          = require('fs');
const { spawn }   = require('child_process');
const { registerMeasurementHandlers, closeMeasurementDb } = require('./measurementHandlers');

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

// Use a stable writable runtime path to avoid cache permission noise on Windows.
const APP_RUNTIME_ROOT = path.join(process.env.TEMP || 'C:\\Temp', 'HardnessTesterPro');
try {
  fs.mkdirSync(path.join(APP_RUNTIME_ROOT, 'userData'), { recursive: true });
  fs.mkdirSync(path.join(APP_RUNTIME_ROOT, 'cache'), { recursive: true });
  app.setPath('userData', path.join(APP_RUNTIME_ROOT, 'userData'));
  app.setPath('cache', path.join(APP_RUNTIME_ROOT, 'cache'));
} catch (_) {}

// ── Set ALL required MVS env vars BEFORE loading the addon ───────
// GENICAM_GENTL64_PATH tells the SDK where to find MvProducerU3V.cti
// Without it MV_CC_EnumDevices returns 0 even if the driver is correct.
const MVS_RUNTIME = 'C:\\Program Files (x86)\\Common Files\\MVS\\Runtime\\Win64_x64';
const ADDON_DIR   = path.join(__dirname, '../backend/build/Release');

process.env.PATH = MVS_RUNTIME + ';' + ADDON_DIR + ';' + (process.env.PATH || '');

// Always force-set GenTL path — terminal sessions may not have inherited it.
// Strip any non-MVS paths (e.g. Do3think DVP2) to prevent their CTI files from
// loading inside EnumDevices and triggering MV_E_LOAD_LIBRARY (0x8000000C).
const existingGenTL = (process.env.GENICAM_GENTL64_PATH || '')
  .split(';')
  .filter(p => p && !p.toLowerCase().includes('do3think') && !p.toLowerCase().includes('dvp2'))
  .join(';');
process.env.GENICAM_GENTL64_PATH = MVS_RUNTIME + (existingGenTL ? ';' + existingGenTL : '');
process.env.GENICAM_GENTL32_PATH =
  'C:\\Program Files (x86)\\Common Files\\MVS\\Runtime\\Win32_i86' + ';' +
  (process.env.GENICAM_GENTL32_PATH || '');

console.log('[main] GENICAM_GENTL64_PATH:', process.env.GENICAM_GENTL64_PATH);

// ── Load native Hikrobot addon directly in main process ───────────
// Running in Electron main (not a forked child) avoids USB access issues.
let cam = null;
try {
  cam = require(path.join(ADDON_DIR, 'hikrobot_camera.node'));
  console.log('[main] Hikrobot addon loaded');
} catch (err) {
  console.error('[main] Addon load failed:', err.message);
}

// ── Camera state ──────────────────────────────────────────────────
let autoConnected      = false;
let driverFixAttempted = false;
let pollTimer          = null;
let accessDeniedCount  = 0;
let accessDeniedShown  = false;
let detectedDeviceKey  = '';
let lastStartErr       = '';
let startErrRepeats    = 0;

function safeCall(fn, ...args) {
  try { return fn(...args); }
  catch (e) { return { ok: false, error: e.message }; }
}

function isAccessDeniedErr(errMsg) {
  const s = String(errMsg || '').toLowerCase();
  return s.includes('0x80000203') || s.includes('access denied') || s.includes('mv_e_access');
}

function logStartFailure(errMsg) {
  const msg = String(errMsg || 'Unknown stream start error');
  if (msg === lastStartErr) {
    startErrRepeats += 1;
    if (startErrRepeats === 3 || startErrRepeats % 10 === 0) {
      console.warn(`[main] streamStart still failing (x${startErrRepeats}):`, msg);
    }
    return;
  }
  lastStartErr = msg;
  startErrRepeats = 1;
  console.warn('[main] streamStart failed:', msg);
}

function logStartRecovered() {
  if (startErrRepeats > 1) {
    console.log(`[main] Camera streaming (recovered after ${startErrRepeats} retries)`);
  } else {
    console.log('[main] Camera streaming');
  }
  lastStartErr = '';
  startErrRepeats = 0;
}

async function promptAccessDeniedFix() {
  if (accessDeniedShown || !mainWindow) return;
  accessDeniedShown = true;

  const fixScript = path.join(__dirname, '../fix-camera-driver.ps1');
  const canFix = fs.existsSync(fixScript);

  const choice = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Camera Access Denied',
    message: 'Hikrobot camera was detected, but open was denied (0x80000203).',
    detail:
      'This usually means camera access is blocked by Windows permissions or another process.\n\n' +
      '1) Close MVS and all camera apps.\n' +
      '2) Unplug/replug camera.\n' +
      (canFix ? '3) Click "Run Fix Now" to apply USB permission fix (Admin prompt).\n' : ''),
    buttons: canFix ? ['Run Fix Now', 'Retry Later'] : ['OK'],
    defaultId: 0,
  });

  if (canFix && choice.response === 0) {
    const fixArg = fixScript.replace(/\\/g, '\\\\');
    spawn('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \\"${fixArg}\\"' -Verb RunAs -Wait`,
    ], { shell: true, detached: true, stdio: 'ignore' }).unref();
  }
}

// ── Initial connect + polling ─────────────────────────────────────
function startCameraPoll() {
  if (pollTimer) clearInterval(pollTimer);

  const poll = () => {
    if (!cam) return;
    try {
      const devices = cam.enumDevices();
      const count   = Array.isArray(devices) ? devices.length : 0;
      const first   = count > 0 ? devices[0] : null;
      const key     = first ? `${first.model || ''}|${first.serial || ''}|${first.ipAddress || ''}` : '';

      if (key && key !== detectedDeviceKey) {
        detectedDeviceKey = key;
        console.log('[main] Camera found:', first.model || 'USB3 Vision');
      }
      if (!key) detectedDeviceKey = '';

      if (count > 0 && !autoConnected) {
        safeCall(cam.streamStop);
        const r = safeCall(cam.streamStart);
        if (r && r.ok) {
          accessDeniedCount = 0;
          accessDeniedShown = false;
          autoConnected = true;
          logStartRecovered();
        } else {
          logStartFailure(r && r.error);
          if (isAccessDeniedErr(r && r.error)) {
            accessDeniedCount++;
            if (accessDeniedCount >= 2) {
              promptAccessDeniedFix().catch(() => {});
            }
          }
        }
      } else if (count === 0 && autoConnected) {
        console.log('[main] Camera unplugged');
        safeCall(cam.streamStop);
        autoConnected = false;
        lastStartErr = '';
        startErrRepeats = 0;
        accessDeniedCount = 0;
        accessDeniedShown = false;
      }
    } catch (_) {}
  };

  poll();                                    // run immediately
  pollTimer = setInterval(poll, 3000);
}

// ── Route camera API calls directly to the native addon ──────────
function handleCam(method, urlPath, body) {
  if (!cam) return { ok: false, error: 'Camera addon not loaded' };

  if (urlPath === '/health') {
    const d = safeCall(cam.enumDevices);
    return { ok: true, cameraFound: Array.isArray(d) && d.length > 0, autoConnected };
  }

  if (urlPath === '/devices') {
    const d = safeCall(cam.enumDevices);
    return { ok: true, data: { devices: Array.isArray(d) ? d : [] } };
  }

  if (urlPath === '/status') {
    const s = safeCall(cam.getStatus);
    return { ok: true, data: { ...(s || {}), autoConnected } };
  }

  if (urlPath === '/stream/start') {
    const d = safeCall(cam.enumDevices);
    if (!Array.isArray(d) || d.length === 0)
      return { ok: false, error: 'No cameras found — check USB cable.' };
    if (autoConnected) {
      const st   = safeCall(cam.getStatus);
      const reso = (st && st.params && st.params.resolution) || '3072x2048';
      return { ok: true, data: { cam_info: { resolution: reso } } };
    }
    safeCall(cam.streamStop);
    const r = safeCall(cam.streamStart);
    if (r && r.ok) {
      autoConnected = true;
      return { ok: true, data: { cam_info: (r.cam_info) || { resolution: '3072x2048' } } };
    }
    return { ok: false, error: (r && r.error) || 'Stream start failed' };
  }

  if (urlPath === '/stream/stop') {
    safeCall(cam.streamStop);
    autoConnected = false;
    return { ok: true };
  }

  if (urlPath === '/frame') {
    const r = safeCall(cam.getFrame);
    if (r && r.ok) return { ok: true, data: r };
    return { ok: false, error: (r && r.error) || 'No frame' };
  }

  if (urlPath === '/settings') {
    const r = safeCall(cam.setSettings, body || {});
    return { ok: !!(r && r.ok !== false) };
  }

  if (urlPath === '/capture') {
    const b = body || {};
    const r = safeCall(cam.capture, {
      load_kgf:  b.load_kgf  || 10,
      px_per_mm: b.px_per_mm || 100,
      canny_t1:  b.canny_t1  || 0,
      canny_t2:  b.canny_t2  || 0,
    });
    if (r && r.ok) return { ok: true, data: r };
    return { ok: false, error: (r && r.error) || 'Detection failed' };
  }

  if (urlPath === '/calibrate') {
    const b = body || {};
    const r = safeCall(cam.calibrate, { ref_hv: b.reference || 200, load_kgf: b.load_kgf || 10 });
    return { ok: true, data: r };
  }

  return { ok: false, error: 'Unknown path: ' + urlPath };
}

// ── Auto-fix driver if camera still not found after 10s ───────────
function scheduleDriverFix() {
  setTimeout(async () => {
    if (driverFixAttempted || autoConnected || !mainWindow) return;

    const d = cam ? safeCall(cam.enumDevices) : [];
    if (Array.isArray(d) && d.length > 0) return;

    driverFixAttempted = true;
    console.log('[main] Camera not found — showing fix dialog');

    const fixScript = path.join(__dirname, '../fix-camera-driver.ps1');
    if (!fs.existsSync(fixScript)) {
      console.warn('[main] fix-camera-driver.ps1 not found');
      return;
    }

    const choice = await dialog.showMessageBox(mainWindow, {
      type:      'warning',
      title:     'Hikrobot Camera Not Accessible',
      message:   'Camera is plugged in but not detected.',
      detail:    'A one-time USB driver permission fix is needed.\n\nClick "Fix Now" — a Windows Admin prompt will appear. Click Yes.\n\nAfter the fix, unplug and replug the USB camera cable.',
      buttons:   ['Fix Now', 'Later'],
      defaultId: 0,
    });

    if (choice.response !== 0) return;

    const fixArg = fixScript.replace(/\\/g, '\\\\');
    spawn('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \\"${fixArg}\\"' -Verb RunAs -Wait`,
    ], { shell: true, detached: true, stdio: 'ignore' }).unref();

    setTimeout(() => {
      if (!mainWindow) return;
      dialog.showMessageBox(mainWindow, {
        type:    'info',
        title:   'Fix Applied',
        message: 'Unplug the camera USB cable → wait 3 seconds → plug it back in.',
        detail:  'Camera will connect automatically. No restart needed.',
        buttons: ['OK'],
      });
    }, 5000);
  }, 10000);
}

// ── Windows ───────────────────────────────────────────────────────
let mainWindow   = null;
let splashWindow = null;

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 520, height: 380,
    frame: false, resizable: false,
    alwaysOnTop: true, center: true,
    backgroundColor: '#020d18',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.on('closed', () => { splashWindow = null; });
}

function createMainWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  const hasPreload  = fs.existsSync(preloadPath);

  mainWindow = new BrowserWindow({
    width: 1400, height: 900,
    minWidth: 1024, minHeight: 700,
    show: false,
    backgroundColor: '#0c4a6e',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      webSecurity:      false,
      preload: hasPreload ? preloadPath : undefined,
    },
  });

  mainWindow.loadURL('http://localhost:5173');

  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      if (splashWindow) splashWindow.close();
      mainWindow.show();
      mainWindow.focus();
    }, 3500);
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('[main] Page load failed:', code, desc);
    setTimeout(() => { if (mainWindow) mainWindow.loadURL('http://localhost:5173'); }, 2000);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── IPC: window controls ──────────────────────────────────────────
ipcMain.on('minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('close', () => mainWindow && mainWindow.close());
ipcMain.handle('appVer', () => app.getVersion());

// ── IPC: camera (direct addon, no HTTP) ──────────────────────────
ipcMain.handle('camReq', async (_event, opts) => {
  const result = handleCam(opts.method || 'GET', opts.path || '/status', opts.body);
  return { ok: result.ok, data: result };
});

// ── IPC: save report ──────────────────────────────────────────────
ipcMain.handle('saveReport', async (_event, opts) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: opts.name || 'report.csv',
    filters: [
      { name: 'CSV',  extensions: ['csv']  },
      { name: 'JSON', extensions: ['json'] },
    ],
  });
  if (result.canceled) return { saved: false };
  fs.writeFileSync(result.filePath, opts.data);
  return { saved: true, path: result.filePath };
});

// ── App ready ─────────────────────────────────────────────────────
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'camera', 'microphone', 'video', 'mediaKeySystem'].includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    ['media', 'camera', 'microphone', 'video'].includes(permission)
  );
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Access-Control-Allow-Origin':  ['*'],
        'Access-Control-Allow-Methods': ['GET, POST, PUT, DELETE, OPTIONS'],
        'Access-Control-Allow-Headers': ['Content-Type, Authorization'],
      },
    });
  });

  registerMeasurementHandlers();
  startCameraPoll();       // start polling camera in main process
  scheduleDriverFix();     // offer fix if no camera after 10s

  createSplash();
  setTimeout(createMainWindow, 500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (pollTimer) clearInterval(pollTimer);
  if (cam) try { cam.streamStop(); } catch (_) {}
  closeMeasurementDb();
});
