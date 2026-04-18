import * as http from 'node:http';
import * as net from 'node:net';
import { SocksClient, type SocksClientOptions } from 'socks';
import dnsPacket from 'dns-packet';
import type { ProxyConfig } from '@shared/types';

/**
 * Custom DNS-over-SOCKS5 HTTP proxy bridge.
 *
 * What this solves
 * ----------------
 * Default behaviour (proxy-chain bridge → SOCKS5 with hostname ATYP=3):
 *   Browser ──CONNECT example.com:443──▶ local bridge ──SOCKS5(host=example.com)──▶ proxy
 *                                                                                    │
 *                                                              proxy resolves example.com using
 *                                                              ITS DNS (typically Google US).
 *
 *   Result on ipleak.net: DNS resolvers shown in California (Google), even though
 *   the IP shows Taiwan. → "DNS country ≠ IP country" → easy proxy detection.
 *
 * This bridge:
 *   Browser ──CONNECT example.com:443──▶ local bridge
 *                                          │
 *                                          ├─ STEP 1: open SOCKS5 tunnel to chosen DNS server
 *                                          │           (e.g. 168.95.1.1:53 in Taiwan)
 *                                          │           Send DNS-over-TCP query for example.com
 *                                          │           ←─── A records ────
 *                                          │
 *                                          └─ STEP 2: open SOCKS5 tunnel to resolved IP:443
 *                                                     (ATYP=1 / IPv4 — proxy doesn't do DNS)
 *
 *   Result: DNS queries appear to come from the Taiwan exit IP, going to a Taiwan
 *   ISP DNS server. ipleak.net shows DNS in Taiwan matching the IP. ✓
 *
 * Implementation notes
 * --------------------
 * - TCP DNS (RFC 1035 §4.2.2): 2-byte length prefix + DNS message. Universally
 *   supported. We avoid UDP because SOCKS5 UDP ASSOCIATE is rarely supported
 *   by commercial proxy providers (DataImpulse/IPRoyal don't expose it).
 *
 * - DNS cache with TTL — DNS queries are not cheap (each one needs a fresh
 *   SOCKS5 handshake to the DNS server). We cache A records per hostname for
 *   min(TTL, 5min). Browsers also cache locally so impact is bounded.
 *
 * - We do A records only (IPv4). IPv6 is opt-in elsewhere and the SOCKS5
 *   tunnel itself is IPv4-only with most providers.
 *
 * - One bridge instance per profile (mirrors proxy-chain's anonymizeProxy
 *   semantics). Caller is responsible for `.close()` on browser exit.
 */

interface DnsCacheEntry {
  ips: string[];
  expiresAt: number;
}

export interface CustomDnsBridge {
  /** Local URL to pass to Chromium's --proxy-server (e.g., http://127.0.0.1:51123). */
  url: string;
  /** Port number for diagnostics. */
  port: number;
  /** Tear down server, drop cache. */
  close: () => Promise<void>;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;   // ceiling on DNS cache lifetime
const MAX_CACHE_ENTRIES = 2_000;
const DNS_QUERY_TIMEOUT_MS = 8_000;
const SOCKS_CONNECT_TIMEOUT_MS = 15_000;

export async function startCustomDnsBridge(
  proxy: ProxyConfig,
  dnsServer: string,
): Promise<CustomDnsBridge> {
  if (proxy.type !== 'socks5') {
    throw new Error(`customDnsBridge only supports SOCKS5 upstream (got ${proxy.type})`);
  }
  if (!net.isIP(dnsServer)) {
    throw new Error(`dnsServer must be an IP address, got: ${dnsServer}`);
  }

  const cache = new Map<string, DnsCacheEntry>();

  // Common SOCKS5 connection options pre-built once. (proxy-chain wraps this for us
  // in the default path; here we use socks library directly so we control the
  // destination ATYP per request.)
  const buildSocksOpts = (
    host: string,
    port: number,
  ): SocksClientOptions => ({
    proxy: {
      host: proxy.host,
      port: proxy.port,
      type: 5,
      userId: proxy.username,
      password: proxy.password,
    },
    command: 'connect',
    destination: { host, port },
    timeout: SOCKS_CONNECT_TIMEOUT_MS,
  });

  /**
   * Resolve `host` to an IPv4 string by sending a DNS A query through the
   * SOCKS5 tunnel to `dnsServer`. Returns one IP from the answer set
   * (random pick when multi-A) for DNS-level load distribution like normal
   * resolvers do.
   */
  async function resolveHost(host: string): Promise<string> {
    if (net.isIP(host)) return host; // Caller asked for an IP literal
    const cached = cache.get(host);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.ips[Math.floor(Math.random() * cached.ips.length)];
    }

    const { socket } = await SocksClient.createConnection(buildSocksOpts(dnsServer, 53));

    try {
      const queryId = Math.floor(Math.random() * 65535);
      const dnsQueryBuf = dnsPacket.encode({
        type: 'query',
        id: queryId,
        flags: dnsPacket.RECURSION_DESIRED,
        questions: [{ type: 'A', name: host }],
      });

      // RFC 1035: TCP DNS messages are prefixed with a 16-bit length.
      const tcpFrame = Buffer.concat([
        Buffer.from([(dnsQueryBuf.length >> 8) & 0xff, dnsQueryBuf.length & 0xff]),
        dnsQueryBuf,
      ]);

      const respBody = await readDnsResponse(socket, tcpFrame);
      const decoded = dnsPacket.decode(respBody);

      const aRecords = (decoded.answers ?? [])
        .filter((a) => a.type === 'A')
        .map((a) => String(a.data));

      if (aRecords.length === 0) {
        throw new Error(`no A records for ${host} (rcode=${(decoded as { rcode?: string }).rcode ?? '?'})`);
      }

      // Honour TTL but cap to keep cache fresh during long-running sessions.
      const firstAnswer = decoded.answers?.[0] as { ttl?: number } | undefined;
      const ttl = firstAnswer?.ttl ?? 300;
      cache.set(host, {
        ips: aRecords,
        expiresAt: Date.now() + Math.min(ttl * 1000, DEFAULT_TTL_MS),
      });
      // Bound cache size — drop oldest insertion (Map preserves insertion order).
      if (cache.size > MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }

      return aRecords[Math.floor(Math.random() * aRecords.length)];
    } finally {
      try { socket.destroy(); } catch { /* ignore */ }
    }
  }

