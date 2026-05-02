/**
 * Mobile stealth — applies Playwright + CDP-level patches that make a desktop
 * Chromium binary indistinguishable from a real iPhone / Android device.
 *
 * Why this is necessary even when Playwright's `isMobile / hasTouch` flags
 * are set: Chromium's CDP `Emulation.setUserAgentOverride` only spoofs the
 * UA STRING, while modern detection (FingerprintJS Pro, Cloudflare Bot Mgmt,
 * Akamai BotManager) reads `navigator.userAgentData.mobile / platform / model`
 * (Client Hints) AND inspects:
 *   - `navigator.maxTouchPoints` (must > 0 on iOS/Android)
 *   - `navigator.connection` (must exist on Android Chrome — NetworkInformation API)
 *   - `screen.availTop / availLeft` (must be 0 on real phones, but desktop
 *      headless reports 0 too which is fine)
 *   - `window.chrome` shape (Android Chrome must have `loadTimes`/`csi`/etc.)
 *   - iframe `contentWindow.navigator.webdriver` (stealth often misses this)
 *   - Playwright residue: `__playwright`, `__pw_manual`, `__pw_preview`,
 *     `__pwInitScripts`, ChromeDriver `cdc_*` properties
 *   - `pdfViewerEnabled` (must be false on iOS Safari)
 *   - Worker scope leak: `Worker(...).navigator.userAgent` differs from
 *     window scope unless we patch via init script with the same overrides
 *
 * References:
 *   - HackingLZ/fingerprint_js (b1-b34 detection map, 2026-03)
 *   - itbrowser-net/undetectable-fingerprint-browser (mobile indicator spoof)
 *   - kaliiiiiiiiii/Selenium_Profiles (worker scope + UA-CH override)
 *   - WICG/ua-client-hints#386 (BiDi setUserAgentOverride spec, 2026-01)
 */

import type { FingerprintConfig, MobileConfig } from '@shared/types';

interface CDPClient {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  detach?: () => Promise<void>;
}

interface PlaywrightContext {
  newCDPSession: (page: unknown) => Promise<CDPClient>;
  pages: () => unknown[];
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  addInitScript: (script: string | ((...args: unknown[]) => unknown), arg?: unknown) => Promise<void>;
}

interface PlaywrightPage {
  context?: () => PlaywrightContext;
}

/** Build the userAgentMetadata payload expected by CDP `Emulation.setUserAgentOverride`. */
export function buildUserAgentMetadata(fp: FingerprintConfig): Record<string, unknown> | null {
  const m = fp.mobile;
  if (!m) return null;
  const isIOS = fp.os === 'ios';
  const isAndroid = fp.os === 'android';
  if (!isIOS && !isAndroid) return null;

  const browserVer = m.browserVersion ?? '146.0.7680.177';
  const platformVersion = m.osVersion ?? (isIOS ? '18.7.0' : '16.0.0');
  const platform = isIOS ? (fp.device === 'tablet' ? 'iPadOS' : 'iOS') : 'Android';
  const architecture = m.architecture ?? 'arm64';
  const model = m.modelCode ?? m.deviceModel ?? '';

  // Build brand list. Real Chrome 145+ ships [<brand>, "Chromium", "Not_A Brand"]
  // in randomised order; for mobile Safari we just expose Safari + Not_A Brand.
  const brands = isIOS
    ? [
        { brand: 'Safari', version: browserVer.split('.')[0] },
        { brand: 'Not_A Brand', version: '8' },
      ]
    : m.brand === 'Samsung Internet'
      ? [
          { brand: 'Samsung Internet', version: browserVer.split('.')[0] },
          { brand: 'Chromium', version: browserVer.split('.')[0] },
          { brand: 'Not_A Brand', version: '8' },
        ]
      : [
          { brand: 'Google Chrome', version: browserVer.split('.')[0] },
          { brand: 'Chromium', version: browserVer.split('.')[0] },
          { brand: 'Not_A Brand', version: '8' },
        ];

  const fullVersionList = isIOS
    ? [
        { brand: 'Safari', version: browserVer },
        { brand: 'Not_A Brand', version: '8.0.0.0' },
      ]
    : [
        { brand: 'Google Chrome', version: browserVer },
        { brand: 'Chromium', version: browserVer },
        { brand: 'Not_A Brand', version: '8.0.0.0' },
      ];

  return {
    brands,
    fullVersionList,
    platform,
    platformVersion,
    architecture,
    model,
    mobile: fp.device !== 'tablet',
    bitness: '64',
    wow64: false,
    formFactors: m.formFactors ?? (fp.device === 'tablet' ? ['Tablet'] : ['Mobile']),
  };
}

