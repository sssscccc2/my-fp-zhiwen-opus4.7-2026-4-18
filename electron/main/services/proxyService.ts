import { randomUUID } from 'node:crypto';
import { all, get, run } from '../db/client.js';
import type { ProxyConfig, ProxyTestResult, ParsedProxy, DnsConfig } from '@shared/types';

// ---------------------------------------------------------------------------
// Country (ISO-3166-α2)  ->  default BCP-47 locale.
// Covers the top markets relevant for antidetect use cases. Falls back to
// 'en-US' if unknown — better than no value, which would leak the host locale.
// ---------------------------------------------------------------------------
const COUNTRY_TO_LOCALE: Record<string, string> = {
  US: 'en-US', GB: 'en-GB', CA: 'en-CA', AU: 'en-AU', NZ: 'en-NZ', IE: 'en-IE',
  IN: 'en-IN', SG: 'en-SG', PH: 'en-PH', ZA: 'en-ZA',
  CN: 'zh-CN', HK: 'zh-HK', TW: 'zh-TW', MO: 'zh-MO',
  JP: 'ja-JP', KR: 'ko-KR', TH: 'th-TH', VN: 'vi-VN', ID: 'id-ID', MY: 'ms-MY',
  DE: 'de-DE', AT: 'de-AT', CH: 'de-CH',
  FR: 'fr-FR', BE: 'fr-BE',
  IT: 'it-IT',
  ES: 'es-ES', MX: 'es-MX', AR: 'es-AR', CL: 'es-CL', CO: 'es-CO', PE: 'es-PE',
  PT: 'pt-PT', BR: 'pt-BR',
  NL: 'nl-NL',
  RU: 'ru-RU', UA: 'uk-UA', BY: 'be-BY',
  PL: 'pl-PL', CZ: 'cs-CZ', SK: 'sk-SK', HU: 'hu-HU', RO: 'ro-RO', BG: 'bg-BG',
  GR: 'el-GR', TR: 'tr-TR',
  SE: 'sv-SE', NO: 'no-NO', DK: 'da-DK', FI: 'fi-FI',
  IL: 'he-IL', AE: 'ar-AE', SA: 'ar-SA', EG: 'ar-EG',
};

function countryToLocale(country?: string): string | undefined {
  if (!country) return undefined;
  return COUNTRY_TO_LOCALE[country.toUpperCase()] ?? 'en-US';
}

/**
 * Parse a proxy string in any of the common formats. Returns null if the
 * input cannot be reasonably interpreted as a proxy.
 *
 * Accepted formats (whitespace tolerated):
 *   1. host:port:user:pass                       — DataImpulse / IPRoyal style (default socks5)
 *   2. host:port                                 — anonymous (default http)
 *   3. user:pass@host:port                       — RFC 7617-ish (default http)
 *   4. socks5://user:pass@host:port              — explicit scheme
 *   5. http://user:pass@host:port  / https://... — explicit scheme
 *   6. socks5://host:port                        — explicit scheme, no auth
 *
 * Note: ":" inside passwords is allowed in format 1 only when password contains
 * no further ":". For passwords with ":" use format 3/4/5.
 */
