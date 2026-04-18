export type OSPlatform = 'windows' | 'mac' | 'linux';

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
  preset: 'windows-10' | 'windows-11' | 'macos-13' | 'macos-14' | 'linux' | 'custom';
  customList?: string[];
}

export interface FingerprintConfig {
  seed: number;
  os: OSPlatform;
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
}
