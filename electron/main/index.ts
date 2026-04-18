import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { initDatabase, closeDatabase } from './db/client.js';
import { registerIpcHandlers } from './ipc/index.js';
import { closeAll as closeAllBrowsers } from './services/browserLauncher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged;

/**
 * Pin userData to a stable directory name regardless of `package.json` -> name.
 * Without this, renaming the app (e.g. from "fingerprint-browser" to
 * "tianhu6jin") makes Electron look in a fresh empty %APPDATA% folder, and the
 * user thinks all their profiles have vanished.
 *
 * MUST run before `app.whenReady()` because Electron caches the path lazily.
 *
 * Migration: if the legacy folder exists and the pinned one is empty/missing,
 * we silently switch to the legacy one so existing data is picked up. We do
 * NOT auto-copy here — that's a user-visible operation.
 */
function pinUserData(): void {
  const PINNED = 'tianhu6jin';
  const LEGACY_NAMES = ['fingerprint-browser'];
  const baseAppData = app.getPath('appData');
  const pinnedPath = path.join(baseAppData, PINNED);

  // If pinned location doesn't exist yet but a legacy one does, point Electron
  // at the legacy location to pick up existing profiles.
  if (!existsSync(pinnedPath) || !existsSync(path.join(pinnedPath, 'data'))) {
    for (const legacy of LEGACY_NAMES) {
      const legacyPath = path.join(baseAppData, legacy);
      if (existsSync(path.join(legacyPath, 'data'))) {
        app.setPath('userData', legacyPath);
        return;
      }
    }
  }
  app.setPath('userData', pinnedPath);
}

pinUserData();

async function createWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    title: '天胡6金',
    autoHideMenuBar: true,
    backgroundColor: '#f5f5f5',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    await win.loadURL(process.env['ELECTRON_RENDERER_URL']);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return win;
}

void app.whenReady().then(async () => {
  await initDatabase();
  registerIpcHandlers();
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

let isQuitting = false;

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async (event) => {
  if (isQuitting) return;
  isQuitting = true;
  event.preventDefault();
  try {
    await closeAllBrowsers();
  } catch (err) {
    console.error('Error closing browsers on quit:', err);
  }
  closeDatabase();
  app.exit(0);
});
