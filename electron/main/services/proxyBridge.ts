import type { ProxyConfig } from '@shared/types';
import { startCustomDnsBridge, type CustomDnsBridge } from './customDnsBridge.js';

/**
 * Local HTTP-proxy bridges for upstream proxies that Chromium cannot consume
 * directly. The two main cases:
 *
 *   1. SOCKS5 with credentials  -- Chromium's `--proxy-server` flag does NOT
 *      accept inline credentials (results in ERR_NO_SUPPORTED_PROXIES). We
 *      spawn a local HTTP proxy via `proxy-chain` that authenticates upstream
 *      and presents itself as a credentialless local HTTP proxy to Chromium.
 *   2. HTTPS upstream -- not all builds handle the scheme cleanly through
 *      cloakbrowser's arg path; the bridge normalises this too.
 *
 * One bridge per profileId. Bridges are torn down on `stopBridge` (called from
 * `closeProfile`). Anonymous (no-auth) HTTP/HTTPS proxies pass straight through
 * — no bridge needed.
 */

type ProxyChainModule = {
  anonymizeProxy: (
    upstreamProxyUrl: string | { url: string; ignoreProxyCertificate?: boolean },
    options?: { port?: number; ignoreProxyCertificate?: boolean },
  ) => Promise<string>;
  closeAnonymizedProxy: (anonymizedProxyUrl: string, closeConnections?: boolean) => Promise<boolean | undefined>;
};

let proxyChain: ProxyChainModule | null = null;
async function loadProxyChain(): Promise<ProxyChainModule> {
  if (proxyChain) return proxyChain;
  proxyChain = (await import('proxy-chain')) as unknown as ProxyChainModule;
  return proxyChain;
}

interface ActiveBridge {
  upstreamUrl: string;
  localUrl: string;
  /** Type of bridge active for this profile — proxy-chain or our DNS-over-SOCKS bridge. */
  kind: 'proxy-chain' | 'custom-dns';
  /** Custom DNS bridge handle (only set when kind === 'custom-dns'). */
  customDns?: CustomDnsBridge;
  /** Watchdog timer handle */
  watchdog?: NodeJS.Timeout;
  /** Number of consecutive probe failures */
  consecutiveFailures: number;
  /** Last known good probe timestamp (ms) */
  lastOkAt: number;
}

const bridges = new Map<string, ActiveBridge>();

export interface BridgeStatus {
  profileId: string;
  localUrl: string;
  upstreamUrl: string;
  consecutiveFailures: number;
  lastOkAt: number;
  /** ms since last successful probe */
  lastOkAgoMs: number;
}

export function listBridgeStatus(): BridgeStatus[] {
  const now = Date.now();
  return Array.from(bridges.entries()).map(([profileId, b]) => ({
    profileId,
    localUrl: b.localUrl,
    upstreamUrl: b.upstreamUrl.replace(/\/\/[^@]+@/, '//***:***@'),
    consecutiveFailures: b.consecutiveFailures,
    lastOkAt: b.lastOkAt,
    lastOkAgoMs: now - b.lastOkAt,
  }));
}

/** Build the upstream URL with credentials encoded in the userinfo. */
export function buildUpstreamUrl(proxy: ProxyConfig): string {
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password ?? '')}@`
    : '';
  const scheme = proxy.type === 'https' ? 'https'
    : proxy.type === 'socks5' ? 'socks5'
    : 'http';
  return `${scheme}://${auth}${proxy.host}:${proxy.port}`;
}

/**
 * Whether this proxy must be wrapped in a local HTTP bridge before Chromium
 * can consume it. SOCKS5 with credentials is the canonical case; we also
 * bridge any authenticated SOCKS5 (Chromium can't authenticate) and any
 * authenticated HTTP/HTTPS to give us uniform handling and the ability to
 * defer the credentials away from Chromium command line / process listing.
 */
export function needsBridge(proxy: ProxyConfig | null): boolean {
  if (!proxy) return false;
  if (proxy.type === 'socks5') return true; // always bridge SOCKS5
  // For HTTP/HTTPS, only bridge when credentials are present, OR when the
  // user explicitly opted into custom DNS (which always needs a bridge).
  return !!proxy.username || proxy.dns?.mode === 'custom';
}

/**
 * Start a local HTTP proxy that authenticates upstream and exposes itself
 * to Chromium without credentials. Returns the local `http://127.0.0.1:port`
 * URL that should be passed as `--proxy-server`.
 *
 * Also installs a watchdog that probes the upstream proxy every 30s — on
 * `failureThreshold` consecutive failures it invokes the supplied
 * `onDead` callback so the launcher can close the browser context (kill-
 * switch) instead of letting Chromium possibly fall back to direct.
 *
 * If a bridge for the same profileId already exists, it is closed first.
 */