export function parseProxyString(input: string): ParsedProxy | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;

  // Format 4/5/6: explicit scheme via URL parser
  const schemeMatch = raw.match(/^(socks5h?|socks4|http|https):\/\//i);
  if (schemeMatch) {
    try {
      const u = new URL(raw);
      const scheme = u.protocol.replace(':', '').toLowerCase();
      const type: ParsedProxy['type'] =
        scheme.startsWith('socks') ? 'socks5'
        : scheme === 'https' ? 'https'
        : 'http';
      return {
        type,
        host: u.hostname,
        port: Number(u.port) || (type === 'https' ? 443 : 8080),
        username: u.username ? decodeURIComponent(u.username) : undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
        raw,
      };
    } catch {
      return null;
    }
  }

  // Format 3: user:pass@host:port
  const atIdx = raw.lastIndexOf('@');
  if (atIdx > 0) {
    const credPart = raw.slice(0, atIdx);
    const hostPart = raw.slice(atIdx + 1);
    const credColon = credPart.indexOf(':');
    const hostColon = hostPart.lastIndexOf(':');
    if (credColon > 0 && hostColon > 0) {
      const port = Number(hostPart.slice(hostColon + 1));
      const host = hostPart.slice(0, hostColon);
      if (Number.isFinite(port) && port > 0 && port <= 65535 && host) {
        return {
          type: 'http',
          host,
          port,
          username: credPart.slice(0, credColon),
          password: credPart.slice(credColon + 1),
          raw,
        };
      }
    }
  }

  // Format 1 / 2: colon-separated
  const parts = raw.split(':');
  if (parts.length === 2) {
    const port = Number(parts[1]);
    if (Number.isFinite(port) && port > 0 && port <= 65535 && parts[0]) {
      return { type: 'http', host: parts[0], port, raw };
    }
  }
  if (parts.length >= 4) {
    const port = Number(parts[1]);
    if (Number.isFinite(port) && port > 0 && port <= 65535 && parts[0]) {
      // Re-join everything after the third colon to preserve ":" inside password
      // when input has more than 4 segments.
      const username = parts[2];
      const password = parts.slice(3).join(':');
      return {
        type: 'socks5', // most "host:port:user:pass" feeds (DataImpulse, IPRoyal,
                        // ProxyEmpire, Bright Data backconnect) are SOCKS5-first
        host: parts[0],
        port,
        username,
        password,
        raw,
      };
    }
  }

  return null;
}

interface ProxyRow {
  id: string;
  name: string;
  type: string;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  notes: string | null;
  dns_config: string | null;
  last_tested_at: number | null;
  last_test_ip: string | null;
  last_test_country: string | null;
  last_test_latency_ms: number | null;
  last_test_ok: number | null;
  created_at: number;
}

function parseDnsConfig(raw: string | null): DnsConfig | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<DnsConfig>;
    if (parsed && (parsed.mode === 'proxy' || parsed.mode === 'custom')) {
      return {
        mode: parsed.mode,
        customServer: parsed.customServer,
        customLabel: parsed.customLabel,
      };
    }
  } catch { /* fall through */ }
  return undefined;
}

function rowToProxy(row: ProxyRow): ProxyConfig {
  return {
    id: row.id,
    name: row.name,
    type: row.type as ProxyConfig['type'],
    host: row.host,
    port: row.port,
    username: row.username ?? undefined,
    password: row.password ?? undefined,
    notes: row.notes ?? undefined,
    dns: parseDnsConfig(row.dns_config),
    lastTestedAt: row.last_tested_at ?? undefined,
    lastTestIp: row.last_test_ip ?? undefined,
    lastTestCountry: row.last_test_country ?? undefined,
    lastTestLatencyMs: row.last_test_latency_ms ?? undefined,
    lastTestOk: row.last_test_ok === null ? undefined : row.last_test_ok === 1,
  };
}

export function listProxies(): ProxyConfig[] {
  const rows = all<ProxyRow>('SELECT * FROM proxies ORDER BY name');
  return rows.map(rowToProxy);
}

export function getProxy(id: string): ProxyConfig | null {
  const row = get<ProxyRow>('SELECT * FROM proxies WHERE id = @id', { id });
  return row ? rowToProxy(row) : null;
}

export type CreateProxyInput = Omit<ProxyConfig,
  'id' | 'lastTestedAt' | 'lastTestIp' | 'lastTestCountry' | 'lastTestLatencyMs' | 'lastTestOk'>;

export function createProxy(input: CreateProxyInput): ProxyConfig {
  const id = randomUUID();
  run(
    `INSERT INTO proxies (id, name, type, host, port, username, password, notes, dns_config, created_at)
     VALUES (@id, @name, @type, @host, @port, @username, @password, @notes, @dns, @createdAt)`,
    {
      id,
      name: input.name,
      type: input.type,
      host: input.host,
      port: input.port,
      username: input.username ?? null,
      password: input.password ?? null,
      notes: input.notes ?? null,
      dns: input.dns ? JSON.stringify(input.dns) : null,
      createdAt: Date.now(),
    },
  );
  return getProxy(id)!;
}

