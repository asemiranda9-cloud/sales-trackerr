'use strict';
// Electron shell. NOT tested on Windows yet (cannot be built on the Linux machine this was written on).
const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const path = require('path'); const fs = require('fs'); const http = require('http');
const { startHost } = require('./src/server');
let win = null, host = null, setupWin = null;
const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
const loadCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { return null; } };
const saveCfg = (c) => { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 2)); };
const defaultDataDir = () => (process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'SalesTrackerData') : path.join(app.getPath('documents'), 'SalesTrackerData'));
const lanIPs = () => Object.values(require('os').networkInterfaces()).flat().filter((i) => i.family === 'IPv4' && !i.internal).map((i) => i.address);
function ping(url) { return new Promise((ok) => { const r = http.get(url + '/api/state', (res) => { res.resume(); ok(res.statusCode === 200); }); r.on('error', () => ok(false)); r.setTimeout(4000, () => { r.destroy(); ok(false); }); }); }

function askMode(prev) {
  return new Promise((resolve) => {
    setupWin = new BrowserWindow({ width: 560, height: 520, resizable: false, autoHideMenuBar: true, title: 'Sales Tracker setup', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
    setupWin.loadFile(path.join(__dirname, 'ui', 'setup.html'));
    ipcMain.removeHandler('setup:init'); ipcMain.removeHandler('setup:save'); ipcMain.removeHandler('setup:pick');
    ipcMain.handle('setup:init', () => ({ prev, defaultDataDir: defaultDataDir() }));
    ipcMain.handle('setup:pick', async () => { const r = await dialog.showOpenDialog(setupWin, { properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
    ipcMain.handle('setup:save', async (e, c) => { if (c.mode === 'client') { if (!(await ping(c.hostUrl))) return { error: 'Cannot reach the host at that address. Check the address, that the host PC is running Sales Tracker, and that its firewall allows the port.' }; } resolve(c); setupWin.destroy(); return { ok: true }; });
    setupWin.on('closed', () => resolve(null));
  });
}
async function launch(cfg) {
  let url;
  if (cfg.mode === 'host') { fs.mkdirSync(cfg.dataDir, { recursive: true }); host = await startHost({ file: path.join(cfg.dataDir, 'sales-tracker.sqlite'), port: cfg.port || 3737 }); url = `http://127.0.0.1:${host.port}`; }
  else url = cfg.hostUrl;
  win = new BrowserWindow({ width: 1366, height: 820, minWidth: 900, minHeight: 600, title: 'Sales Tracker', icon: path.join(__dirname, 'build', 'icon.png'), webPreferences: { contextIsolation: true, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); win.webContents.on('will-navigate', (e, u) => { if (!u.startsWith(url)) e.preventDefault(); });
  win.webContents.on('did-fail-load', () => win.loadURL('data:text/html,<body style="font:16px Segoe UI;padding:40px"><h2>Cannot reach the host PC</h2><p>Check that the host PC is on and running Sales Tracker, then use File &gt; Restart.</p>'));
  await win.loadURL(url); win.on('closed', () => { win = null; });
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'File', submenu: [
    ...(cfg.mode === 'host' ? [{ label: 'Show address for other PCs', click: () => dialog.showMessageBox({ message: 'Other PCs connect to:', detail: lanIPs().map((i) => `http://${i}:${host.port}`).join('\n') || 'No network found' }) }, { label: 'Open data folder', click: () => shell.openPath(cfg.dataDir) }] : []),
    { label: 'Change mode (Host / Client)...', click: async () => { const c = await askMode(cfg); if (c) { saveCfg(c); app.relaunch(); app.exit(0); } } }, { type: 'separator' }, { role: 'quit' }] }, { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] }]));
}
if (!app.requestSingleInstanceLock()) app.quit(); else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    let cfg = loadCfg(); if (!cfg) { cfg = await askMode(null); if (!cfg) return app.quit(); saveCfg(cfg); }
    try { await launch(cfg); } catch (e) { dialog.showErrorBox('Sales Tracker could not start', String(e.message || e) + (e.code === 'EADDRINUSE' ? '\n\nPort already in use. Is Sales Tracker already running?' : '')); app.quit(); }
  });
  app.on('window-all-closed', async () => { if (host) await host.close(); app.quit(); });
}