export async function startBridge(
  profileId: string,
  proxy: ProxyConfig,
  options: {
    onDead?: (info: { upstreamUrl: string; failures: number }) => void;
    probeIntervalMs?: number;
    failureThreshold?: number;
  } = {},
): Promise<string> {
  await stopBridge(profileId);
  const upstreamUrl = buildUpstreamUrl(proxy);

  // Branch: custom DNS-over-SOCKS bridge vs default proxy-chain anonymizer.
  // We pick custom only when:
  //   1. user explicitly opted in (proxy.dns.mode === 'custom')
  //   2. they specified a server IP
  //   3. upstream is SOCKS5 (only protocol our bridge can drive directly)
  const wantCustomDns =
    proxy.dns?.mode === 'custom' &&
    !!proxy.dns.customServer &&
    proxy.type === 'socks5';

  let kind: ActiveBridge['kind'];
  let localUrl: string;
  let customDns: CustomDnsBridge | undefined;

  if (wantCustomDns) {
    customDns = await startCustomDnsBridge(proxy, proxy.dns!.customServer!);
    localUrl = customDns.url;
    kind = 'custom-dns';
    console.log(
      '[proxyBridge] custom DNS bridge active:',
      localUrl,
      '→ DNS',
      proxy.dns!.customServer,
      `(${proxy.dns!.customLabel ?? '?'})`,
      '→ SOCKS5',
      `${proxy.host}:${proxy.port}`,
    );
  } else {
    const pc = await loadProxyChain();
    localUrl = await pc.anonymizeProxy({ url: upstreamUrl, ignoreProxyCertificate: true });
    kind = 'proxy-chain';
  }

  const bridge: ActiveBridge = {
    upstreamUrl,
    localUrl,
    kind,
    customDns,
    consecutiveFailures: 0,
    lastOkAt: Date.now(),
  };

  // ---- Watchdog ----
  const probeInterval = options.probeIntervalMs ?? 30_000;
  const failureThreshold = options.failureThreshold ?? 3;
  bridge.watchdog = setInterval(() => {
    void probeUpstream(proxy)
      .then((ok) => {
        if (ok) {
          bridge.consecutiveFailures = 0;
          bridge.lastOkAt = Date.now();
        } else {
          bridge.consecutiveFailures += 1;
          console.warn(
            `[proxyBridge] probe failed for ${profileId} (${bridge.consecutiveFailures}/${failureThreshold})`,
          );
          if (bridge.consecutiveFailures >= failureThreshold) {
            console.error(`[proxyBridge] upstream DEAD for ${profileId} — invoking kill switch`);
            options.onDead?.({ upstreamUrl, failures: bridge.consecutiveFailures });
          }
        }
      })
      .catch((err) => {
        console.warn('[proxyBridge] probe threw', err);
      });
  }, probeInterval);

  bridges.set(profileId, bridge);
  return localUrl;
}

/**
 * Quick TCP/SOCKS5/HTTP CONNECT probe to a known target. Returns true iff the
 * upstream proxy is reachable AND able to forward traffic (not just listening).
 * 6s timeout so probes don't pile up.
 */
async function probeUpstream(proxy: ProxyConfig): Promise<boolean> {
  // Lazy import to avoid circular deps with proxyService.
  const { testProxy } = await import('./proxyService.js');
  try {
    const r = await testProxy(proxy, 6000);
    return r.ok === true;
  } catch {
    return false;
  }
}

export async function stopBridge(profileId: string): Promise<void> {
  const b = bridges.get(profileId);
  if (!b) return;
  if (b.watchdog) clearInterval(b.watchdog);
  bridges.delete(profileId);
  try {
    if (b.kind === 'custom-dns' && b.customDns) {
      await b.customDns.close();
    } else {
      const pc = await loadProxyChain();
      await pc.closeAnonymizedProxy(b.localUrl, true);
    }
  } catch (err) {
    console.warn('[proxyBridge] failed to close bridge for', profileId, err);
  }
}

export async function stopAllBridges(): Promise<void> {
  const ids = Array.from(bridges.keys());
  await Promise.all(ids.map((id) => stopBridge(id)));
}

export function getBridgeInfo(profileId: string): ActiveBridge | null {
  return bridges.get(profileId) ?? null;
}
