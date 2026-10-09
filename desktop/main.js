// PromptGuard PH desktop guard (Electron main process).
//
// 1. Keeps the local gateway running (and reports whether the local LLM is up).
// 2. Watches which app is in front. When it is an AI app (desktop app, or an AI site in any browser),
//    the clipboard is swapped for a sanitized copy; when the user leaves, the original is put back.
//    Every app is guarded unless desktop/apps.json lists it as trusted.
// 3. Shows a tray icon and a small status window. Notices name types and counts, never values.
'use strict';
const { app, BrowserWindow, Tray, Menu, Notification, clipboard, nativeImage, ipcMain, shell, screen } = require('electron');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const readline = require('readline');
const { ClipboardGuard, classify } = require('./guard');

const ROOT = path.join(__dirname, '..');
const GATEWAY = 'http://127.0.0.1:8787';
const APPS = require('./apps.json');
const DEV = process.argv.includes('--dev');
const SMOKE = process.argv.includes('--smoke');
const SHOT = (process.argv.find((a) => a.startsWith('--mascot-shot=')) || '').split('=')[1];   // development: save a picture of the mascot
const POINT = (process.argv.find((a) => a.startsWith('--mascot-point=')) || '').split('=')[1]; // development: hold the pointer at fx,fy

const state = { gateway: false, llm: false, model: '', llmReason: '', focus: '', guarding: false, startedGateway: false, events: [],
  sensors: [], browserInFront: '', sensorMissing: false };
let tray = null, win = null, mascot = null, gatewayProc = null, focusProc = null, guard = null;