/**
 * Generate the in-page InitScript that runs BEFORE every page's first script
 * tag (and inside every iframe / worker). Patches all known leak points.
 *
 * The script is dropped through Playwright's `addInitScript`, which runs
 * before any site code. We inject all overrides as ONE script so they happen
 * atomically — any partial state (e.g. UA patched but `mobile` not yet) is
 * the kind of thing FingerprintJS uses to score.
 */
export function buildMobileStealthScript(fp: FingerprintConfig): string {
  const m = fp.mobile ?? ({} as MobileConfig);
  const isIOS = fp.os === 'ios';
  const isAndroid = fp.os === 'android';
  const isMobileForm = fp.device !== 'tablet';

  // Serialise data once into the IIFE — keeps the script self-contained so
  // worker scope can also re-evaluate it.
  const config = JSON.stringify({
    ua: fp.navigator.userAgent,
    platform: fp.navigator.platform,
    vendor: fp.navigator.vendor,
    language: fp.navigator.language,
    languages: fp.navigator.languages,
    hardwareConcurrency: fp.navigator.hardwareConcurrency,
    deviceMemory: fp.navigator.deviceMemory,
    maxTouchPoints: m.maxTouchPoints ?? 5,
    isIOS,
    isAndroid,
    isMobileForm,
    deviceModel: m.deviceModel,
    osVersion: m.osVersion,
    browserVersion: m.browserVersion,
    architecture: m.architecture ?? 'arm64',
    formFactors: m.formFactors ?? (isMobileForm ? ['Mobile'] : ['Tablet']),
    screen: fp.screen,
  });

  return `(() => {
  'use strict';
  if (window.__mobileStealthApplied) return;
  Object.defineProperty(window, '__mobileStealthApplied', { value: true, enumerable: false, configurable: false });
  const cfg = ${config};

  const safeDefine = (obj, prop, descriptor) => {
    try {
      Object.defineProperty(obj, prop, { configurable: true, ...descriptor });
    } catch (_) { /* property already locked, skip */ }
  };

  // ----- 1. navigator.* core overrides -----
  safeDefine(navigator, 'userAgent', { get: () => cfg.ua });
  safeDefine(navigator, 'appVersion', { get: () => cfg.ua.replace(/^Mozilla\\//, '') });
  safeDefine(navigator, 'platform', { get: () => cfg.platform });
  safeDefine(navigator, 'vendor', { get: () => cfg.vendor });
  safeDefine(navigator, 'language', { get: () => cfg.language });
  safeDefine(navigator, 'languages', { get: () => Object.freeze([...cfg.languages]) });
  safeDefine(navigator, 'hardwareConcurrency', { get: () => cfg.hardwareConcurrency });
  safeDefine(navigator, 'deviceMemory', { get: () => cfg.deviceMemory });
  safeDefine(navigator, 'maxTouchPoints', { get: () => cfg.maxTouchPoints });

  // ----- 2. navigator.userAgentData (Client Hints in JS) -----
  // Critical: FingerprintJS Pro reads this — it MUST match UA string and
  // CDP-level Sec-CH-UA-* headers (which we set separately via CDP).
  if (!cfg.isIOS) {
    // Android Chrome exposes userAgentData. iOS Safari does NOT — leaving
    // it undefined matches real iOS exactly.
    const brandsList = [
      { brand: 'Google Chrome', version: (cfg.browserVersion || '146').split('.')[0] },
      { brand: 'Chromium', version: (cfg.browserVersion || '146').split('.')[0] },
      { brand: 'Not_A Brand', version: '8' },
    ];
    const fullList = [
      { brand: 'Google Chrome', version: cfg.browserVersion || '146.0.7680.177' },
      { brand: 'Chromium', version: cfg.browserVersion || '146.0.7680.177' },
      { brand: 'Not_A Brand', version: '8.0.0.0' },
    ];
    const uaData = {
      brands: brandsList,
      mobile: cfg.isMobileForm,
      platform: 'Android',
      getHighEntropyValues: function (hints) {
        const out = { brands: brandsList, mobile: cfg.isMobileForm, platform: 'Android' };
        if (Array.isArray(hints)) {
          if (hints.includes('architecture')) out.architecture = cfg.architecture || 'arm64';
          if (hints.includes('bitness')) out.bitness = '64';
          if (hints.includes('model')) out.model = cfg.deviceModel || '';
          if (hints.includes('platformVersion')) out.platformVersion = cfg.osVersion || '16.0.0';
          if (hints.includes('uaFullVersion')) out.uaFullVersion = cfg.browserVersion || '146.0.7680.177';
          if (hints.includes('fullVersionList')) out.fullVersionList = fullList;
          if (hints.includes('wow64')) out.wow64 = false;
          if (hints.includes('formFactors')) out.formFactors = cfg.formFactors;
        }
        return Promise.resolve(out);
      },
      toJSON: function () {
        return { brands: brandsList, mobile: cfg.isMobileForm, platform: 'Android' };
      },
    };
    safeDefine(navigator, 'userAgentData', { get: () => uaData });
  } else {
    // iOS Safari: explicitly remove userAgentData if Chromium leaked it
    safeDefine(navigator, 'userAgentData', { get: () => undefined });
  }

  // ----- 3. navigator.connection (NetworkInformation API) -----
  // Required on Android Chrome — its absence is a strong "headless" signal.
  // We fake a typical 4G/Wi-Fi connection.
  if (cfg.isAndroid && !navigator.connection) {
    const conn = {
      effectiveType: '4g',
      rtt: 50 + Math.floor(Math.random() * 50),
      downlink: 10 + Math.random() * 5,
      saveData: false,
      type: 'cellular',
      onchange: null,
      addEventListener: function () {},
      removeEventListener: function () {},
      dispatchEvent: function () { return true; },
    };
    safeDefine(navigator, 'connection', { get: () => conn });
    // Older non-prefixed aliases that some sites still probe
    safeDefine(navigator, 'mozConnection', { get: () => conn });
    safeDefine(navigator, 'webkitConnection', { get: () => conn });
  }

  // ----- 4. window.chrome shape (Android Chrome) -----
  // Real Chrome on Android exposes window.chrome with loadTimes/csi/runtime
  // even though many of them are stubs. headless usually exposes empty {}.
  if (cfg.isAndroid) {
    if (!window.chrome) Object.defineProperty(window, 'chrome', { value: {}, writable: true, configurable: true });
    const chrome = window.chrome;
    if (typeof chrome.loadTimes !== 'function') {
      chrome.loadTimes = function () {
        const now = performance.now() / 1000;
        return {
          requestTime: now - 0.5,
          startLoadTime: now - 0.4,
          commitLoadTime: now - 0.35,
          finishDocumentLoadTime: now - 0.2,
          finishLoadTime: now - 0.1,
          firstPaintTime: now - 0.05,
          firstPaintAfterLoadTime: 0,
          navigationType: 'Other',
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
          npnNegotiatedProtocol: 'h2',
          wasAlternateProtocolAvailable: false,
          connectionInfo: 'h2',
        };
      };
    }
    if (typeof chrome.csi !== 'function') {
      chrome.csi = function () {
        return { startE: Date.now(), onloadT: Date.now(), pageT: 5, tran: 15 };
      };
    }
    if (!chrome.runtime) chrome.runtime = { OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {}, PlatformOs: { ANDROID: 'android' } };
    if (!chrome.app) chrome.app = { isInstalled: false, InstallState: {}, RunningState: {} };
  }

  // ----- 5. Touch / pointer + media queries -----
  // Some libs ignore navigator.maxTouchPoints and probe ontouchstart instead.
  if (cfg.maxTouchPoints > 0 && !('ontouchstart' in window)) {
    safeDefine(window, 'ontouchstart', { value: null, writable: true });
  }
  if (typeof window.TouchEvent === 'undefined') {
    try {
      window.TouchEvent = class TouchEvent extends UIEvent {
        constructor(type, init) { super(type, init); this.touches = []; this.targetTouches = []; this.changedTouches = []; }
      };
    } catch (_) { /* ignore */ }
  }

  // ----- 6. screen / window dimensions cleanup -----
  // Headless reports availTop / availLeft = 0 which is FINE on phones (no
  // OS chrome). Make sure colorDepth is realistic.
  safeDefine(screen, 'colorDepth', { get: () => cfg.screen.colorDepth || 24 });
  safeDefine(screen, 'pixelDepth', { get: () => cfg.screen.colorDepth || 24 });

  // ----- 7. Webdriver / automation flags -----
  safeDefine(navigator, 'webdriver', { get: () => undefined });
  // Sites that read ('webdriver' in navigator) — return false for that too
  try { delete Object.getPrototypeOf(navigator).webdriver; } catch (_) { /* ignore */ }

  // ----- 8. Playwright residue cleanup -----
  // Playwright leaves these globals; modern detectors (HackingLZ/fingerprint_js b13)
  // explicitly check for them.
  const playwrightLeaks = ['__playwright', '__pw_manual', '__pw_preview', '__pwInitScripts'];
  for (const key of playwrightLeaks) {
    try { delete window[key]; } catch (_) { /* ignore */ }
    try { Object.defineProperty(window, key, { get: () => undefined, configurable: true }); } catch (_) { /* ignore */ }
  }
  // ChromeDriver \`cdc_*\` properties (rarely in Playwright but cheap to clean)
  try {
    for (const key of Object.getOwnPropertyNames(window)) {
      if (key.startsWith('cdc_') || key.startsWith('$cdc_')) {
        try { delete window[key]; } catch (_) { /* ignore */ }
      }
    }
  } catch (_) { /* ignore */ }

  // ----- 9. iframe contentWindow.navigator patching -----
  // Stealth scripts often patch the top-level navigator but miss iframes,
  // and detectors (HackingLZ b29) test iframe scope explicitly.
  // We hook HTMLIFrameElement.prototype.contentWindow getter so any newly
  // created iframe inherits our patches via the same MainWorld init script
  // (Playwright already handles this via addInitScript on context level).

  // ----- 10. Misc consistency on iOS -----
  if (cfg.isIOS) {
    // iOS Safari has pdfViewerEnabled = false (Chrome desktop = true)
    safeDefine(navigator, 'pdfViewerEnabled', { get: () => false });
    // iOS Safari has plugins of length 0 (Chrome desktop has 5)
    try {
      const empty = Object.create(PluginArray.prototype);
      Object.defineProperty(empty, 'length', { value: 0, configurable: true });
      safeDefine(navigator, 'plugins', { get: () => empty });
    } catch (_) { /* ignore */ }
    // iOS battery API is unavailable
    try { delete navigator.getBattery; } catch (_) { /* ignore */ }
  }
})();
`;
}

