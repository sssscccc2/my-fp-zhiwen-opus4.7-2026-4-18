import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@shared/ipcChannels';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args);

const api = {
  profile: {
    list: (filter?: { groupId?: string; search?: string }) => invoke(IPC.Profile.List, filter),
    get: (id: string) => invoke(IPC.Profile.Get, id),
    create: (input: unknown) => invoke(IPC.Profile.Create, input),
    update: (input: unknown) => invoke(IPC.Profile.Update, input),
    delete: (id: string, deleteData?: boolean) => invoke(IPC.Profile.Delete, id, deleteData),
    clone: (id: string, newName?: string) => invoke(IPC.Profile.Clone, id, newName),
    launch: (id: string) => invoke(IPC.Profile.Launch, id),
    close: (id: string) => invoke(IPC.Profile.Close, id),
    listRunning: () => invoke(IPC.Profile.ListRunning),
  },
  group: {
    list: () => invoke(IPC.Group.List),
    create: (name: string, color?: string) => invoke(IPC.Group.Create, name, color),
    update: (id: string, name: string, color: string) => invoke(IPC.Group.Update, id, name, color),
    delete: (id: string) => invoke(IPC.Group.Delete, id),
  },
  proxy: {
    list: () => invoke(IPC.Proxy.List),
    create: (input: unknown) => invoke(IPC.Proxy.Create, input),
    update: (id: string, input: unknown) => invoke(IPC.Proxy.Update, id, input),
    delete: (id: string) => invoke(IPC.Proxy.Delete, id),
    test: (id: string) => invoke(IPC.Proxy.Test, id),
    testAll: () => invoke(IPC.Proxy.TestAll),
    parse: (raw: string) => invoke(IPC.Proxy.Parse, raw),
    testAdhoc: (raw: string) => invoke(IPC.Proxy.TestAdhoc, raw),
  },
  preset: {
    list: () => invoke(IPC.Preset.List),
    random: (presetId?: string) => invoke(IPC.Preset.Random, presetId),
  },
  fingerprintTest: {
    run: (profileId: string, urls: string[]) => invoke(IPC.FingerprintTest.Run, profileId, urls),
  },
  system: {
    openDir: (dir: string) => invoke(IPC.System.OpenDir, dir),
    appInfo: () => invoke(IPC.System.AppInfo),
    openExternal: (url: string) => invoke(IPC.System.OpenExternal, url),
  },
  binary: {
    status: () => invoke(IPC.Binary.Status),
    download: () => invoke(IPC.Binary.Download),
    pickZip: () => invoke(IPC.Binary.PickZip),
    importZip: (zipPath: string) => invoke(IPC.Binary.ImportZip, zipPath),
    onProgress: (cb: (line: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, line: string) => cb(line);
      ipcRenderer.on(IPC.Binary.Progress, handler);
      return () => ipcRenderer.removeListener(IPC.Binary.Progress, handler);
    },
  },
};

contextBridge.exposeInMainWorld('api', api);

export type ApiBridge = typeof api;
