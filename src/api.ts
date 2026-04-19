import type {
  Profile,
  ProfileGroup,
  ProxyConfig,
  ProxyTestResult,
  ParsedProxy,
  PresetTemplate,
  FingerprintConfig,
  CreateProfileInput,
  UpdateProfileInput,
  LaunchedBrowserInfo,
} from '@shared/types';
import type { SyncStatus, SyncResult, SyncProgress } from '@shared/syncTypes';

interface IpcSuccess<T> { ok: true; data: T }
interface IpcError { ok: false; error: string }
type IpcResult<T> = IpcSuccess<T> | IpcError;

declare global {
  interface Window {
    api: {
      profile: {
        list: (filter?: { groupId?: string; search?: string }) => Promise<IpcResult<Profile[]>>;
        get: (id: string) => Promise<IpcResult<Profile | null>>;
        create: (input: CreateProfileInput) => Promise<IpcResult<Profile>>;
        update: (input: UpdateProfileInput) => Promise<IpcResult<Profile>>;
        delete: (id: string, deleteData?: boolean) => Promise<IpcResult<void>>;
        clone: (id: string, newName?: string) => Promise<IpcResult<Profile>>;
        launch: (id: string) => Promise<IpcResult<LaunchedBrowserInfo>>;
        close: (id: string) => Promise<IpcResult<void>>;
        listRunning: () => Promise<IpcResult<LaunchedBrowserInfo[]>>;
      };
      group: {
        list: () => Promise<IpcResult<ProfileGroup[]>>;
        create: (name: string, color?: string) => Promise<IpcResult<ProfileGroup>>;
        update: (id: string, name: string, color: string) => Promise<IpcResult<void>>;
        delete: (id: string) => Promise<IpcResult<void>>;
      };
      proxy: {
        list: () => Promise<IpcResult<ProxyConfig[]>>;
        create: (input: Omit<ProxyConfig, 'id' | 'lastTestedAt' | 'lastTestIp' | 'lastTestCountry' | 'lastTestLatencyMs' | 'lastTestOk'>) => Promise<IpcResult<ProxyConfig>>;
        update: (id: string, input: Partial<ProxyConfig>) => Promise<IpcResult<ProxyConfig>>;
        delete: (id: string) => Promise<IpcResult<void>>;
        test: (id: string) => Promise<IpcResult<ProxyTestResult>>;
        testAll: () => Promise<IpcResult<{ id: string; result: ProxyTestResult }[]>>;
        parse: (raw: string) => Promise<IpcResult<ParsedProxy | null>>;
        testAdhoc: (raw: string) => Promise<IpcResult<ProxyTestResult & { parsed?: ParsedProxy }>>;
      };
      preset: {
        list: () => Promise<IpcResult<PresetTemplate[]>>;
        random: (presetId?: string) => Promise<IpcResult<FingerprintConfig>>;
      };
      fingerprintTest: {
        run: (profileId: string, urls: string[]) => Promise<IpcResult<{ openedUrls: string[] }>>;
      };
      system: {
        openDir: (dir: string) => Promise<IpcResult<boolean>>;
        appInfo: () => Promise<IpcResult<{
          version: string;
          userDataPath: string;
          cloak: { ok: boolean; error?: string };
          chromiumKernel: string;
          binaryCacheDir: string;
          binaryInstalled: boolean;
        }>>;
        openExternal: (url: string) => Promise<IpcResult<boolean>>;
      };
      binary: {
        status: () => Promise<IpcResult<{
          installed: boolean;
          version?: string;
          binaryPath?: string;
          cacheDir: string;
          downloadUrl?: string;
          source?: 'override' | 'extracted' | 'cache';
        }>>;
        download: () => Promise<IpcResult<{
          ok: boolean;
          binaryPath?: string;
          version?: string;
          error?: string;
        }>>;
        pickZip: () => Promise<IpcResult<string | null>>;
        importZip: (zipPath: string) => Promise<IpcResult<{
          ok: boolean;
          binaryPath?: string;
          version?: string;
          error?: string;
        }>>;
        onProgress: (cb: (line: string) => void) => () => void;
      };
      sync: {
        status: (server: string, token: string) => Promise<IpcResult<SyncStatus>>;
        upload: (server: string, token: string) => Promise<IpcResult<SyncResult>>;
        download: (server: string, token: string) => Promise<IpcResult<SyncResult>>;
        deleteRemote: (server: string, token: string, profileId: string) => Promise<IpcResult<void>>;
        onProgress: (cb: (p: SyncProgress) => void) => () => void;
      };
    };
  }
}

export async function call<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

export const api = {
  profile: {
    list: (filter?: { groupId?: string; search?: string }) => call(window.api.profile.list(filter)),
    get: (id: string) => call(window.api.profile.get(id)),
    create: (input: CreateProfileInput) => call(window.api.profile.create(input)),
    update: (input: UpdateProfileInput) => call(window.api.profile.update(input)),
    delete: (id: string, deleteData?: boolean) => call(window.api.profile.delete(id, deleteData)),
    clone: (id: string, newName?: string) => call(window.api.profile.clone(id, newName)),
    launch: (id: string) => call(window.api.profile.launch(id)),
    close: (id: string) => call(window.api.profile.close(id)),
    listRunning: () => call(window.api.profile.listRunning()),
  },
  group: {
    list: () => call(window.api.group.list()),
    create: (name: string, color?: string) => call(window.api.group.create(name, color)),
    update: (id: string, name: string, color: string) => call(window.api.group.update(id, name, color)),
    delete: (id: string) => call(window.api.group.delete(id)),
  },
  proxy: {
    list: () => call(window.api.proxy.list()),
    create: (input: Parameters<typeof window.api.proxy.create>[0]) => call(window.api.proxy.create(input)),
    update: (id: string, input: Partial<ProxyConfig>) => call(window.api.proxy.update(id, input)),
    delete: (id: string) => call(window.api.proxy.delete(id)),
    test: (id: string) => call(window.api.proxy.test(id)),
    testAll: () => call(window.api.proxy.testAll()),
    parse: (raw: string) => call(window.api.proxy.parse(raw)),
    testAdhoc: (raw: string) => call(window.api.proxy.testAdhoc(raw)),
  },
  preset: {
    list: () => call(window.api.preset.list()),
    random: (presetId?: string) => call(window.api.preset.random(presetId)),
  },
  fingerprintTest: {
    run: (profileId: string, urls: string[]) => call(window.api.fingerprintTest.run(profileId, urls)),
  },
  system: {
    openDir: (dir: string) => call(window.api.system.openDir(dir)),
    appInfo: () => call(window.api.system.appInfo()),
    openExternal: (url: string) => call(window.api.system.openExternal(url)),
  },
  binary: {
    status: () => call(window.api.binary.status()),
    download: () => call(window.api.binary.download()),
    pickZip: () => call(window.api.binary.pickZip()),
    importZip: (zipPath: string) => call(window.api.binary.importZip(zipPath)),
    onProgress: (cb: (line: string) => void) => window.api.binary.onProgress(cb),
  },
  sync: {
    status: (server: string, token: string) => call(window.api.sync.status(server, token)),
    upload: (server: string, token: string) => call(window.api.sync.upload(server, token)),
    download: (server: string, token: string) => call(window.api.sync.download(server, token)),
    deleteRemote: (server: string, token: string, profileId: string) =>
      call(window.api.sync.deleteRemote(server, token, profileId)),
    onProgress: (cb: (p: SyncProgress) => void) => window.api.sync.onProgress(cb),
  },
};
