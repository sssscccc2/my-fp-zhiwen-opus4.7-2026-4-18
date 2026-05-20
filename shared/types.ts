export type OSPlatform = 'windows' | 'mac' | 'linux' | 'ios' | 'android';

/**
 * Device category drives a different launch flow:
 *   - 'desktop' / 'tablet' / 'mobile'
 *
 * Mobile/tablet windows are launched with Playwright's mobile emulation
 * (`isMobile`, `hasTouch`, `deviceScaleFactor`, mobile `viewport`) on top of
 * an iOS Safari / Android Chrome User-Agent. This mirrors what BitBrowser
 * (比特浏览器) and AdsPower expose as the "mobile profile" mode — the site
 * sees `navigator.userAgent`, `Touch` events, `window.matchMedia('(pointer:coarse)')`
 * and viewport dimensions all consistent with a real phone / tablet.
 *
 * Desktop is the default (and only mode prior to v0.4.0). Existing profiles
 * that lack the field are treated as desktop.
 */
export type DeviceCategory = 'desktop' | 'tablet' | 'mobile';

export type CanvasMode = 'noise' | 'real' | 'block';
export type AudioMode = 'noise' | 'real' | 'block';
export type WebRTCMode = 'disabled' | 'altered' | 'real';

export interface NavigatorConfig {
  userAgent: string;
  platform: string;
  vendor: string;
  language: string;
  languages: string[];
  hardwareConcurrency: number;
  deviceMemory: number;
  doNotTrack: '0' | '1' | 'unspecified';
}

export interface ScreenConfig {
  width: number;
  height: number;
  availWidth: number;
  availHeight: number;
  colorDepth: number;
  pixelRatio: number;
}

export interface WebGLConfig {
  vendor: string;
  renderer: string;
  unmaskedVendor: string;
  unmaskedRenderer: string;
}