  const server = http.createServer();

  // ---------------- HTTPS / WebSocket Upgrade via CONNECT ----------------
  server.on('connect', (req, clientSocket, head) => {
    void (async () => {
      const target = req.url ?? '';
      const colonIdx = target.lastIndexOf(':');
      const host = colonIdx > 0 ? target.slice(0, colonIdx) : target;
      const port = colonIdx > 0 ? parseInt(target.slice(colonIdx + 1), 10) || 443 : 443;
      try {
        const ip = await resolveHost(host);
        const { socket: upstream } = await SocksClient.createConnection(
          buildSocksOpts(ip, port),
        );

        clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: fp-dns-bridge\r\n\r\n');
        if (head.length > 0) upstream.write(head);

        const cleanup = () => {
          try { upstream.destroy(); } catch { /* ignore */ }
          try { clientSocket.destroy(); } catch { /* ignore */ }
        };
        upstream.on('error', cleanup);
        upstream.on('close', cleanup);
        clientSocket.on('error', cleanup);
        clientSocket.on('close', cleanup);

        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      } catch (err) {
        console.warn(`[dnsBridge] CONNECT ${host}:${port} failed:`, (err as Error).message);
        try {
          clientSocket.write('HTTP/1.1 502 Bad Gateway\r\nProxy-Agent: fp-dns-bridge\r\n\r\n');
          clientSocket.destroy();
        } catch { /* already closed */ }
      }
    })();
  });

  // ---------------- Plain HTTP forwarding ----------------
  // Modern browsing is 99% HTTPS but some sites (HTTP→HTTPS redirects, OCSP,
  // CRLs, captive portal probes) still use HTTP. We forward via a real
  // http.request bound to our SOCKS5 socket so node handles parsing/keep-alive.
  server.on('request', (req, res) => {
    void (async () => {
      try {
        const reqUrl = req.url ?? '/';
        const isAbsolute = /^https?:\/\//i.test(reqUrl);
        let host: string;
        let port: number;
        let path: string;
        if (isAbsolute) {
          const u = new URL(reqUrl);
          host = u.hostname;
          port = parseInt(u.port || '80', 10);
          path = u.pathname + u.search;
        } else {
          const hostHeader = req.headers.host ?? '';
          const [h, p] = hostHeader.split(':');
          host = h;
          port = parseInt(p ?? '80', 10) || 80;
          path = reqUrl;
        }
        if (!host) {
          res.statusCode = 400;
          res.end('Missing Host');
          return;
        }

        const ip = await resolveHost(host);
        const { socket: upstream } = await SocksClient.createConnection(
          buildSocksOpts(ip, port),
        );

        const headers: Record<string, string | string[] | undefined> = { ...req.headers };
        // Strip hop-by-hop headers
        delete headers['proxy-connection'];
        delete headers['proxy-authorization'];

        const proxyReq = http.request({
          createConnection: () => upstream,
          method: req.method,
          path,
          headers: headers as http.OutgoingHttpHeaders,
          host,
          port,
        });
        proxyReq.on('response', (proxyRes) => {
          res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
          proxyRes.pipe(res);
        });
        proxyReq.on('error', (err) => {
          console.warn('[dnsBridge] HTTP upstream error:', err.message);
          if (!res.headersSent) {
            res.statusCode = 502;
            res.end('Bad Gateway');
          } else {
            res.destroy();
          }
        });
        req.pipe(proxyReq);
      } catch (err) {
        console.warn('[dnsBridge] HTTP request failed:', (err as Error).message);
        if (!res.headersSent) {
          res.statusCode = 502;
          res.end('Bad Gateway');
        } else {
          res.destroy();
        }
      }
    })();
  });

  server.on('clientError', (_err, sock) => {
    try { sock.destroy(); } catch { /* ignore */ }
  });

  // Bind to ephemeral port on loopback only.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to bind custom DNS bridge');
  }

  return {
    url: `http://127.0.0.1:${addr.port}`,
    port: addr.port,
    close: async () => {
      cache.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

/** Read a single DNS response (length-prefixed) from a TCP socket, then return the message body. */
function readDnsResponse(socket: net.Socket, query: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let expectedLen = -1;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('DNS query timeout'));
    }, DNS_QUERY_TIMEOUT_MS);

    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (expectedLen < 0 && buf.length >= 2) {
        expectedLen = (buf[0] << 8) | buf[1];
      }
      if (expectedLen >= 0 && buf.length >= 2 + expectedLen) {
        const body = buf.slice(2, 2 + expectedLen);
        cleanup();
        resolve(body);
      }
    };
    const onError = (err: Error) => { cleanup(); reject(err); };
    const onEnd = () => { cleanup(); reject(new Error('DNS connection closed before complete response')); };

    function cleanup() {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('end', onEnd);
    }

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('end', onEnd);
    socket.write(query);
  });
}