export function updateProxy(id: string, input: Partial<CreateProxyInput>): ProxyConfig {
  const existing = getProxy(id);
  if (!existing) throw new Error(`Proxy ${id} not found`);

  const updates: string[] = [];
  const params: Record<string, unknown> = { id };
  if (input.name !== undefined) { updates.push('name = @name'); params.name = input.name; }
  if (input.type !== undefined) { updates.push('type = @type'); params.type = input.type; }
  if (input.host !== undefined) { updates.push('host = @host'); params.host = input.host; }
  if (input.port !== undefined) { updates.push('port = @port'); params.port = input.port; }
  if (input.username !== undefined) { updates.push('username = @username'); params.username = input.username ?? null; }
  if (input.password !== undefined) { updates.push('password = @password'); params.password = input.password ?? null; }
  if (input.notes !== undefined) { updates.push('notes = @notes'); params.notes = input.notes ?? null; }
  if (input.dns !== undefined) { updates.push('dns_config = @dns'); params.dns = input.dns ? JSON.stringify(input.dns) : null; }

  if (updates.length > 0) {
    run(`UPDATE proxies SET ${updates.join(', ')} WHERE id = @id`, params);
  }
  return getProxy(id)!;
}

export function deleteProxy(id: string): void {
  run('DELETE FROM proxies WHERE id = @id', { id });
}

export async function testProxy(proxy: ProxyConfig, timeoutMs = 15000): Promise<ProxyTestResult> {
  return manualHttpProxyTest(proxy, timeoutMs);
}

/**
 * Test an ad-hoc proxy (not yet persisted) — accepts either a parsed proxy
 * object or a raw string in any of the supported formats.
 */
export async function testProxyAdhoc(
  input: string | ParsedProxy,
  timeoutMs = 15000,
): Promise<ProxyTestResult & { parsed?: ParsedProxy }> {
  const parsed = typeof input === 'string' ? parseProxyString(input) : input;
  if (!parsed) return { ok: false, error: '无法解析代理字符串' };
  // Synthesize a transient ProxyConfig for the test pipeline
  const transient: ProxyConfig = {
    id: '__adhoc__',
    name: '__adhoc__',
    type: parsed.type,
    host: parsed.host,
    port: parsed.port,
    username: parsed.username,
    password: parsed.password,
  };
  const result = await manualHttpProxyTest(transient, timeoutMs);
  return { ...result, parsed };
}

