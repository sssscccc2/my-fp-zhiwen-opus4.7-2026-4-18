import type { PresetTemplate, FingerprintConfig } from '@shared/types';

export const PRESETS: PresetTemplate[] = [
  {
    id: 'win10-nvidia-1920',
    name: 'Windows 10 / NVIDIA RTX 3060 / 1920x1080',
    description: '主流 Windows 10 游戏本配置（约占桌面市场 18%）',
    marketShare: 18,
    fingerprint: {
      os: 'windows',
      brand: 'Chrome',
      navigator: {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        platform: 'Win32',
        vendor: 'Google Inc.',
        language: 'en-US',
        languages: ['en-US', 'en'],
        hardwareConcurrency: 8,
        deviceMemory: 8,
        doNotTrack: 'unspecified',
      },
      screen: {
        width: 1920,
        height: 1080,
        availWidth: 1920,
        availHeight: 1040,
        colorDepth: 24,
        pixelRatio: 1,
      },
      timezone: 'America/New_York',
      locale: 'en-US',
      geo: { enabled: false, latitude: 40.7128, longitude: -74.006, accuracy: 100 },
      webgl: {
        vendor: 'Google Inc. (NVIDIA)',
        renderer:
          'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
        unmaskedVendor: 'Google Inc. (NVIDIA)',
        unmaskedRenderer:
          'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      },
      canvas: { mode: 'noise' },
      audio: { mode: 'noise' },
      webrtc: { mode: 'disabled' },
      fonts: { preset: 'windows-10' },
      storageQuotaMB: 5120,
    },
  },
  {
    id: 'win11-intel-1920',
    name: 'Windows 11 / Intel UHD Graphics / 1920x1080',
    description: '主流 Windows 11 办公本配置（约占桌面市场 22%）',
    marketShare: 22,
    fingerprint: {
      os: 'windows',
      brand: 'Chrome',
      navigator: {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        platform: 'Win32',
        vendor: 'Google Inc.',
        language: 'en-US',
        languages: ['en-US', 'en'],
        hardwareConcurrency: 12,
        deviceMemory: 16,
        doNotTrack: 'unspecified',
      },
      screen: {
        width: 1920,
        height: 1080,
        availWidth: 1920,
        availHeight: 1032,
        colorDepth: 24,
        pixelRatio: 1,
      },
      timezone: 'Europe/London',
      locale: 'en-GB',
      geo: { enabled: false, latitude: 51.5074, longitude: -0.1278, accuracy: 100 },
      webgl: {
        vendor: 'Google Inc. (Intel)',
        renderer:
          'ANGLE (Intel, Intel(R) UHD Graphics 770 (0x00004680) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        unmaskedVendor: 'Google Inc. (Intel)',
        unmaskedRenderer:
          'ANGLE (Intel, Intel(R) UHD Graphics 770 (0x00004680) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      },
      canvas: { mode: 'noise' },
      audio: { mode: 'noise' },
      webrtc: { mode: 'disabled' },
      fonts: { preset: 'windows-11' },
      storageQuotaMB: 10240,
    },
  },
  {
    id: 'win11-amd-2560',
    name: 'Windows 11 / AMD Radeon RX 6700 / 2560x1440',
    description: '高端 Windows 11 配置（约占桌面市场 6%）',
    marketShare: 6,
    fingerprint: {
      os: 'windows',
      brand: 'Chrome',
      navigator: {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        platform: 'Win32',
        vendor: 'Google Inc.',
        language: 'de-DE',
        languages: ['de-DE', 'de', 'en-US', 'en'],
        hardwareConcurrency: 16,
        deviceMemory: 32,
        doNotTrack: 'unspecified',
      },
      screen: {
        width: 2560,
        height: 1440,
        availWidth: 2560,
        availHeight: 1392,
        colorDepth: 24,
        pixelRatio: 1,
      },
      timezone: 'Europe/Berlin',
      locale: 'de-DE',
      geo: { enabled: false, latitude: 52.52, longitude: 13.405, accuracy: 100 },
      webgl: {
        vendor: 'Google Inc. (AMD)',
        renderer:
          'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
        unmaskedVendor: 'Google Inc. (AMD)',
        unmaskedRenderer:
          'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
      },
      canvas: { mode: 'noise' },
      audio: { mode: 'noise' },
      webrtc: { mode: 'disabled' },
      fonts: { preset: 'windows-11' },
      storageQuotaMB: 20480,
    },
  },
  {
    id: 'mac-m2-2560',
    name: 'macOS 14 / Apple M2 / 2560x1664',
    description: 'MacBook Air M2（约占桌面市场 9%）',
    marketShare: 9,
    fingerprint: {
      os: 'mac',
      brand: 'Chrome',
      navigator: {
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        platform: 'MacIntel',
        vendor: 'Google Inc.',
        language: 'en-US',
        languages: ['en-US', 'en'],
        hardwareConcurrency: 8,
        deviceMemory: 8,
        doNotTrack: 'unspecified',
      },
      screen: {
        width: 2560,
        height: 1664,
        availWidth: 2560,
        availHeight: 1639,
        colorDepth: 30,
        pixelRatio: 2,
      },
      timezone: 'America/Los_Angeles',
      locale: 'en-US',
      geo: { enabled: false, latitude: 37.7749, longitude: -122.4194, accuracy: 100 },
      webgl: {
        vendor: 'Google Inc. (Apple)',
        renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
        unmaskedVendor: 'Google Inc. (Apple)',
        unmaskedRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
      },
      canvas: { mode: 'noise' },
      audio: { mode: 'noise' },
      webrtc: { mode: 'disabled' },
      fonts: { preset: 'macos-14' },
      storageQuotaMB: 10240,
    },
  },
  {
    id: 'mac-intel-1440',
    name: 'macOS 13 / Intel Iris Plus / 1440x900',
    description: '老款 MacBook Pro Intel 配置（约占桌面市场 3%）',
    marketShare: 3,
    fingerprint: {
      os: 'mac',
      brand: 'Chrome',
      navigator: {
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        platform: 'MacIntel',
        vendor: 'Google Inc.',
        language: 'en-US',
        languages: ['en-US', 'en'],
        hardwareConcurrency: 8,
        deviceMemory: 8,
        doNotTrack: 'unspecified',
      },
      screen: {
        width: 1440,
        height: 900,
        availWidth: 1440,
        availHeight: 875,
        colorDepth: 30,
        pixelRatio: 2,
      },
      timezone: 'America/Chicago',
      locale: 'en-US',
      geo: { enabled: false, latitude: 41.8781, longitude: -87.6298, accuracy: 100 },
      webgl: {
        vendor: 'Google Inc. (Intel Inc.)',
        renderer: 'ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 645, OpenGL 4.1)',
        unmaskedVendor: 'Google Inc. (Intel Inc.)',
        unmaskedRenderer: 'ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 645, OpenGL 4.1)',
      },
      canvas: { mode: 'noise' },
      audio: { mode: 'noise' },
      webrtc: { mode: 'disabled' },
      fonts: { preset: 'macos-13' },
      storageQuotaMB: 5120,
    },
  },
  {
    id: 'win10-nvidia-cn',
    name: 'Windows 10 / NVIDIA GTX 1660 / 1366x768 (CN)',
    description: '中国市场常见低配 Windows 10（约占桌面市场 12%）',
    marketShare: 12,
    fingerprint: {
      os: 'windows',
      brand: 'Chrome',
      navigator: {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        platform: 'Win32',
        vendor: 'Google Inc.',
        language: 'zh-CN',
        languages: ['zh-CN', 'zh', 'en'],
        hardwareConcurrency: 4,
        deviceMemory: 4,
        doNotTrack: 'unspecified',
      },
      screen: {
        width: 1366,
        height: 768,
        availWidth: 1366,
        availHeight: 728,
        colorDepth: 24,
        pixelRatio: 1,
      },
      timezone: 'Asia/Shanghai',
      locale: 'zh-CN',
      geo: { enabled: false, latitude: 31.2304, longitude: 121.4737, accuracy: 100 },
      webgl: {
        vendor: 'Google Inc. (NVIDIA)',
        renderer:
          'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)',
        unmaskedVendor: 'Google Inc. (NVIDIA)',
        unmaskedRenderer:
          'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      },
      canvas: { mode: 'noise' },
      audio: { mode: 'noise' },
      webrtc: { mode: 'disabled' },
      fonts: { preset: 'windows-10' },
      storageQuotaMB: 5120,
    },
  },
  {
    id: 'linux-mesa-1920',
    name: 'Linux / Mesa Intel / 1920x1080',
    description: 'Ubuntu 22.04 桌面配置（约占桌面市场 4%）',
    marketShare: 4,
    fingerprint: {
      os: 'linux',
      brand: 'Chrome',
      navigator: {
        userAgent:
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        platform: 'Linux x86_64',
        vendor: 'Google Inc.',
        language: 'en-US',
        languages: ['en-US', 'en'],
        hardwareConcurrency: 8,
        deviceMemory: 16,
        doNotTrack: 'unspecified',
      },
      screen: {
        width: 1920,
        height: 1080,
        availWidth: 1920,
        availHeight: 1053,
        colorDepth: 24,
        pixelRatio: 1,
      },
      timezone: 'Europe/Paris',
      locale: 'fr-FR',
      geo: { enabled: false, latitude: 48.8566, longitude: 2.3522, accuracy: 100 },
      webgl: {
        vendor: 'Mesa',
        renderer: 'Mesa Intel(R) UHD Graphics 770 (ADL-S GT1)',
        unmaskedVendor: 'Mesa',
        unmaskedRenderer: 'Mesa Intel(R) UHD Graphics 770 (ADL-S GT1)',
      },
      canvas: { mode: 'noise' },
      audio: { mode: 'noise' },
      webrtc: { mode: 'disabled' },
      fonts: { preset: 'linux' },
      storageQuotaMB: 10240,
    },
  },
];

export function getPresetById(id: string): PresetTemplate | undefined {
  return PRESETS.find((p) => p.id === id);
}

function weightedRandom<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function pickRandomPreset(): PresetTemplate {
  return weightedRandom(
    PRESETS,
    PRESETS.map((p) => p.marketShare),
  );
}

export function generateRandomFingerprint(): FingerprintConfig {
  const preset = pickRandomPreset();
  const seed = Math.floor(Math.random() * 2_147_483_647);
  return { ...preset.fingerprint, seed };
}

/**
 * Pick a random preset whose OS matches the given OS. Used by self-heal to
 * avoid filling missing WebGL/screen/etc. with values from a different
 * platform (e.g. Mac Apple GPU on a Windows profile).
 */
export function generateRandomFingerprintForOS(os: 'windows' | 'mac' | 'linux'): FingerprintConfig {
  const candidates = PRESETS.filter((p) => p.fingerprint.os === os);
  const pool = candidates.length > 0 ? candidates : PRESETS;
  const preset = weightedRandom(pool, pool.map((p) => p.marketShare));
  const seed = Math.floor(Math.random() * 2_147_483_647);
  return { ...preset.fingerprint, seed };
}

export function presetToFingerprint(preset: PresetTemplate, seed?: number): FingerprintConfig {
  return {
    ...preset.fingerprint,
    seed: seed ?? Math.floor(Math.random() * 2_147_483_647),
  };
}