export interface GeoConfig {
  enabled: boolean;
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface FontsConfig {
  preset:
    | 'windows-10'
    | 'windows-11'
    | 'macos-13'
    | 'macos-14'
    | 'linux'
    | 'ios-17'
    | 'ios-18'
    | 'android-13'
    | 'android-14'
    | 'android-15'
    | 'android-16'
    | 'custom';
  customList?: string[];
}

/**
 * Mobile-specific knobs that only apply when `device` is 'mobile' or 'tablet'.
 * Driven by Playwright's mobile emulation (CDP `Emulation.setDeviceMetricsOverride`
 * + touch event subscription) **plus** CDP `Emulation.setUserAgentOverride`
 * with full `userAgentMetadata` so `navigator.userAgentData.mobile` /
 * `platform` / `model` and `Sec-CH-UA-*` headers all reflect a real phone.
 * Desktop windows ignore these completely.
 */
export interface MobileConfig {
  /** maxTouchPoints reported by `navigator.maxTouchPoints` (typical 5 for iOS, 5-10 Android). */
  maxTouchPoints: number;
  /** Browser brand on mobile: Safari for iOS, Chrome for Android, etc. */
  brand: 'Safari' | 'Chrome' | 'Edge' | 'Samsung Internet';
  /** Friendly model name for display (e.g. 'iPhone 17 Pro', 'Pixel 10 Pro'). */
  deviceModel?: string;
  /**
   * Internal device codename that real Chrome on the device reports in
   * `navigator.userAgentData.model` (high-entropy hint). Examples:
   *   - iPhone:  'iPhone18,1' (iPhone 17 Pro), 'iPhone16,1' (iPhone 15 Pro)
   *   - Android: 'SM-S938U' (Galaxy S25 Ultra), 'Pixel 10 Pro'
   * Detection: FingerprintJS Pro / Cloudflare Bot Management read this hint.
   */
  modelCode?: string;
  /**
   * OS version string that real devices report in
   * `navigator.userAgentData.platformVersion`. Examples:
   *   - iOS: '18.7.0' (iPhone 17 Pro stock), '17.0.1'
   *   - Android: '16.0.0', '15.0.0'
   * Embedded in UA string and Sec-CH-UA-Platform-Version header.
   */
  osVersion?: string;
  /**
   * Browser version (the Chrome / Safari engine version embedded in UA).
   * iOS Safari: '26.5' (Safari 26 = iOS 18 generation), '17.0'.
   * Android Chrome: '146.0.7680.177', '145.0.0.0'.
   * For Chrome / Edge, this also drives Sec-CH-UA brand list.
   */
  browserVersion?: string;
  /**
   * CPU architecture in `navigator.userAgentData.architecture` /
   * `Sec-CH-UA-Arch`. iOS / modern Android phones are always 'arm64' (or '').
   */
  architecture?: 'arm' | 'arm64' | '';
  /**
   * Form-factor list reported in `Sec-CH-UA-Form-Factors` header. Real Chrome
   * on phones ships ['Mobile'] in 2025+; foldables ship ['Mobile', 'Foldable'].
   * Tablets ship ['Tablet'] (no 'Mobile').
   */
  formFactors?: string[];
}

export interface FingerprintConfig {
  seed: number;
  os: OSPlatform;
  /** Form factor — drives mobile emulation at launch. Defaults to 'desktop'. */
  device?: DeviceCategory;
  brand: 'Chrome' | 'Edge';
  navigator: NavigatorConfig;
  screen: ScreenConfig;
  timezone: string;
  locale: string;
  geo: GeoConfig;
  webgl: WebGLConfig;
  canvas: { mode: CanvasMode };
  audio: { mode: AudioMode };
  webrtc: { mode: WebRTCMode };
  fonts: FontsConfig;
  storageQuotaMB: number;
  /** Only used when `device !== 'desktop'`. */
  mobile?: MobileConfig;
}

/**
 * DNS resolution mode for traffic going through a proxy.
 *
 * - 'proxy'  : let the proxy provider's exit node resolve hostnames (default,
 *              what most fingerprint browsers do). Works always but the DNS
 *              resolver IP that destination websites see is whatever the
 *              provider chose (usually Google US — leaks the fact you're
 *              behind a proxy when the proxy IP and DNS country mismatch).
 * - 'custom' : we resolve hostnames ourselves by sending TCP DNS queries
 *              THROUGH the SOCKS5 tunnel to a DNS server WE pick (typically
 *              an ISP DNS in the same country as the proxy exit). Then we
 *              SOCKS5-CONNECT to the resolved IP directly. End result:
 *              `ipleak.net` shows DNS resolvers in the target country,
 *              matching the IP — looks like a normal local user.
 *
 * Custom mode requires a SOCKS5 proxy (HTTP/HTTPS proxies don't expose a
 * raw tunnel for DNS).
 */
export type DnsMode = 'proxy' | 'custom';

export interface DnsConfig {
  mode: DnsMode;
  /** IPv4/IPv6 of the DNS server (only used when mode === 'custom'). */
  customServer?: string;
  /** Human label, e.g. "台湾 HiNet 168.95.1.1" — for display only. */
  customLabel?: string;
}

export interface ProxyConfig {
  id: string;
  name: string;
  type: 'http' | 'https' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
  notes?: string;
  /** DNS routing strategy for this proxy. Defaults to 'proxy' if absent. */
  dns?: DnsConfig;
  lastTestedAt?: number;
  lastTestIp?: string;
  lastTestCountry?: string;
  lastTestLatencyMs?: number;
  lastTestOk?: boolean;
}

export interface ProxyTestResult {
  ok: boolean;
  ip?: string;
  country?: string;        // ISO-3166 alpha-2, e.g. "US"
  region?: string;
  city?: string;
  org?: string;
  postal?: string;
  timezone?: string;       // IANA, e.g. "America/New_York"
  latitude?: number;
  longitude?: number;
  suggestedLocale?: string; // BCP-47, e.g. "en-US"
  latencyMs?: number;
  error?: string;
}

export interface ParsedProxy {
  type: 'http' | 'https' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
  /** Original input string (for display). */
  raw: string;
}

/**
 * Speed profile for CloakBrowser's `humanize` mode (per-character keyboard
 * delay, Bézier-curve mouse, scroll easing).
 *   - 'default' : normal-speed human emulation
 *   - 'careful' : slower & more deliberate — gives 0.9 reCAPTCHA scores at
 *                  the cost of throughput. Recommended for first-time login
 *                  to a hostile site, then switch back to default.
 */
export type HumanPreset = 'default' | 'careful';

export interface Profile {
  id: string;
  name: string;
  groupId?: string | null;
  tags: string[];
  fingerprint: FingerprintConfig;
  proxyId?: string | null;
  userDataDir: string;
  createdAt: number;
  lastOpenedAt?: number | null;
  notes?: string;
  /**
   * Pre-injected cookies (BrowserCookie[]). Stored as JSON so we keep schema
   * flexible; parsed by `shared/cookieFormats.ts`. Imported once via the
   * editor's "Cookies" tab and replayed into the BrowserContext on every
   * launch via `context.addCookies()`.
   */
  cookies?: string;
  // --- v0.5.0: CloakBrowser 0.3.29 advanced knobs (all optional, sensible defaults) ---
  /** Speed of humanize input emulation. Defaults to 'default'. */
  humanPreset?: HumanPreset;
  /**
   * Force HTTP/1.1 (--disable-http2) for fresh-session warmup against
   * sites that challenge first HTTP/2 visitors. Defaults to false.
   */
  disableHttp2?: boolean;
  /**
   * Whether to keep canvas / WebGL / audio noise injection. Defaults to true.
   * Disabling produces deterministic per-seed values — useful only when a
   * site fingerprints the NOISE pattern itself (extremely rare).
   */
  fingerprintNoise?: boolean;
}

export interface ProfileGroup {
  id: string;
  name: string;
  color: string;
}

export interface PresetTemplate {
  id: string;
  name: string;
  description: string;
  marketShare: number;
  fingerprint: Omit<FingerprintConfig, 'seed'>;
}

export interface LaunchedBrowserInfo {
  profileId: string;
  pid?: number;
  startedAt: number;
}

export interface CreateProfileInput {
  name: string;
  groupId?: string | null;
  tags?: string[];
  presetId?: string;
  fingerprint?: FingerprintConfig;
  proxyId?: string | null;
  notes?: string;
  cookies?: string;
  humanPreset?: HumanPreset;
  disableHttp2?: boolean;
  fingerprintNoise?: boolean;
}

export interface UpdateProfileInput {
  id: string;
  name?: string;
  groupId?: string | null;
  tags?: string[];
  fingerprint?: FingerprintConfig;
  proxyId?: string | null;
  notes?: string;
  cookies?: string;
  humanPreset?: HumanPreset;
  disableHttp2?: boolean;
  fingerprintNoise?: boolean;
}