async function manualHttpProxyTest(proxy: ProxyConfig, timeoutMs: number): Promise<ProxyTestResult> {
  const start = Date.now();
  const net = await import('node:net');
  const tls = await import('node:tls');

  const targetHost = 'ipinfo.io';
  const targetPort = 443;

  return new Promise<ProxyTestResult>((resolve) => {
    let settled = false;
    const finish = (r: ProxyTestResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    if (proxy.type === 'socks5') {
      socks5Connect(proxy, targetHost, targetPort, timeoutMs)
        .then((sock) => doHttpsRequest(sock, targetHost, finish, start, timeoutMs, tls))
        .catch((err) => finish({ ok: false, error: String(err?.message ?? err), latencyMs: Date.now() - start }));
      return;
    }

    const sock = net.createConnection({ host: proxy.host, port: proxy.port });
    sock.setTimeout(timeoutMs);
    sock.once('timeout', () => { sock.destroy(); finish({ ok: false, error: 'connect timeout', latencyMs: Date.now() - start }); });
    sock.once('error', (err: Error) => finish({ ok: false, error: err.message, latencyMs: Date.now() - start }));
    sock.once('connect', () => {
      const auth = proxy.username
        ? 'Proxy-Authorization: Basic ' + Buffer.from(`${proxy.username}:${proxy.password ?? ''}`).toString('base64') + '\r\n'
        : '';
      const req = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n${auth}\r\n`;
      sock.write(req);
      let buf = '';
      const onData = (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        if (buf.includes('\r\n\r\n')) {
          sock.removeListener('data', onData);
          if (/^HTTP\/1\.[01] 200/i.test(buf)) {
            doHttpsRequest(sock, targetHost, finish, start, timeoutMs, tls);
          } else {
            finish({ ok: false, error: buf.split('\r\n')[0] || 'CONNECT failed', latencyMs: Date.now() - start });
            sock.destroy();
          }
        }
      };
      sock.on('data', onData);
    });
  });
}

async function socks5Connect(
  proxy: ProxyConfig,
  targetHost: string,
  targetPort: number,
  timeoutMs: number,
): Promise<import('node:net').Socket> {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: proxy.host, port: proxy.port });
    sock.setTimeout(timeoutMs);
    sock.once('timeout', () => { sock.destroy(); reject(new Error('socks5 connect timeout')); });
    sock.once('error', reject);
    sock.once('connect', () => {
      const useAuth = !!proxy.username;
      const greeting = useAuth ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]);
      sock.write(greeting);
      sock.once('data', (chunk: Buffer) => {
        if (chunk[0] !== 0x05) return reject(new Error('Bad SOCKS version'));
        const method = chunk[1];
        const proceed = () => {
          const hostBuf = Buffer.from(targetHost, 'utf8');
          const req = Buffer.concat([
            Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
            hostBuf,
            Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff]),
          ]);
          sock.write(req);
          sock.once('data', (resp: Buffer) => {
            if (resp[1] !== 0x00) return reject(new Error('SOCKS5 connect failed: code ' + resp[1]));
            resolve(sock);
          });
        };
        if (method === 0x00) {
          proceed();
        } else if (method === 0x02 && useAuth) {
          const user = Buffer.from(proxy.username ?? '', 'utf8');
          const pass = Buffer.from(proxy.password ?? '', 'utf8');
          const authBuf = Buffer.concat([
            Buffer.from([0x01, user.length]),
            user,
            Buffer.from([pass.length]),
            pass,
          ]);
          sock.write(authBuf);
          sock.once('data', (authResp: Buffer) => {
            if (authResp[1] !== 0x00) return reject(new Error('SOCKS5 auth failed'));
            proceed();
          });
        } else {
          reject(new Error('SOCKS5 method not supported'));
        }
      });
    });
  });
}

function doHttpsRequest(
  socket: import('node:net').Socket,
  host: string,
  finish: (r: ProxyTestResult) => void,
  start: number,
  timeoutMs: number,
  tls: typeof import('node:tls'),
): void {
  const tlsSock = tls.connect({ socket, servername: host, host });
  tlsSock.setTimeout(timeoutMs);
  tlsSock.once('timeout', () => {
    tlsSock.destroy();
    finish({ ok: false, error: 'tls timeout', latencyMs: Date.now() - start });
  });
  tlsSock.once('error', (err: Error) => finish({ ok: false, error: err.message, latencyMs: Date.now() - start }));
  tlsSock.once('secureConnect', () => {
    tlsSock.write(`GET /json HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: fingerprint-browser/0.1\r\nAccept: application/json\r\nConnection: close\r\n\r\n`);
    let buf = '';
    tlsSock.on('data', (chunk: Buffer) => { buf += chunk.toString('utf8'); });
    tlsSock.once('end', () => {
      try {
        const bodyStart = buf.indexOf('\r\n\r\n');
        const body = bodyStart >= 0 ? buf.slice(bodyStart + 4) : '';
        const jsonStart = body.indexOf('{');
        const jsonEnd = body.lastIndexOf('}');
        if (jsonStart < 0 || jsonEnd < 0) {
          finish({ ok: false, error: 'no json in response', latencyMs: Date.now() - start });
          return;
        }
        const data = JSON.parse(body.slice(jsonStart, jsonEnd + 1));
        const loc: string | undefined = data.loc; // "lat,lng"
        let latitude: number | undefined;
        let longitude: number | undefined;
        if (typeof loc === 'string' && loc.includes(',')) {
          const [latStr, lngStr] = loc.split(',');
          const lat = Number(latStr);
          const lng = Number(lngStr);
          if (Number.isFinite(lat)) latitude = lat;
          if (Number.isFinite(lng)) longitude = lng;
        }
        finish({
          ok: true,
          ip: data.ip,
          country: data.country,
          region: data.region,
          city: data.city,
          org: data.org,
          postal: data.postal,
          timezone: data.timezone,
          latitude,
          longitude,
          suggestedLocale: countryToLocale(data.country),
          latencyMs: Date.now() - start,
        });
      } catch (err) {
        finish({ ok: false, error: 'parse error: ' + (err as Error).message, latencyMs: Date.now() - start });
      }
    });
  });
}

export function recordTestResult(id: string, result: ProxyTestResult): void {
  run(
    `UPDATE proxies SET
       last_tested_at = @t,
       last_test_ip = @ip,
       last_test_country = @country,
       last_test_latency_ms = @latency,
       last_test_ok = @ok
     WHERE id = @id`,
    {
      t: Date.now(),
      ip: result.ip ?? null,
      country: result.country ?? null,
      latency: result.latencyMs ?? null,
      ok: result.ok ? 1 : 0,
      id,
    },
  );
}
