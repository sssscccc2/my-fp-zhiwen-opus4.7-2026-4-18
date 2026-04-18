import { app } from 'electron';
import path from 'node:path';
import { mkdirSync, existsSync, statSync, rmSync, readdirSync, renameSync, rmdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { Profile, ProxyConfig, LaunchedBrowserInfo } from '@shared/types';
import { buildLaunchOptions } from './fingerprintBuilder.js';
import { getProfile, markProfileOpened } from './profileService.js';
import { getProxy, testProxy } from './proxyService.js';
import { needsBridge, startBridge, stopBridge } from './proxyBridge.js';
import { parseCookieJson, toPlaywrightCookies } from '@shared/cookieFormats';

interface RunningBrowser {
  profileId: string;
  context: unknown;
  startedAt: number;
}

const running = new Map<string, RunningBrowser>();

type CloakLaunchModule = {
  launchPersistentContext: (options: Record<string, unknown> & { userDataDir: string }) => Promise<{
    on?: (event: string, cb: () => void) => void;
    close: () => Promise<void>;
    pages?: () => unknown[];
    newPage?: () => Promise<unknown>;
    addCookies?: (cookies: Array<Record<string, unknown>>) => Promise<void>;
  }>;
  ensureBinary?: () => Promise<string>;
  binaryInfo?: () => {
    version: string;
    platform: string;
    binaryPath: string;
    installed: boolean;
    cacheDir: string;
    downloadUrl: string;
  };
  checkForUpdate?: () => Promise<string | null>;
  CHROMIUM_VERSION?: string;
};

let cloakModule: CloakLaunchModule | null = null;
let cloakLoadError: string | null = null;

/**
 * Compute and pin the cloakbrowser binary cache directory to live INSIDE the
 * application's territory rather than scattered in `~/.cloakbrowser`. This
 * keeps the ~360MB binary discoverable, easy to back up / wipe, and makes the
 * portable build genuinely portable.
 *
 *  Dev mode  -> <repo>/bin/cloakbrowser
 *  Packaged  -> <userData>/cloakbrowser
 */
export function getCloakCacheDir(): string {
  if (process.env.CLOAKBROWSER_CACHE_DIR) return process.env.CLOAKBROWSER_CACHE_DIR;
  const dir = app.isPackaged
    ? path.join(app.getPath('userData'), 'cloakbrowser')
    : path.join(app.getAppPath(), 'bin', 'cloakbrowser');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Search well-known locations for a pre-extracted chrome.exe. This lets users
 * drop the unzipped binary into `resources/cloakbrowser-<platform>/` (which
 * electron-builder automatically bundles into packaged builds) without the
 * App having to re-extract anything.
 *
 * Returns absolute path to the chrome executable, or null if none found.
 */
function findExtractedBinary(): string | null {
  const platformDir = process.platform === 'win32' ? 'cloakbrowser-windows-x64'
    : process.platform === 'darwin' ? (process.arch === 'arm64' ? 'cloakbrowser-darwin-arm64' : 'cloakbrowser-darwin-x64')
    : (process.arch === 'arm64' ? 'cloakbrowser-linux-arm64' : 'cloakbrowser-linux-x64');
  const exe = process.platform === 'win32' ? 'chrome.exe'
    : process.platform === 'darwin' ? 'Chromium.app/Contents/MacOS/Chromium'
    : 'chrome';

  const candidateRoots: string[] = [];
  // 1. Dev: <repo>/resources/cloakbrowser-<platform>/ (where the user dropped it)
  candidateRoots.push(path.join(app.getAppPath(), 'resources', platformDir));
  // 2. Dev/legacy: <repo>/bin/cloakbrowser/<platform>/
  candidateRoots.push(path.join(app.getAppPath(), 'bin', 'cloakbrowser', platformDir));
  // 3. Packaged: <resources>/cloakbrowser-<platform>/  (electron-builder extraResources)
  if (process.resourcesPath) {
    candidateRoots.push(path.join(process.resourcesPath, platformDir));
    candidateRoots.push(path.join(process.resourcesPath, 'resources', platformDir));
  }

  for (const root of candidateRoots) {
    const candidate = path.join(root, exe);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function configureCloakEnv(): void {
  // Highest priority: explicit override
  if (process.env.CLOAKBROWSER_BINARY_PATH) return;

  // Second priority: pre-extracted binary in app territory (resources/ etc.)
  const extracted = findExtractedBinary();
  if (extracted) {
    process.env.CLOAKBROWSER_BINARY_PATH = extracted;
  }

  // Cache dir is still useful even with a binary override (for download path,
  // version markers, future updates).
  if (!process.env.CLOAKBROWSER_CACHE_DIR) {
    process.env.CLOAKBROWSER_CACHE_DIR = getCloakCacheDir();
  }
  // Disable background auto-update checks — we surface explicit "check for
  // update" controls in the UI instead of doing surprise downloads.
  if (!process.env.CLOAKBROWSER_AUTO_UPDATE) {
    process.env.CLOAKBROWSER_AUTO_UPDATE = 'false';
  }
}

/** Returns the path of a pre-extracted binary if any, else null. Uses the
 *  same lookup as configureCloakEnv but without side effects. */
export function getExtractedBinaryPath(): string | null {
  if (process.env.CLOAKBROWSER_BINARY_PATH && existsSync(process.env.CLOAKBROWSER_BINARY_PATH)) {
    return process.env.CLOAKBROWSER_BINARY_PATH;
  }
  return findExtractedBinary();
}

async function loadCloak(): Promise<CloakLaunchModule> {
  if (cloakModule) return cloakModule;
  if (cloakLoadError) throw new Error(cloakLoadError);
  try {
    configureCloakEnv();
    const mod = (await import('cloakbrowser')) as unknown as CloakLaunchModule;
    if (typeof mod.launchPersistentContext !== 'function') {
      throw new Error('cloakbrowser module does not export launchPersistentContext');
    }
    cloakModule = mod;
    return mod;
  } catch (err) {
    cloakLoadError = (err as Error).message;
    throw err;
  }
}

/** Pre-download the patched Chromium binary into the cache directory. */
export async function ensureCloakBinary(
  onProgress?: (line: string) => void,
): Promise<{ ok: boolean; binaryPath?: string; version?: string; error?: string }> {
  try {
    const mod = await loadCloak();
    if (typeof mod.ensureBinary !== 'function') {
      return { ok: false, error: 'cloakbrowser does not expose ensureBinary' };
    }
    onProgress?.('开始检查/下载 CloakBrowser 二进制 (~200MB)…');
    const binaryPath = await mod.ensureBinary();
    const info = mod.binaryInfo?.();
    onProgress?.(`完成：${binaryPath}`);
    return { ok: true, binaryPath, version: info?.version };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function getCloakBinaryStatus(): Promise<{
  installed: boolean;
  version?: string;
  binaryPath?: string;
  cacheDir: string;
  downloadUrl?: string;
  source?: 'override' | 'extracted' | 'cache';
}> {
  try {
    const mod = await loadCloak();
    const info = mod.binaryInfo?.();

    // CloakBrowser's binaryInfo() only inspects its cache dir — it does NOT
    // honor CLOAKBROWSER_BINARY_PATH. Detect that case and report correctly.
    const overridePath = process.env.CLOAKBROWSER_BINARY_PATH;
    if (overridePath && existsSync(overridePath)) {
      const extracted = getExtractedBinaryPath();
      return {
        installed: true,
        version: info?.version, // expected version per cloakbrowser
        binaryPath: overridePath,
        cacheDir: info?.cacheDir ?? getCloakCacheDir(),
        downloadUrl: info?.downloadUrl,
        source: extracted === overridePath ? 'extracted' : 'override',
      };
    }

    return {
      installed: !!info?.installed,
      version: info?.version,
      binaryPath: info?.binaryPath,
      cacheDir: info?.cacheDir ?? getCloakCacheDir(),
      downloadUrl: info?.downloadUrl,
      source: info?.installed ? 'cache' : undefined,
    };
  } catch {
    return { installed: false, cacheDir: getCloakCacheDir() };
  }
}

/**
 * Import a manually-downloaded cloakbrowser-windows-x64.zip into the cache
 * directory. Mirrors the extract-then-flatten logic that cloakbrowser's own
 * downloader performs, so binaryInfo() will find it on the next call.
 */
export async function importCloakBinaryZip(
  zipPath: string,
  onProgress?: (line: string) => void,
): Promise<{ ok: boolean; binaryPath?: string; version?: string; error?: string }> {
  try {
    if (!existsSync(zipPath)) {
      return { ok: false, error: `文件不存在: ${zipPath}` };
    }
    const size = statSync(zipPath).size;
    if (size < 100 * 1024 * 1024) {
      return { ok: false, error: `文件过小 (${(size / 1024 / 1024).toFixed(1)}MB)，不像完整的 CloakBrowser 包` };
    }

    configureCloakEnv();
    const mod = await loadCloak();
    const info = mod.binaryInfo?.();
    if (!info) return { ok: false, error: '无法读取目标版本信息' };
    const version = info.version;
    const cacheDir = info.cacheDir; // .../chromium-<version>
    const binaryPath = info.binaryPath;

    onProgress?.(`目标版本: ${version}`);
    onProgress?.(`解压目录: ${cacheDir}`);

    if (existsSync(cacheDir)) {
      onProgress?.('清理旧目录…');
      rmSync(cacheDir, { recursive: true, force: true });
    }
    mkdirSync(cacheDir, { recursive: true });

    onProgress?.(`正在解压 (${(size / 1024 / 1024).toFixed(1)}MB)，约 1-3 分钟…`);
    if (process.platform === 'win32') {
      execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${zipPath}', '${cacheDir}')`,
        ],
        { timeout: 300_000 },
      );
    } else {
      execFileSync('unzip', ['-o', zipPath, '-d', cacheDir], { timeout: 300_000 });
    }

    // Flatten if there's a single wrapper directory
    const entries = readdirSync(cacheDir);
    if (entries.length === 1) {
      const sub = path.join(cacheDir, entries[0]);
      if (statSync(sub).isDirectory() && !entries[0].endsWith('.app')) {
        for (const child of readdirSync(sub)) {
          renameSync(path.join(sub, child), path.join(cacheDir, child));
        }
        rmdirSync(sub);
      }
    }

    if (!existsSync(binaryPath)) {
      return {
        ok: false,
        error: `解压完成但未找到 ${binaryPath}，请确认 zip 来源正确`,
      };
    }
    onProgress?.(`安装成功: ${binaryPath}`);
    return { ok: true, binaryPath, version };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Probe the proxy's exit IP via ipinfo.io (through the proxy itself) and
 * return a fingerprint with timezone / language / geolocation overridden to
 * match the IP. The original profile is not mutated.
 *
 * - timezone is always overridden to the IP's timezone (most important —
 *   Whoer / Pixelscan dock 10% if it doesn't match)
 * - locale & navigator.language are overridden ONLY if the user kept the
 *   default of "en-US" or didn't customize them — we don't want to surprise
 *   users who deliberately picked a non-IP-matching locale (e.g. running a
 *   US-based account from a JP residential proxy).
 * - geo (GPS) is set if the user enabled it but had stale coordinates
 */
async function alignFingerprintWithProxy(
  fp: import('@shared/types').FingerprintConfig,
  proxy: ProxyConfig | null,
): Promise<import('@shared/types').FingerprintConfig> {
  if (!proxy) return fp;
  let probe;
  try {
    probe = await testProxy(proxy, 8000);
  } catch (err) {
    console.warn('[launcher] proxy probe failed, using profile timezone as-is:', (err as Error).message);
    return fp;
  }
  if (!probe.ok) {
    console.warn('[launcher] proxy probe returned not-ok:', probe.error);
    return fp;
  }

  const aligned = JSON.parse(JSON.stringify(fp)) as typeof fp;
  if (probe.timezone && probe.timezone !== aligned.timezone) {
    console.log(`[launcher] timezone aligned: ${aligned.timezone} -> ${probe.timezone} (proxy exit ${probe.ip ?? '?'})`);
    aligned.timezone = probe.timezone;
  }
  if (probe.suggestedLocale) {
    // Only override locale if user has en-US default — otherwise respect their choice
    const userKeptDefault = aligned.locale === 'en-US';
    if (userKeptDefault && probe.suggestedLocale !== aligned.locale) {
      console.log(`[launcher] locale aligned: ${aligned.locale} -> ${probe.suggestedLocale}`);
      aligned.locale = probe.suggestedLocale;
      if (aligned.navigator) {
        aligned.navigator.language = probe.suggestedLocale;
        const existing = Array.isArray(aligned.navigator.languages) ? aligned.navigator.languages : [];
        aligned.navigator.languages = [
          probe.suggestedLocale,
          ...existing.filter((l) => l !== probe.suggestedLocale),
        ].slice(0, 4);
      }
    }
  }
  if (aligned.geo?.enabled && typeof probe.latitude === 'number' && typeof probe.longitude === 'number') {
    // Only refresh GPS if existing coords are clearly stale (>500km from IP)
    const dist = haversineKm(
      aligned.geo.latitude, aligned.geo.longitude,
      probe.latitude, probe.longitude,
    );
    if (dist > 500) {
      console.log(`[launcher] GPS aligned: ${dist.toFixed(0)}km off → refreshed to ${probe.latitude.toFixed(2)},${probe.longitude.toFixed(2)}`);
      aligned.geo.latitude = probe.latitude;
      aligned.geo.longitude = probe.longitude;
    }
  }
  return aligned;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export async function launchProfile(profileId: string): Promise<LaunchedBrowserInfo> {
  if (running.has(profileId)) {
    const r = running.get(profileId)!;
    return { profileId, startedAt: r.startedAt };
  }

  const profile: Profile | null = getProfile(profileId);
  if (!profile) throw new Error(`Profile ${profileId} not found`);
  const proxy: ProxyConfig | null = profile.proxyId ? getProxy(profile.proxyId) : null;

  // Auto-align fingerprint with proxy exit IP. Whoer / IPHey / Pixelscan all
  // dock points if system timezone differs from IP geolocation timezone. If a
  // proxy is bound, probe it ONCE here (no DB write) and override the launch
  // timezone / language to match the exit IP. Falls back silently if probe
  // fails or proxy is omitted.
  const fingerprintForLaunch = await alignFingerprintWithProxy(profile.fingerprint, proxy);

  const built = buildLaunchOptions(fingerprintForLaunch, proxy, profile.userDataDir);

  const blockingErrors = built.issues.filter((i) => i.level === 'error');
  if (blockingErrors.length > 0) {
    throw new Error(
      '指纹一致性校验失败：\n' + blockingErrors.map((e) => `[${e.field}] ${e.message}`).join('\n'),
    );
  }

  // CRITICAL: Chromium can't authenticate to SOCKS5 / authed HTTP proxies via
  // --proxy-server. Wrap such proxies in a local HTTP bridge that authenticates
  // upstream and presents a credentialless local HTTP endpoint to Chromium.
  // We also disable cloakbrowser's geoip auto-resolution because the bridge URL
  // (127.0.0.1) would resolve to localhost; the user's pre-set timezone/locale
  // (often filled by our "测试 & 应用" flow) drives the spoof instead.
  if (proxy && needsBridge(proxy)) {
    try {
      const localUrl = await startBridge(profileId, proxy, {
        // Kill-switch: if upstream is unreachable for 3 consecutive 30s probes
        // (~90s), close the browser context. Prevents the user from continuing
        // to surf through what is effectively a broken proxy and avoids any
        // edge-case fall-through to the host network.
        onDead: ({ failures }) => {
          console.error(`[launcher] proxy dead (${failures} failures) — closing profile ${profileId}`);
          void closeProfile(profileId);
        },
        probeIntervalMs: 30_000,
        failureThreshold: 3,
      });
      built.options.proxy = localUrl;
      built.options.geoip = false;
      console.log('[launcher] proxy bridge active:', localUrl, '->', `${proxy.type}://${proxy.host}:${proxy.port}`);
    } catch (err) {
      throw new Error('代理桥接启动失败：' + (err as Error).message);
    }
  }

  const cloak = await loadCloak();
  let context;
  try {
    context = await cloak.launchPersistentContext({
      userDataDir: built.userDataDir,
      ...built.options,
    });
  } catch (err) {
    // Roll back bridge so we don't leak a listening port if the browser failed
    // to start.
    await stopBridge(profileId).catch(() => undefined);
    throw err;
  }

  const startedAt = Date.now();
  running.set(profileId, { profileId, context, startedAt });
  markProfileOpened(profileId);

  if (typeof context.on === 'function') {
    context.on('close', () => {
      running.delete(profileId);
      void stopBridge(profileId);
    });
  }

  // Replay user-provided cookies BEFORE the first page is opened so that the
  // landing page sees them on its very first request. This is what makes
  // pasted-from-AdsPower sessions "just work" without re-login.
  if (profile.cookies && profile.cookies.trim() && typeof context.addCookies === 'function') {
    try {
      const parsed = parseCookieJson(profile.cookies);
      if (parsed.cookies.length > 0) {
        await context.addCookies(toPlaywrightCookies(parsed.cookies));
        console.log(`[launcher] injected ${parsed.cookies.length} cookies for profile ${profileId}`);
      }
      if (parsed.errors.length > 0) {
        // Non-fatal — we report counts so the user sees them in the dev console.
        console.warn(`[launcher] ${parsed.errors.length} cookies skipped during inject:`, parsed.errors.slice(0, 3));
      }
    } catch (err) {
      console.warn('[launcher] cookie injection failed (continuing without):', (err as Error).message);
    }
  }

  if (typeof context.newPage === 'function') {
    try {
      const pages = context.pages?.() ?? [];
      if (pages.length === 0) {
        await context.newPage();
      }
    } catch (err) {
      console.warn('Failed to ensure first page', err);
    }
  }

  return { profileId, startedAt };
}

export async function closeProfile(profileId: string): Promise<void> {
  const r = running.get(profileId);
  if (!r) return;
  try {
    await (r.context as { close: () => Promise<void> }).close();
  } catch (err) {
    console.error('Error closing profile', profileId, err);
  } finally {
    running.delete(profileId);
    await stopBridge(profileId);
  }
}

export function listRunning(): LaunchedBrowserInfo[] {
  return Array.from(running.values()).map((r) => ({
    profileId: r.profileId,
    startedAt: r.startedAt,
  }));
}

export async function closeAll(): Promise<void> {
  const ids = Array.from(running.keys());
  await Promise.all(ids.map((id) => closeProfile(id)));
}

export function isCloakAvailable(): { ok: boolean; error?: string } {
  if (cloakModule) return { ok: true };
  if (cloakLoadError) return { ok: false, error: cloakLoadError };
  return { ok: true };
}

/**
 * Run a fingerprint test by opening a temporary page in the given profile and
 * navigating it through a series of detection sites. Returns nothing here;
 * the user inspects results visually in the launched browser.
 */
export async function runFingerprintTest(
  profileId: string,
  urls: string[],
): Promise<{ openedUrls: string[] }> {
  await launchProfile(profileId);
  const r = running.get(profileId);
  if (!r) throw new Error('Failed to launch profile');
  const ctx = r.context as {
    newPage: () => Promise<{ goto: (url: string) => Promise<unknown> }>;
  };

  const opened: string[] = [];
  for (const url of urls) {
    try {
      const page = await ctx.newPage();
      await page.goto(url);
      opened.push(url);
    } catch (err) {
      console.warn('Failed to open test url', url, err);
    }
  }
  return { openedUrls: opened };
}
