import { ipcMain, shell, app, BrowserWindow, dialog } from 'electron';
import { IPC } from '@shared/ipcChannels';
import {
  listProfiles, getProfile, createProfile, updateProfile, deleteProfile, cloneProfile,
  listGroups, createGroup, updateGroup, deleteGroup,
} from '../services/profileService.js';
import {
  listProxies, createProxy, updateProxy, deleteProxy, testProxy, getProxy, recordTestResult,
  parseProxyString, testProxyAdhoc,
} from '../services/proxyService.js';
import { PRESETS, generateRandomFingerprint, getPresetById, presetToFingerprint } from '../services/presets.js';
import {
  launchProfile, closeProfile, listRunning, runFingerprintTest, isCloakAvailable,
  ensureCloakBinary, getCloakBinaryStatus, getCloakCacheDir, importCloakBinaryZip,
} from '../services/browserLauncher.js';

interface IpcSuccess<T> { ok: true; data: T }
interface IpcError { ok: false; error: string }
type IpcResult<T> = IpcSuccess<T> | IpcError;

function wrap<TArgs extends unknown[], TRet>(
  handler: (...args: TArgs) => TRet | Promise<TRet>,
) {
  return async (event: Electron.IpcMainInvokeEvent, ...args: TArgs): Promise<IpcResult<TRet>> => {
    try {
      const data = await handler(...args);
      return { ok: true, data };
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      const stack = (err as Error)?.stack ?? '';
      // Surface full stack to terminal during dev so we can diagnose hidden
      // failures (e.g. inside cloakbrowser / playwright internals).
      console.error('[IPC error]', event?.frameId, '\n', stack || msg);
      return { ok: false, error: msg };
    }
  };
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.Profile.List, wrap((filter?: { groupId?: string; search?: string }) => listProfiles(filter)));
  ipcMain.handle(IPC.Profile.Get, wrap((id: string) => getProfile(id)));
  ipcMain.handle(IPC.Profile.Create, wrap((input: Parameters<typeof createProfile>[0]) => createProfile(input)));
  ipcMain.handle(IPC.Profile.Update, wrap((input: Parameters<typeof updateProfile>[0]) => updateProfile(input)));
  ipcMain.handle(IPC.Profile.Delete, wrap((id: string, deleteData?: boolean) => deleteProfile(id, deleteData)));
  ipcMain.handle(IPC.Profile.Clone, wrap((id: string, newName?: string) => cloneProfile(id, newName)));
  ipcMain.handle(IPC.Profile.Launch, wrap((id: string) => launchProfile(id)));
  ipcMain.handle(IPC.Profile.Close, wrap((id: string) => closeProfile(id)));
  ipcMain.handle(IPC.Profile.ListRunning, wrap(() => listRunning()));

  ipcMain.handle(IPC.Group.List, wrap(() => listGroups()));
  ipcMain.handle(IPC.Group.Create, wrap((name: string, color?: string) => createGroup(name, color)));
  ipcMain.handle(IPC.Group.Update, wrap((id: string, name: string, color: string) => updateGroup(id, name, color)));
  ipcMain.handle(IPC.Group.Delete, wrap((id: string) => deleteGroup(id)));

  ipcMain.handle(IPC.Proxy.List, wrap(() => listProxies()));
  ipcMain.handle(IPC.Proxy.Create, wrap((input: Parameters<typeof createProxy>[0]) => createProxy(input)));
  ipcMain.handle(IPC.Proxy.Update, wrap((id: string, input: Parameters<typeof updateProxy>[1]) => updateProxy(id, input)));
  ipcMain.handle(IPC.Proxy.Delete, wrap((id: string) => deleteProxy(id)));
  ipcMain.handle(IPC.Proxy.Test, wrap(async (id: string) => {
    const proxy = getProxy(id);
    if (!proxy) throw new Error('Proxy not found');
    const result = await testProxy(proxy);
    recordTestResult(id, result);
    return result;
  }));
  ipcMain.handle(IPC.Proxy.Parse, wrap((input: string) => parseProxyString(input)));
  ipcMain.handle(IPC.Proxy.TestAdhoc, wrap((input: string) => testProxyAdhoc(input)));
  ipcMain.handle(IPC.Proxy.TestAll, wrap(async () => {
    const proxies = listProxies();
    const results = await Promise.all(
      proxies.map(async (p) => {
        const r = await testProxy(p);
        recordTestResult(p.id, r);
        return { id: p.id, result: r };
      }),
    );
    return results;
  }));

  ipcMain.handle(IPC.Preset.List, wrap(() => PRESETS));
  ipcMain.handle(IPC.Preset.Random, wrap((presetId?: string) => {
    if (presetId) {
      const p = getPresetById(presetId);
      if (!p) throw new Error('Preset not found');
      return presetToFingerprint(p);
    }
    return generateRandomFingerprint();
  }));

  ipcMain.handle(IPC.FingerprintTest.Run, wrap((profileId: string, urls: string[]) => runFingerprintTest(profileId, urls)));

  ipcMain.handle(IPC.System.OpenDir, wrap(async (dir: string) => {
    await shell.openPath(dir);
    return true;
  }));
  ipcMain.handle(IPC.System.OpenExternal, wrap(async (url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new Error('Invalid URL');
    }
    await shell.openExternal(url);
    return true;
  }));
  ipcMain.handle(IPC.System.AppInfo, wrap(async () => {
    const binStatus = await getCloakBinaryStatus();
    return {
      version: app.getVersion(),
      userDataPath: app.getPath('userData'),
      cloak: isCloakAvailable(),
      chromiumKernel: binStatus.version
        ? `CloakBrowser (Chromium ${binStatus.version})`
        : 'CloakBrowser (Chromium 146)',
      binaryCacheDir: getCloakCacheDir(),
      binaryInstalled: binStatus.installed,
    };
  }));

  ipcMain.handle(IPC.Binary.Status, wrap(() => getCloakBinaryStatus()));

  const broadcastBinaryProgress = (line: string) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IPC.Binary.Progress, line);
    }
  };

  ipcMain.handle(IPC.Binary.Download, wrap(async (_input?: unknown) => {
    return ensureCloakBinary(broadcastBinaryProgress);
  }));

  ipcMain.handle(IPC.Binary.PickZip, wrap(async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const r = await dialog.showOpenDialog(win, {
      title: '选择 cloakbrowser-windows-x64.zip',
      filters: [{ name: 'CloakBrowser zip', extensions: ['zip'] }],
      properties: ['openFile'],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    return r.filePaths[0];
  }));

  ipcMain.handle(IPC.Binary.ImportZip, wrap(async (zipPath: string) => {
    return importCloakBinaryZip(zipPath, broadcastBinaryProgress);
  }));
}
