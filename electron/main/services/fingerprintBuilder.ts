import type { FingerprintConfig, ProxyConfig } from '@shared/types';
import { screen } from 'electron';

/**
 * Compute the actual on-screen window size for the launched browser.
 *
 * The fingerprint reports `fp.screen.width/height` (e.g. 1920x1080) as what
 * the SITE sees via `window.screen.*` and `--fingerprint-screen-*` — that's
 * the SPOOF. But the REAL Chromium window has to physically fit the user's
 * monitor, otherwise it overflows off-screen and the user can't see the
 * right side / scrollbars.
 *
 * Logic:
 *   - find the primary display's work area (excludes taskbar)
 *   - cap the spoof size to 95% of the work area (leaving room for chrome UI)
 *   - keep aspect ratio of the spoofed dimensions where possible
 *   - never go below 1024x720 (would break layout on most sites)
 */
function computeRealWindowSize(spoofedW: number, spoofedH: number): { w: number; h: number } {
  let workW = spoofedW;
  let workH = spoofedH;
  try {
    const primary = screen.getPrimaryDisplay();
    workW = primary.workAreaSize.width;
    workH = primary.workAreaSize.height;
  } catch {
    // app may not be ready yet during early init — fall back to spoof
  }
  const maxW = Math.floor(workW * 0.95);
  const maxH = Math.floor(workH * 0.95);
  if (spoofedW <= maxW && spoofedH <= maxH) {
    // Spoofed size fits perfectly — use it.
    return { w: spoofedW, h: spoofedH };
  }
  // Scale down preserving the spoofed aspect ratio.
  const ratio = Math.min(maxW / spoofedW, maxH / spoofedH);
  return {
    w: Math.max(1024, Math.floor(spoofedW * ratio)),
    h: Math.max(720, Math.floor(spoofedH * ratio)),
  };
}

export interface ConsistencyIssue {
  level: 'error' | 'warning';
  field: string;
  message: string;
}

/**
 * Cross-checks fingerprint coherence. Modern anti-bot systems flag any single
 * mismatch (e.g. Mac UA + Windows GPU). Anything returned here as 'error'
 * should block launching; warnings are surfaced to the user.
 */
export function validateConsistency(fp: FingerprintConfig): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  // Defensive: profiles created with an older schema may lack some sub-objects.
  // Surface as a single coherent error rather than crashing with TypeError.
  if (!fp || typeof fp !== 'object') {
    return [{ level: 'error', field: 'fingerprint', message: '指纹配置缺失（fingerprint=null）' }];
  }
  if (!fp.navigator || typeof fp.navigator !== 'object') {
    issues.push({ level: 'error', field: 'navigator', message: '缺少 navigator 配置（请重新随机生成指纹后保存）' });
  }
  if (!fp.webgl || typeof fp.webgl !== 'object') {
    issues.push({ level: 'error', field: 'webgl', message: '缺少 webgl 配置（请重新随机生成指纹后保存）' });
  }
  if (!fp.screen || typeof fp.screen !== 'object') {
    issues.push({ level: 'error', field: 'screen', message: '缺少 screen 配置（请重新随机生成指纹后保存）' });
  }
  if (issues.length > 0) return issues;

  const ua = (fp.navigator.userAgent ?? '').toLowerCase();
  const renderer = (fp.webgl.renderer ?? '').toLowerCase();

  const uaIsWindows = ua.includes('windows');
  const uaIsMac = ua.includes('mac os x') || ua.includes('macintosh');
  const uaIsLinux = ua.includes('linux') && !ua.includes('android');

  if (fp.os === 'windows' && !uaIsWindows) {
    issues.push({ level: 'error', field: 'navigator.userAgent', message: 'OS=windows 但 UA 中未包含 Windows 标识' });
  }
  if (fp.os === 'mac' && !uaIsMac) {
    issues.push({ level: 'error', field: 'navigator.userAgent', message: 'OS=mac 但 UA 中未包含 Mac 标识' });
  }
  if (fp.os === 'linux' && !uaIsLinux) {
    issues.push({ level: 'error', field: 'navigator.userAgent', message: 'OS=linux 但 UA 中未包含 Linux 标识' });
  }

  const platform = fp.navigator.platform;
  if (fp.os === 'windows' && platform !== 'Win32') {
    issues.push({ level: 'error', field: 'navigator.platform', message: `Windows 系统 platform 应为 "Win32"，当前 "${platform}"` });
  }
  if (fp.os === 'mac' && platform !== 'MacIntel') {
    issues.push({ level: 'error', field: 'navigator.platform', message: `Mac 系统 platform 应为 "MacIntel"，当前 "${platform}"` });
  }
  if (fp.os === 'linux' && !platform.startsWith('Linux')) {
    issues.push({ level: 'error', field: 'navigator.platform', message: `Linux 系统 platform 应以 "Linux" 开头，当前 "${platform}"` });
  }

  const rendererIsApple = renderer.includes('apple') || renderer.includes('metal');
  const rendererIsWindowsGpu =
    renderer.includes('direct3d') || renderer.includes('d3d11') || renderer.includes('angle');
  const rendererIsMesa = renderer.includes('mesa');

  if (fp.os === 'windows' && rendererIsApple) {
    issues.push({ level: 'error', field: 'webgl.renderer', message: 'Windows 系统不可能出现 Apple Metal 渲染器' });
  }
  if (fp.os === 'mac' && rendererIsMesa) {
    issues.push({ level: 'warning', field: 'webgl.renderer', message: 'macOS 通常不使用 Mesa 渲染器' });
  }
  if (fp.os === 'linux' && (renderer.includes('direct3d') || renderer.includes('d3d11'))) {
    issues.push({ level: 'error', field: 'webgl.renderer', message: 'Linux 不可能使用 DirectX/D3D 渲染器' });
  }
  if (fp.os === 'mac' && !rendererIsApple && !renderer.includes('intel')) {
    issues.push({ level: 'warning', field: 'webgl.renderer', message: 'Mac 渲染器看起来不像是 Apple 或 Intel GPU' });
  }
  if (fp.os === 'windows' && !rendererIsWindowsGpu) {
    issues.push({ level: 'warning', field: 'webgl.renderer', message: 'Windows 渲染器通常应包含 ANGLE/Direct3D' });
  }

  if (![1, 2, 3].includes(fp.screen.pixelRatio)) {
    issues.push({ level: 'warning', field: 'screen.pixelRatio', message: 'devicePixelRatio 通常为 1/2/3' });
  }
  if (fp.os === 'mac' && fp.screen.pixelRatio === 1) {
    issues.push({ level: 'warning', field: 'screen.pixelRatio', message: 'Mac 视网膜屏 devicePixelRatio 通常为 2' });
  }

  if (![1, 2, 4, 6, 8, 12, 16, 20, 24, 32].includes(fp.navigator.hardwareConcurrency)) {
    issues.push({ level: 'warning', field: 'navigator.hardwareConcurrency', message: 'CPU 核心数为非常见值' });
  }
  if (![0.25, 0.5, 1, 2, 4, 8].includes(fp.navigator.deviceMemory)) {
    issues.push({ level: 'warning', field: 'navigator.deviceMemory', message: 'deviceMemory 通常为 0.25/0.5/1/2/4/8（W3C 截断后的值）' });
  }

  return issues;
}

