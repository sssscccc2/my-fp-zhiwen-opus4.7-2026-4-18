/**
 * Country-localized DNS server presets — picked because they're operated by
 * mainstream ISPs in each country, so when websites do reverse-lookups on the
 * resolver IP they see "Chunghwa Telecom in Taiwan" instead of "Google in
 * California". This is what makes ipleak.net's "DNS country == IP country"
 * check pass.
 *
 * All servers are TCP-DNS reachable on port 53. We exclude DoT/DoH-only
 * resolvers because we tunnel raw TCP DNS through SOCKS5.
 */
export interface DnsPreset {
  /** ISO-3166 alpha-2 country code, or 'XX' for global anycast. */
  country: string;
  /** Display label, e.g. "台湾 HiNet (中華電信)". */
  label: string;
  /** Resolver IP. */
  server: string;
}

export const DNS_PRESETS: DnsPreset[] = [
  // Asia-Pacific
  { country: 'TW', label: '台湾 HiNet 168.95.1.1 (中華電信)', server: '168.95.1.1' },
  { country: 'TW', label: '台湾 HiNet 168.95.192.1', server: '168.95.192.1' },
  { country: 'TW', label: '台湾 SeedNet 139.175.1.1', server: '139.175.1.1' },
  { country: 'HK', label: '香港 HKBN 203.80.96.10', server: '203.80.96.10' },
  { country: 'HK', label: '香港 PCCW 205.252.144.228', server: '205.252.144.228' },
  { country: 'JP', label: '日本 NTT 129.250.35.250', server: '129.250.35.250' },
  { country: 'JP', label: '日本 IIJ 210.130.0.5', server: '210.130.0.5' },
  { country: 'JP', label: '日本 OCN 220.156.0.135', server: '220.156.0.135' },
  { country: 'KR', label: '韩国 KT 168.126.63.1', server: '168.126.63.1' },
  { country: 'KR', label: '韩国 LG U+ 164.124.101.2', server: '164.124.101.2' },
  { country: 'SG', label: '新加坡 Singtel 165.21.83.88', server: '165.21.83.88' },
  { country: 'SG', label: '新加坡 StarHub 203.116.254.150', server: '203.116.254.150' },
  { country: 'TH', label: '泰国 True 203.144.207.49', server: '203.144.207.49' },
  { country: 'VN', label: '越南 VNPT 203.162.4.190', server: '203.162.4.190' },
  { country: 'IN', label: '印度 BSNL 218.248.255.146', server: '218.248.255.146' },
  { country: 'AU', label: '澳大利亚 Telstra 139.130.4.5', server: '139.130.4.5' },

  // North America
  { country: 'US', label: '美国 Level3 4.2.2.1', server: '4.2.2.1' },
  { country: 'US', label: '美国 Level3 4.2.2.2', server: '4.2.2.2' },
  { country: 'US', label: '美国 Comcast 75.75.75.75', server: '75.75.75.75' },
  { country: 'US', label: '美国 Verizon 71.243.0.14', server: '71.243.0.14' },
  { country: 'CA', label: '加拿大 Bell 207.164.234.193', server: '207.164.234.193' },

  // Europe
  { country: 'GB', label: '英国 BT 194.74.65.69', server: '194.74.65.69' },
  { country: 'GB', label: '英国 Sky 90.207.238.97', server: '90.207.238.97' },
  { country: 'DE', label: '德国 Telekom 194.25.0.60', server: '194.25.0.60' },
  { country: 'DE', label: '德国 Vodafone 139.7.30.125', server: '139.7.30.125' },
  { country: 'FR', label: '法国 Orange 80.10.246.2', server: '80.10.246.2' },
  { country: 'FR', label: '法国 Free 212.27.40.240', server: '212.27.40.240' },
  { country: 'NL', label: '荷兰 KPN 195.121.1.34', server: '195.121.1.34' },
  { country: 'IT', label: '意大利 TIM 85.37.17.50', server: '85.37.17.50' },
  { country: 'ES', label: '西班牙 Telefonica 80.58.61.250', server: '80.58.61.250' },
  { country: 'PL', label: '波兰 Orange 194.204.159.1', server: '194.204.159.1' },
  { country: 'RU', label: '俄罗斯 Beeline 213.234.192.8', server: '213.234.192.8' },
  { country: 'TR', label: '土耳其 TTNet 195.175.39.49', server: '195.175.39.49' },

  // Latin America
  { country: 'BR', label: '巴西 Telefonica 200.204.0.10', server: '200.204.0.10' },
  { country: 'AR', label: '阿根廷 Telecom 200.45.191.40', server: '200.45.191.40' },
  { country: 'MX', label: '墨西哥 Telmex 200.33.146.249', server: '200.33.146.249' },

  // Middle East
  { country: 'AE', label: '阿联酋 Etisalat 213.42.20.20', server: '213.42.20.20' },
  { country: 'SA', label: '沙特 STC 212.118.130.6', server: '212.118.130.6' },
  { country: 'IL', label: '以色列 Bezeq 192.115.106.10', server: '192.115.106.10' },

  // Global anycast (universal fallback — resolver appears in nearest CDN PoP,
  // not country-specific but reliable).
  { country: 'XX', label: 'Cloudflare 1.1.1.1 (anycast)', server: '1.1.1.1' },
  { country: 'XX', label: 'Quad9 9.9.9.9 (anycast)', server: '9.9.9.9' },
  { country: 'XX', label: 'Google 8.8.8.8 (anycast)', server: '8.8.8.8' },
  { country: 'XX', label: 'OpenDNS 208.67.222.222', server: '208.67.222.222' },
];

/** Recommend a DNS server for a given country (returns Cloudflare anycast as fallback). */
export function recommendDns(country?: string): DnsPreset {
  if (country) {
    const cc = country.toUpperCase();
    const m = DNS_PRESETS.find((p) => p.country === cc);
    if (m) return m;
  }
  return DNS_PRESETS.find((p) => p.server === '1.1.1.1')!;
}