// ---------------------------------------------------------------- gateway
async function call(route, body) {
  const res = await fetch(GATEWAY + route, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error('gateway ' + res.status);
  return res.json();
}

async function job(route, body) {
  const started = await call(route, { ...body, background: true });
  if (!started.job) return started;
  for (let i = 0; i < 1200; i++) {
    await new Promise((ok) => setTimeout(ok, 400));
    const r = await call('/job/' + started.job);
    if (r.done) return r.result;
  }
  throw new Error('check timed out');
}

const SESSION = 'desktop-' + crypto.randomUUID();
const scanText = (text) => job('/scan', { session_id: SESSION, text, llm: true, site: 'desktop' });
const scanFile = (name, data) => job('/scan-file', { session_id: SESSION, filename: name, data_b64: data.toString('base64'), llm: true, site: 'desktop' });

async function checkHealth() {
  try {
    const h = await call('/health');
    Object.assign(state, { gateway: true, llm: !!h.llm.available, model: h.llm.model, llmReason: h.llm.reason || '', sensors: h.sensors || [] });
  } catch (_) {
    Object.assign(state, { gateway: false, llm: false });
  }
  publish();
  return state.gateway;
}

// When the gateway's code on disk was last changed.
function gatewayCodeTime() {
  const dir = path.join(ROOT, 'gateway');
  return Math.max(...fs.readdirSync(dir).filter((f) => f.endsWith('.py')).map((f) => fs.statSync(path.join(dir, f)).mtimeMs / 1000));
}

const run = (file, args) => new Promise((resolve) => execFile(file, args, { windowsHide: true }, (_err, out) => resolve(String(out || ''))));

/** A gateway left running from an earlier session keeps its old rules. If it is older than the code, replace it. */
async function stopStaleGateway() {
  let health;
  try { health = await call('/health'); } catch (_) { return; }
  if (health.started && health.started >= gatewayCodeTime()) return;          // up to date
  let pid = health.pid;
  if (!pid) {                                                                // too old to report its own process id
    const out = await run('powershell.exe', ['-NoProfile', '-Command', '(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess']);
    pid = parseInt(out.trim(), 10);
  }
  if (!pid) return;
  await run('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
  for (let i = 0; i < 20; i++) {
    try { await call('/health'); } catch (_) { return; }
    await new Promise((ok) => setTimeout(ok, 250));
  }
}

let starting = false;
async function ensureGateway() {
  if (starting) return;
  starting = true;
  try {
    await stopStaleGateway();
    if (await checkHealth()) return;
    gatewayProc = spawn('python', ['-m', 'uvicorn', 'app:app', '--app-dir', 'gateway', '--host', '127.0.0.1', '--port', '8787'],
      { cwd: ROOT, windowsHide: true, stdio: 'ignore' });
    state.startedGateway = true;
    gatewayProc.on('exit', () => { gatewayProc = null; });
    for (let i = 0; i < 40 && !(await checkHealth()); i++) await new Promise((ok) => setTimeout(ok, 500));
  } finally {
    starting = false;
  }
}

// ---------------------------------------------------------------- clipboard
const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

function readClipboard() {
  const formats = clipboard.availableFormats();
  let hasFiles = formats.includes('text/uri-list');
  if (!hasFiles) {
    try { hasFiles = clipboard.readBuffer('FileNameW').length > 2; } catch (_) { /* format not present */ }
  }
  if (hasFiles) {
    let names = '';
    try { names = clipboard.readBuffer('FileNameW').toString('utf16le'); } catch (_) { /* format not present */ }
    const sig = 'files:' + sha(formats.join(',') + names + clipboard.readText());
    rememberFiles(sig);
    return { kind: 'files', sig };
  }
  const text = clipboard.readText();
  if (text) return { kind: 'text', text, sig: 'text:' + sha(text) };
  const image = clipboard.readImage();
  if (!image.isEmpty()) {
    const size = image.getSize();
    const bitmap = image.toBitmap();
    const sample = Buffer.alloc(Math.ceil(bitmap.length / 997));
    for (let i = 0, j = 0; i < bitmap.length; i += 997, j++) sample[j] = bitmap[i];
    return { kind: 'image', sig: `image:${size.width}x${size.height}:${sha(sample)}`, get png() { return image.toPNG(); } };
  }
  return { kind: 'empty', sig: 'empty' };
}

// The list of copied files is fetched once per copy, so it can be put back after the guard has emptied the clipboard.
const fileLists = new Map();
function rememberFiles(sig) {
  if (fileLists.has(sig)) return;
  if (fileLists.size > 20) fileLists.delete(fileLists.keys().next().value);
  fileLists.set(sig, []);
  execFile('powershell.exe', ['-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }'],
    { windowsHide: true }, (err, out) => { if (!err) fileLists.set(sig, out.split(/\r?\n/).filter(Boolean)); });
}

function restoreFiles(paths) {
  if (!paths.length) return;
  const list = paths.map((p) => "'" + p.replace(/'/g, "''") + "'").join(',');
  execFile('powershell.exe', ['-NoProfile', '-Command', `Set-Clipboard -LiteralPath ${list}`], { windowsHide: true }, () => {});
}

const io = {
  read: readClipboard,
  writeText: (text) => { clipboard.writeText(text); return readClipboard().sig; },
  clear: () => { clipboard.clear(); return readClipboard().sig; },
  restore: (snap) => {
    if (snap.kind === 'text') clipboard.writeText(snap.text);
    else if (snap.kind === 'image') clipboard.writeImage(nativeImage.createFromBuffer(snap.png));
    else if (snap.kind === 'files') restoreFiles(fileLists.get(snap.sig) || []);
    return readClipboard().sig;
  },
  scanText,
  scanFile,
  report,
};

function report(event) {
  const tally = Object.entries(event.counts || {}).map(([t, n]) => `${t} ×${n}`).join(', ');
  const entry = { at: Date.now(), kind: event.kind, app: event.app, source: event.source || '', tally, reason: event.reason || '' };
  state.events.unshift(entry);
  if (mascot && !mascot.isDestroyed()) mascot.webContents.send('guard-event', entry);
  state.events.length = Math.min(state.events.length, 30);
  publish();
  if (event.kind === 'waiting' || event.kind === 'clean') return;   // nothing to notify or log for a clean item
  const title = event.kind === 'sanitized' ? `Clipboard sanitized outside trusted apps` : `Paste blocked outside trusted apps`;
  const body = event.kind === 'sanitized' ? (tally || 'Replaced with the checked text.') : event.reason;
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
  call('/decision', { site: event.app, source: 'clipboard', action: event.kind === 'sanitized' ? 'redacted' : 'file_blocked', counts: event.counts || {}, llm: true })
    .catch(() => {});
}

// ---------------------------------------------------------------- foreground app
function watchFocus() {
  focusProc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'focus-watch.ps1')],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  readline.createInterface({ input: focusProc.stdout }).on('line', (line) => {
    const [proc, title, box] = line.split('\t');
    const kind = classify(proc, title, APPS);
    const key = proc + '\t' + title;
    if (kind !== 'neutral') {
      state.focus = proc || '';
      state.guarding = kind === 'guarded';
    }
    guard.onFocus(kind, key, proc || 'this app');
    if (kind !== 'neutral') {
      state.browserInFront = BROWSERS.includes((proc || '').toLowerCase()) ? proc.toLowerCase() : '';
      state.sensorMissing = !!state.browserInFront && !state.sensors.includes(state.browserInFront);
    }
    if (kind !== 'neutral') checkTabWatched(key, title);
    // A file-picker window opened by a guarded desktop app. The guard cannot see the file that gets chosen there,
    // so the mascot says so at the moment it matters.
    if (kind === 'guarded' && !state.browserInFront && /^(open|open files?|choose files?|select files?|file upload|upload|attach)\b/i.test((title || '').trim())) {
      warnAttach(proc);
      publish();
      return;
    }
    if (state.sensorMissing && kind !== 'neutral') warnNoSensor(state.browserInFront);
    else remind(kind, key, proc, box === '1');
    publish();
  });
  focusProc.on('exit', () => { focusProc = null; if (!app.isQuitting) setTimeout(watchFocus, 2000); });
}

// ---------------------------------------------------------------- browser events
// The browser extension posts everything it has to tell the user to the gateway's notice board. The mascot reads
// it and says it in a speech bubble, so nothing has to be drawn on the web page. Reading the board also tells the
// extension that the mascot is running.
let noticeSeq = -1;

async function watchNotices() {
  try {
    const board = await call('/notices?after=' + noticeSeq);
    if (noticeSeq >= 0 && mascot && !mascot.isDestroyed()) {
      for (const n of board.notices) mascot.webContents.send('guard-event', { kind: 'notice', mood: n.mood, title: n.title, reason: n.text, app: n.site });
    }
    noticeSeq = board.seq;
  } catch (_) { /* gateway not answering: checkHealth reports that */ }
}

// ---------------------------------------------------------------- typing reminders
// The guard can check what is pasted, not what is typed. So every time the user jumps to a guarded app, and every
// time they click into a text box there, the mascot reminds them. Two reminders are never closer than 1.5 seconds.
const REMINDERS = [
  ['Careful what you type in {app}', 'I check what you paste, not what you type. Leave out names, IDs and passwords.'],
  ['Typing in {app}?', 'Use placeholders like [CLIENT] for customer details.'],
  ['Quick reminder', 'No passwords, OTPs or card numbers in chats.'],
  ['Before you send from {app}', 'Would the company be fine if this message were public?'],
];
let lastReminder = 0, reminderIndex = 0, wasInBox = '', lastApp = '';
const remindedApp = new Map();

function remind(kind, key, proc, inBox) {
  if (kind === 'neutral') return;                       // taskbar, Alt+Tab: not a jump yet
  const jumped = proc !== lastApp;                      // a different app is in front
  lastApp = proc;
  const here = inBox && kind === 'guarded' ? key : '';
  const clickedBox = !!here && here !== wasInBox;       // a text box in a guarded app just got the cursor
  wasInBox = here;
  if (kind !== 'guarded' || !(jumped || clickedBox) || !mascot || mascot.isDestroyed()) return;
  // Kept quiet on purpose: one reminder per app every five minutes, and never two within thirty seconds.
  const now = Date.now();
  if (now - lastReminder < 30000 || now - (remindedApp.get(proc) || 0) < 300000) return;
  if (remindedApp.size > 200) remindedApp.clear();
  remindedApp.set(proc, now);
  lastReminder = now;
  const [title, text] = REMINDERS[reminderIndex++ % REMINDERS.length];
  mascot.webContents.send('guard-event', { kind: 'reminder', title: title.replace('{app}', proc), reason: text });
}

// ---------------------------------------------------------------- UI
function icon(ok) {
  const size = 16, buf = Buffer.alloc(size * size * 4);
  const [r, g, b] = ok ? [15, 118, 110] : [185, 28, 28];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const inside = Math.hypot(x - 7.5, y - 7.5) < 7;
    const i = (y * size + x) * 4;
    buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = inside ? 255 : 0;
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function publish() {
  const ok = state.gateway && state.llm;
  if (tray) {
    tray.setImage(icon(ok));
    tray.setToolTip(ok ? (state.guarding ? `LonggaDog is guarding ${state.focus}` : 'LonggaDog is on guard (PromptGuard PH)') : 'PromptGuard: local check not running, pasting outside trusted apps is blocked');
  }
  if (win && !win.isDestroyed()) win.webContents.send('state', state);
  if (mascot && !mascot.isDestroyed()) mascot.webContents.send('state', state);
}

function openStatus() {
  if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }
  win = new BrowserWindow({
    width: 440, height: 620, resizable: false, autoHideMenuBar: true, title: 'PromptGuard PH',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'status.html'));
  win.webContents.once('did-finish-load', publish);
}

ipcMain.handle('state', () => state);
ipcMain.handle('open-dashboard', () => shell.openExternal(GATEWAY + '/dashboard'));

// ---------------------------------------------------------------- floating mascot
// A small always-on-top, see-through window in the corner of the screen. It shows the guard's state and each
// sanitize or block as a speech bubble. It never takes keyboard focus, so it does not disturb the app in front.
const MASCOT = { width: 340, height: 600 };   // room above the dog for its speech bubbles; the empty part is click-through

function createMascot() {
  const area = screen.getPrimaryDisplay().workArea;
  mascot = new BrowserWindow({
    width: MASCOT.width, height: MASCOT.height,
    x: Math.round(area.x + (area.width - MASCOT.width) / 2), y: area.y + area.height - MASCOT.height - 8,   // bottom centre
    frame: false, transparent: true, resizable: false, hasShadow: false, skipTaskbar: true, focusable: false,
    alwaysOnTop: true, show: false, title: 'LonggaDog',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  mascot.setAlwaysOnTop(true, 'screen-saver');
  mascot.setIgnoreMouseEvents(true, { forward: true });   // clicks pass through until the cursor is over the dog
  mascot.loadFile(path.join(__dirname, 'mascot.html'));
  const follow = setInterval(() => {
    if (!mascot || mascot.isDestroyed()) return clearInterval(follow);
    if (POINT || process.argv.includes('--mascot-info')) return;
    // Where the cursor is relative to the mascot, as a fraction of the screen it is on: -1..1 on each axis.
    const c = screen.getCursorScreenPoint(), b = mascot.getBounds();
    const d = screen.getDisplayNearestPoint(c).bounds;
    mascot.webContents.send('cursor', { x: c.x - b.x, y: c.y - b.y, dx: (c.x - (b.x + b.width / 2)) / d.width, dy: (c.y - (b.y + b.height - 108)) / d.height });
  }, 33);
}

ipcMain.on('mascot-ready', () => { if (mascot && !mascot.isDestroyed()) { mascot.showInactive(); publish(); } });
ipcMain.on('mascot-move', (_e, dx, dy) => {
  if (!mascot || mascot.isDestroyed()) return;
  const b = mascot.getBounds();
  mascot.setBounds({ x: Math.round(b.x + dx), y: Math.round(b.y + dy), width: MASCOT.width, height: MASCOT.height });
});
ipcMain.on('open-status', openStatus);

// ---------------------------------------------------------------- browser sensor
// The mascot guards the clipboard by itself. Inside a browser it also needs its sensor (the extension in
// `extension/`) to see uploads and typed text. A browser cannot be made to install an extension from outside, so
// when the browser in front has no sensor the mascot says so and offers to walk the user through the one-time setup.
const BROWSERS = ['chrome', 'msedge', 'brave', 'opera', 'vivaldi', 'firefox', 'arc'];
const SENSOR_BROWSERS = ['chrome', 'msedge', 'brave', 'opera', 'vivaldi'];        // Chromium browsers can load it
const warnedBrowser = new Map();

function warnNoSensor(browser) {
  const now = Date.now();
  if (!mascot || mascot.isDestroyed() || now - (warnedBrowser.get(browser) || 0) < 300000) return;
  warnedBrowser.set(browser, now);
  const canInstall = SENSOR_BROWSERS.includes(browser);
  mascot.webContents.send('guard-event', {
    kind: 'reminder',
    title: `No browser sensor in ${browser}`,
    reason: canInstall
      ? 'I guard what you paste here, but not uploads or typing. Right-click me and choose "Set up browser sensor".'
      : 'I guard what you paste here, but not uploads or typing. The sensor works in Chrome, Edge and Brave.',
  });
}

// The sensor reports the title of each tab it is watching. If the browser in front has the sensor but this tab has
// not reported, the tab is not guarded (an internal browser page, or a page the sensor could not enter).
let tabCheck = null, frontKey = '';
const warnedTab = new Map();

function checkTabWatched(key, title) {
  frontKey = key;
  clearTimeout(tabCheck);
  if (!state.browserInFront || state.sensorMissing || !title) return;
  if (title.includes('PromptGuard PH')) return;             // the guard's own pages: the sensor is not needed there
  tabCheck = setTimeout(async () => {
    if (frontKey !== key || !mascot || mascot.isDestroyed()) return;
    let health;
    try { health = await call('/health'); } catch (_) { return; }
    const watched = (health.tabs || []).some((t) => t && title.startsWith(t));
    const now = Date.now();
    if (watched || now - (warnedTab.get(key) || 0) < 600000) return;
    if (warnedTab.size > 200) warnedTab.clear();
    warnedTab.set(key, now);
    mascot.webContents.send('guard-event', {
      kind: 'reminder',
      title: 'I cannot see inside this tab',
      reason: 'Uploads and typing here are not checked. If this is a website, press F5 to refresh it once.',
    });
  }, 7000);
}

let lastAttachWarning = 0;
function warnAttach(proc) {
  const now = Date.now();
  if (!mascot || mascot.isDestroyed() || now - lastAttachWarning < 20000) return;
  lastAttachWarning = now;
  mascot.webContents.send('guard-event', {
    kind: 'reminder',
    title: `I can't check files attached in ${proc}`,
    reason: 'Only what you copy and paste is checked here. Do not attach IDs, customer files or anything confidential.',
  });
}

ipcMain.on('setup-sensor', () => {
  shell.openPath(path.join(ROOT, 'extension'));
  // Opens the browser's extensions page. If the browser refuses the address, the steps in the bubble still apply.
  spawn('cmd.exe', ['/c', 'start', '', 'chrome', 'chrome://extensions'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
  if (mascot && !mascot.isDestroyed()) {
    mascot.webContents.send('guard-event', {
      kind: 'steps',
      title: 'Set up my browser sensor (once)',
      reason: '1. In Chrome, open chrome://extensions\n2. Turn on "Developer mode" (top right)\n3. Click "Load unpacked" and pick the "extension" folder I just opened\n4. Refresh your open tabs',
    });
  }
});
ipcMain.on('mascot-hit', (_e, hit) => {
  if (mascot && !mascot.isDestroyed()) mascot.setIgnoreMouseEvents(!hit, { forward: true });
});

// ---------------------------------------------------------------- lifecycle
if (!SHOT && !app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', openStatus);
app.on('window-all-closed', () => { /* keep running in the tray */ });
app.on('before-quit', () => {
  app.isQuitting = true;
  if (focusProc) focusProc.kill();
  if (gatewayProc) gatewayProc.kill();
});

app.whenReady().then(async () => {
  if (SHOT) {
    // Development only: render the mascot with a sample notice, save a picture, quit. Nothing else starts.
    createMascot();
    ipcMain.once('mascot-ready', () => setTimeout(async () => {
      if (process.argv.includes('--mascot-info')) {
        mascot.webContents.send('state', { gateway: true, llm: true, model: 'qwen2.5:3b', focus: 'Viber', guarding: true, events: [
          { at: Date.now(), kind: 'sanitized', tally: 'PERSON ×1, TIN ×1' }, { at: Date.now() - 60000, kind: 'blocked', reason: 'Copied files can only be pasted into trusted apps.' }] });
        await mascot.webContents.executeJavaScript('window.pgInfo(true); 0');
      } else if (process.argv.includes('--mascot-notice')) {
        mascot.webContents.send('guard-event', { kind: 'notice', mood: 'angry', title: 'Upload blocked: PASSPORT.jpg', reason: 'This contains what looks like a government ID or civil document. Identity documents are never sent.', app: 'chatgpt' });
      } else if (process.argv.includes('--mascot-angry')) {
        mascot.webContents.send('guard-event', { kind: 'sanitized', app: 'Viber', tally: 'PERSON \u00d71, TIN \u00d71' });
      } else if (process.argv.includes('--mascot-happy')) {
        mascot.webContents.send('guard-event', { kind: 'clean', app: 'Viber' });
      } else if (process.argv.includes('--mascot-remind')) {
        mascot.webContents.send('guard-event', { kind: 'reminder', title: 'Careful what you type in Viber', reason: REMINDERS[0][1] });
      } else if (POINT) await mascot.webContents.executeJavaScript(`setInterval(() => window.pgPoint(${POINT}), 30); 0`);
      else mascot.webContents.send('guard-event', { kind: 'sanitized', tally: 'PERSON ×1, TIN ×1' });
      await new Promise((ok) => setTimeout(ok, process.argv.includes('--mascot-angry') ? 2300 : 900));
      fs.writeFileSync(SHOT, (await mascot.webContents.capturePage()).toPNG());
      console.log('SHOT saved');
      app.exit(0);
    }, 1500));
    setTimeout(() => { console.log('SHOT timeout'); app.exit(1); }, 25000);
    return;
  }
  app.setAppUserModelId('ph.promptguard.desktop');
  guard = new ClipboardGuard(io);
  tray = new Tray(icon(false));
  const items = [
    { label: 'Open status', click: openStatus },
    { label: 'Open audit dashboard', click: () => shell.openExternal(GATEWAY + '/dashboard') },
  ];
  // The guard has no off switch for the user. Quit is offered only in development (npm start).
  if (DEV) items.push({ type: 'separator' }, { label: 'Quit (development only)', click: () => app.quit() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.on('click', openStatus);
  createMascot();

  await ensureGateway();
  watchFocus();
  setInterval(() => { try { guard.onClipboard(readClipboard()); } catch (_) { /* clipboard busy: try again next tick */ } }, 400);
  // If the gateway stops while the app is running, start it again.
  setInterval(async () => { if (!(await checkHealth())) ensureGateway(); }, 5000);
  setInterval(watchNotices, 600);

  if (SMOKE) {
    await new Promise((ok) => setTimeout(ok, 2500));
    const snap = readClipboard();
    console.log('SMOKE ' + JSON.stringify({ gateway: state.gateway, llm: state.llm, model: state.model, startedGateway: state.startedGateway,
      focus: state.focus, guarding: state.guarding, clipboardKind: snap.kind, tray: !!tray }));
    app.quit();
  }
  // The status window is never shown on its own. It opens from a right-click on the mascot, or from the tray icon.
});