export interface BuildLaunchOptionsResult {
  /** Path to use as `userDataDir` for cloakbrowser persistent context */
  userDataDir: string;
  /** Options passed to cloakbrowser launchPersistentContext */
  options: Record<string, unknown>;
  /** The CLI args (subset, also placed into options.args) */
  args: string[];
  /** Issues found during consistency validation */
  issues: ConsistencyIssue[];
}

function buildProxyString(proxy: ProxyConfig | null): string | undefined {
  if (!proxy) return undefined;
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password ?? '')}@`
    : '';
  const scheme = proxy.type === 'https' ? 'https' : proxy.type === 'socks5' ? 'socks5' : 'http';
  return `${scheme}://${auth}${proxy.host}:${proxy.port}`;
}

/**
 * Convert our FingerprintConfig + Proxy into a launch options object suitable
 * for `cloakbrowser.launchPersistentContext(userDataDir, options)`.
 */
export function buildLaunchOptions(
  fp: FingerprintConfig,
  proxy: ProxyConfig | null,
  userDataDir: string,
  opts: { headless?: boolean; humanize?: boolean } = {},
): BuildLaunchOptionsResult {
  const issues = validateConsistency(fp);

  // If validation already flagged structural problems, don't try to build args
  // (would only crash with an obscure TypeError). Caller must surface issues.
  if (issues.some((i) => i.level === 'error' && (
    i.field === 'fingerprint' || i.field === 'navigator' || i.field === 'webgl' || i.field === 'screen'
  ))) {
    return { userDataDir, options: {}, args: [], issues };
  }

  // CloakBrowser maps: 'mac' -> 'macos'. Keep our domain language consistent.
  const cloakPlatform = fp.os === 'mac' ? 'macos' : fp.os;

  // Real window size = clamped to user's actual monitor; spoofed size stays
  // exactly what fp.screen reports (sites read window.screen.* / inner*).
  // This is what AdsPower / BitBrowser also do — title bar fits on a 1080p
  // monitor while JS still sees 1920x1080.
  const realWin = computeRealWindowSize(fp.screen.width, fp.screen.height);

  // CloakBrowser auto-derives hardware/screen/GPU from seed when not specified;
  // we only override what the user explicitly customized in the preset so that
  // the C++ patches stay coherent with each other.
  const args: string[] = [
    `--fingerprint=${fp.seed}`,
    `--fingerprint-platform=${cloakPlatform}`,
    `--fingerprint-brand=${fp.brand}`,
    `--fingerprint-gpu-vendor=${fp.webgl.vendor}`,
    `--fingerprint-gpu-renderer=${fp.webgl.renderer}`,
    `--fingerprint-hardware-concurrency=${fp.navigator.hardwareConcurrency}`,
    `--fingerprint-device-memory=${fp.navigator.deviceMemory}`,
    // SPOOFED screen size — what JS sees via window.screen.*
    `--fingerprint-screen-width=${fp.screen.width}`,
    `--fingerprint-screen-height=${fp.screen.height}`,
    `--fingerprint-timezone=${fp.timezone}`,
    `--fingerprint-locale=${fp.locale}`,
    `--fingerprint-storage-quota=${fp.storageQuotaMB}`,
    // REAL window size — clamped to the user's monitor so it fits on screen.
    `--window-size=${realWin.w},${realWin.h}`,
    `--window-position=0,0`,
    // Defense-in-depth (most of these are also handled by cloakbrowser's
    // C++ patches, but explicit redundancy doesn't hurt and helps if a
    // future binary version regresses).
    '--disable-blink-features=AutomationControlled',
  ];

  // Disabled features — collected then emitted as a single comma-joined flag
  // because Chromium uses last-wins for repeated --disable-features.
  const disabledFeatures = [
    'IsolateOrigins',
    'site-per-process',
    'SidePanelPinning',
  ];

  if (fp.webrtc.mode === 'disabled') {
    args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
  } else if (fp.webrtc.mode === 'altered') {
    args.push('--force-webrtc-ip-handling-policy=default_public_interface_only');
  }

  // -------- DNS / IP-leak hardening when a proxy is bound --------
  if (proxy) {
    // 1. Stop DNS prefetch — Chrome would otherwise speculatively resolve
    //    hostnames via the system resolver before any HTTP request goes
    //    through the proxy, leaking which sites you intend to visit.
    // 2. Disable DNS-over-HTTPS — Chrome's secure DNS bypasses the proxy
    //    entirely (sends queries straight to Cloudflare/Google over TLS).
    // 3. Disable network prediction — same prefetch concern.
    disabledFeatures.push(
      'AsyncDns',
      'DnsOverHttps',
      'DnsHttpsSvcb',
      'UseDnsHttpsSvcbAlpn',
      'NetworkPrediction',
      // QUIC on UDP/443 can bypass HTTP CONNECT tunnels — kill it via
      // --disable-quic AND disable here for belt-and-braces.
      'WebRtcHideLocalIpsWithMdns',
    );
    args.push(
      '--dns-prefetch-disable',
      // Force SOCKS-style "remote DNS" — Chromium honours this for any
      // --proxy-server scheme, so DNS resolution happens at the proxy server.
      '--proxy-server-resolves-host',
      // Empty bypass list — nothing escapes the proxy. Default bypass list
      // includes localhost which is fine (our bridge IS localhost), but we
      // explicitly remove any internet-host bypass.
      '--proxy-bypass-list=<-loopback>',
      // QUIC on UDP can entirely bypass HTTP CONNECT — disable.
      '--disable-quic',
      // Block legacy Network Service / DoH server overrides
      '--disable-async-dns',
    );
  }

  args.push(`--disable-features=${disabledFeatures.join(',')}`);

  // Top-level locale/timezone are routed through cloakbrowser's binary flags
  // (undetectable). Do NOT pass these through contextOptions — that would use
  // CDP emulation, which is detectable.
  const options: Record<string, unknown> = {
    headless: opts.headless ?? false,
    userAgent: fp.navigator.userAgent,
    // CRITICAL: pass viewport: null so Playwright doesn't force the inner
    // viewport to a specific value (which would overflow off-screen for
    // 1920x1080 spoofs on smaller monitors). The browser uses --window-size
    // for the actual window and --fingerprint-screen-* for the spoof.
    viewport: null,
    locale: fp.locale,
    timezone: fp.timezone,
    humanize: opts.humanize ?? true,
    humanPreset: 'default',
    stealthArgs: false, // we emit our own --fingerprint-* args; cloakbrowser's
                        // default seed would conflict with our deterministic seed.
    args,
  };

  const proxyStr = buildProxyString(proxy);
  if (proxyStr) {
    options.proxy = proxyStr;
    options.geoip = true;
  }

  if (fp.geo.enabled) {
    // geolocation / permissions must be passed via Playwright's contextOptions,
    // not as top-level cloakbrowser launch fields. Top-level only accepts
    // wrapper-specific options (userAgent, viewport, locale, timezone, proxy…).
    options.contextOptions = {
      ...(options.contextOptions as Record<string, unknown> | undefined),
      geolocation: {
        latitude: fp.geo.latitude,
        longitude: fp.geo.longitude,
        accuracy: fp.geo.accuracy,
      },
      permissions: ['geolocation'],
    };
  }

  return { userDataDir, options, args, issues };
}