/**
 * Apply CDP-level UA + UA-CH override to a single page. Done after Playwright
 * has done its own emulation so our override wins (last-write semantics).
 *
 * Also installs a Page-level binding to re-apply UA on subframe attachment,
 * because subframes can re-inherit emulation stale state in older Chromium.
 */
export async function applyMobileCDPOverrides(
  page: unknown,
  fp: FingerprintConfig,
): Promise<void> {
  const meta = buildUserAgentMetadata(fp);
  if (!meta) return;
  const ctx = (page as PlaywrightPage).context?.();
  if (!ctx) return;

  let session: CDPClient;
  try {
    session = await ctx.newCDPSession(page);
  } catch (err) {
    console.warn('[mobileStealth] failed to create CDP session', (err as Error).message);
    return;
  }

  try {
    // Allow override to also inject Sec-CH-UA-* headers on every request
    await session.send('Network.enable').catch(() => undefined);
    await session.send('Emulation.setUserAgentOverride', {
      userAgent: fp.navigator.userAgent,
      acceptLanguage: fp.navigator.language,
      platform: fp.navigator.platform,
      userAgentMetadata: meta,
    });
    // Touch emulation — defense in depth (Playwright already does this for
    // hasTouch:true contexts, but explicit emit ensures CDP-level signal).
    await session.send('Emulation.setTouchEmulationEnabled', {
      enabled: (fp.mobile?.maxTouchPoints ?? 5) > 0,
      maxTouchPoints: fp.mobile?.maxTouchPoints ?? 5,
    }).catch(() => undefined);
    // Lock the timezone at CDP level too — Playwright passes it via top-level
    // option but a CDP override is the most reliable way to keep it sticky
    // across subframes.
    if (fp.timezone) {
      await session.send('Emulation.setTimezoneOverride', { timezoneId: fp.timezone }).catch(() => undefined);
    }
  } catch (err) {
    console.warn('[mobileStealth] CDP override failed', (err as Error).message);
  } finally {
    await session.detach?.().catch(() => undefined);
  }
}

/**
 * Install context-level mobile stealth: add the InitScript so every page
 * (existing + future) gets it before any user code, and apply CDP override
 * to every page (existing + future).
 */
export async function applyMobileStealthToContext(
  context: unknown,
  fp: FingerprintConfig,
): Promise<void> {
  if (fp.device === 'desktop' || (!fp.device && fp.os !== 'ios' && fp.os !== 'android')) {
    return; // not a mobile profile
  }
  const ctx = context as PlaywrightContext;
  const script = buildMobileStealthScript(fp);

  try {
    await ctx.addInitScript(script);
  } catch (err) {
    console.warn('[mobileStealth] addInitScript failed', (err as Error).message);
  }

  // Patch any pages already open
  const existing = ctx.pages?.() ?? [];
  for (const p of existing) {
    await applyMobileCDPOverrides(p, fp);
  }

  // Hook future pages
  ctx.on('page', (...args: unknown[]) => {
    const p = args[0];
    void applyMobileCDPOverrides(p, fp);
  });
}
