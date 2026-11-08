/* Podium Desktop - the Electron layer around the browser version of Podium. */
'use strict';
const { app, BrowserWindow, Menu, desktopCapturer, dialog, ipcMain, screen, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');

/* Everything stays inside the Podium Desktop folder, so deleting that folder
   removes all of it. Nothing goes to %APPDATA% and nothing touches the registry. */
const dataDir = path.join(path.dirname(process.execPath), '..', 'data');
app.setPath('userData', dataDir);
app.setPath('sessionData', dataDir);
app.setPath('crashDumps', path.join(dataDir, 'crash'));
app.setAppLogsPath(path.join(dataDir, 'logs'));
app.setAppUserModelId('Podium.Desktop');

const ICON = path.join(__dirname, 'icon.ico');
const ACCENT = '#b7472a';
const isPptx = p => typeof p === 'string' && /\.pptx$/i.test(p);

let mainWin = null;
let rendererReady = false;
let pendingFile = null;
let pdfTarget = null;
let boundsBeforeShow = null;

/* The page may read any .pptx, but may only write back to a file it has read. */
const opened = new Set();
const fileKey = p => path.resolve(p).toLowerCase();

const pptxFromArgs = (argv, cwd) => {
  for (const arg of argv) {
    if (arg.startsWith('-') || !isPptx(arg)) continue;
    const full = path.resolve(cwd, arg);
    if (fs.existsSync(full)) return full;
  }
  return null;
};
const openInWindow = file => {
  if (!file) return;
  if (rendererReady && mainWin) mainWin.webContents.send('open-file', file);
  else pendingFile = file;
};

function allowOnlyOwnPages(contents) {
  contents.on('will-navigate', e => e.preventDefault());
}

function placePresenter(child) {
  const displays = screen.getAllDisplays();
  if (displays.length < 2 || !mainWin) return;
  const slidesOn = screen.getDisplayMatching(mainWin.getBounds());
  const other = displays.find(d => d.id !== slidesOn.id);
  child.setBounds(other.workArea);
  child.maximize();
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 800,
    minHeight: 500,
    show: false,
    title: 'Podium',
    icon: ICON,
    backgroundColor: '#ffffff',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: ACCENT, symbolColor: '#ffffff', height: 32 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  const contents = mainWin.webContents;
  mainWin.once('ready-to-show', () => { mainWin.maximize(); mainWin.show(); });
  mainWin.on('closed', () => {
    mainWin = null;
    BrowserWindow.getAllWindows().forEach(w => w.destroy());
  });
  allowOnlyOwnPages(contents);

  /* Links open in the normal browser. The only window Podium opens itself is Presenter View. */
  contents.setWindowOpenHandler(({ url, frameName }) => {
    if (frameName === 'podium_presenter') {
      return { action: 'allow', overrideBrowserWindowOptions: { icon: ICON, title: 'Presenter View', backgroundColor: '#1e1e1e', autoHideMenuBar: true } };
    }
    if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('did-create-window', child => {
    child.setMenu(null);
    allowOnlyOwnPages(child.webContents);
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    placePresenter(child);
  });

  /* A page's "unsaved changes" warning shows nothing in Electron, so the window would just refuse to close. */
  contents.on('will-prevent-unload', () => {
    const name = mainWin.getTitle().replace(/ - Podium$/, '');
    const choice = dialog.showMessageBoxSync(mainWin, {
      type: 'warning',
      title: 'Podium',
      message: `Do you want to save the changes you made to "${name}"?`,
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (choice === 0) {
      contents.executeJavaScript('P.save().then(() => !P.dirty)', true)
        .then(saved => { if (saved && mainWin) mainWin.destroy(); })
        .catch(() => {});
    } else if (choice === 1) {
      contents.executeJavaScript('P.kvDel("autosave")')
        .catch(() => {})
        .finally(() => { if (mainWin) mainWin.destroy(); });
    }
  });

  /* Electron has no right-click menu of its own, so text boxes need one. */
  contents.on('context-menu', (_e, p) => {
    if (!p.isEditable) return;
    const fixes = p.dictionarySuggestions.map(word => ({ label: word, click: () => contents.replaceMisspelling(word) }));
    if (fixes.length) fixes.push({ type: 'separator' });
    Menu.buildFromTemplate([...fixes, { role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' }]).popup({ window: mainWin });
  });

  /* Slides go back to where the window was when the show ends. */
  contents.on('leave-html-full-screen', () => {
    if (!boundsBeforeShow || !mainWin) return;
    const { bounds, maximized } = boundsBeforeShow;
    boundsBeforeShow = null;
    setTimeout(() => {
      if (!mainWin) return;
      mainWin.setBounds(bounds);
      if (maximized) mainWin.maximize();
    }, 50);
  });

  mainWin.loadFile(path.join(__dirname, 'web', 'index.html'));
}

function setUpPermissions() {
  const ses = session.defaultSession;
  const allowed = new Set(['media', 'fullscreen', 'clipboard-read', 'clipboard-sanitized-write', 'display-capture']);
  const ownPage = url => /^(file:|about:blank)/.test(url || '');
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => callback(allowed.has(permission) && ownPage(details.requestingUrl)));
  ses.setPermissionCheckHandler((_wc, permission, origin) => allowed.has(permission) && ownPage(origin));

  /* Insert > Screenshot and Screen Recording: Electron has no built-in screen picker on Windows. */
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = (await desktopCapturer.getSources({ types: ['screen', 'window'] })).slice(0, 8);
      const labels = sources.map(s => s.name.length > 48 ? s.name.slice(0, 45) + '…' : s.name);
      const { response } = await dialog.showMessageBox(mainWin, {
        type: 'question',
        title: 'Podium',
        message: 'What do you want to capture?',
        buttons: [...labels, 'Cancel'],
        cancelId: labels.length,
        noLink: true,
      });
      if (response >= sources.length) { callback({}); return; }
      callback(request.audioRequested ? { video: sources[response], audio: 'loopback' } : { video: sources[response] });
    } catch (_) {
      callback({});
    }
  });
}

function setUpIpc() {
  ipcMain.on('renderer-ready', () => {
    rendererReady = true;
    openInWindow(pendingFile);
    pendingFile = null;
  });
  /* Windows dialogs and Node do the file work, not Chromium's file API, which refuses to write
     to some folders a desktop app should be able to use, such as anything under AppData. */
  const PPTX_FILTER = [{ name: 'PowerPoint Presentation', extensions: ['pptx'] }];
  let lastFolder = null;
  const startFolder = () => lastFolder || app.getPath('documents');
  ipcMain.handle('file:pick-open', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWin, { title: 'Open', defaultPath: startFolder(), properties: ['openFile'], filters: PPTX_FILTER });
    if (canceled || !filePaths[0]) return null;
    lastFolder = path.dirname(filePaths[0]);
    return filePaths[0];
  });
  ipcMain.handle('file:pick-save', async (_e, suggested) => {
    const name = String(suggested || 'Presentation.pptx').replace(/[\\/:*?"<>|]/g, '_');
    const { canceled, filePath } = await dialog.showSaveDialog(mainWin, { title: 'Save As', defaultPath: path.join(startFolder(), name), filters: PPTX_FILTER });
    if (canceled || !filePath) return null;
    const file = isPptx(filePath) ? filePath : `${filePath}.pptx`;
    lastFolder = path.dirname(file);
    opened.add(fileKey(file));
    return file;
  });
  ipcMain.handle('file:read', async (_e, file) => {
    if (!isPptx(file)) throw new Error('Only .pptx files can be opened.');
    const bytes = await fs.promises.readFile(file);
    opened.add(fileKey(file));
    return bytes;
  });
  ipcMain.handle('file:write', async (_e, file, bytes) => {
    if (!isPptx(file) || !opened.has(fileKey(file))) throw new Error('That file was not opened here.');
    /* Written to the side first, so a failed save can't leave a half-written presentation. */
    const temp = `${file}.podium-saving`;
    try {
      await fs.promises.writeFile(temp, bytes);
      await fs.promises.rename(temp, file);
    } catch (e) {
      await fs.promises.rm(temp, { force: true }).catch(() => {});
      throw e;
    }
  });
  /* Same folder as the presentation, unless nothing has been opened or saved yet. */
  ipcMain.handle('pdf:pick', async (_e, suggested) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWin, {
      title: 'Publish as PDF',
      defaultPath: path.join(startFolder(), String(suggested || 'Presentation.pdf').replace(/[\\/:*?"<>|]/g, '_')),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    pdfTarget = canceled ? null : filePath;
    return pdfTarget ? path.basename(pdfTarget) : null;
  });
  ipcMain.handle('pdf:print', async () => {
    if (!pdfTarget) throw new Error('No PDF location chosen.');
    const target = pdfTarget;
    pdfTarget = null;
    const bytes = await mainWin.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } });
    await fs.promises.writeFile(target, bytes);
  });
  /* Presenter View on two monitors: slides go on the second one before the show goes full screen. */
  ipcMain.handle('show:prepare', () => {
    const displays = screen.getAllDisplays();
    if (displays.length < 2 || !mainWin) return false;
    const primary = screen.getPrimaryDisplay();
    const audience = displays.find(d => d.id !== primary.id);
    if (screen.getDisplayMatching(mainWin.getBounds()).id === audience.id) return false;
    boundsBeforeShow = { bounds: mainWin.getNormalBounds(), maximized: mainWin.isMaximized() };
    if (mainWin.isMaximized()) mainWin.unmaximize();
    /* Set twice: the first move can land at the wrong size when the monitors have different scaling. */
    mainWin.setBounds(audience.workArea);
    mainWin.setBounds(audience.workArea);
    return true;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  /* Podium edits one presentation at a time, so a second launch hands its file to this window. */
  app.on('second-instance', (_e, argv, cwd) => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
    openInWindow(pptxFromArgs(argv.slice(1), cwd));
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    setUpPermissions();
    setUpIpc();
    pendingFile = pptxFromArgs(process.argv.slice(1), process.cwd());
    createWindow();
  });
}
