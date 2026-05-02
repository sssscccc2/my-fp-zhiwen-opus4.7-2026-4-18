import type { PresetTemplate, FingerprintConfig, DeviceCategory, OSPlatform } from '@shared/types';

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
      device: 'desktop',
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
  // ============================================================
  //   📱 移动端预设（v0.4.0+ — 对标比特浏览器/AdsPower 手机模式）
  //   2025-2026 真机参数，UA / 屏幕 / DPR 全部来自实测：
  //     - iPhone 17 系列：iOS 18.7 + Safari 26 (2025年9月发布)
  //     - Pixel 10 系列：Android 16 + Chrome 146 (2025年8月发布)
  //     - Galaxy S25 系列：Android 15 + Chrome 146 (2025年1月发布)
  //   反检测通过 mobileStealth.ts 在启动后注入：
  //     - CDP Emulation.setUserAgentOverride + userAgentMetadata
  //       (sec-ch-ua-mobile=?1, platform="iOS", model="iPhone18,1" 等)
  //     - InitScript 修补 navigator.connection / 清除 Playwright 残留
  //       / patch iframe.contentWindow.navigator.webdriver
  //       / 修复 screen.availTop=0 leak / pdfViewerEnabled / chrome.runtime
  // ============================================================
  // ---- iPhone 17 Pro Max (2025-09 发布, iOS 18.7 / Safari 26.5) ----
  {
    id: 'iphone-17-pro-max',
    name: '📱 iPhone 17 Pro Max / Safari 26 / iOS 18.7',
    description: 'iPhone 17 Pro Max 最新旗舰（2025-09，6.9", DPR=3）',
    marketShare: 14,
    fingerprint: {
      os: 'ios',
      device: 'mobile',
      brand: 'Chrome',
      navigator: {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        vendor: 'Apple Computer, Inc.',
        language: 'en-US',
        languages: ['en-US', 'en'],
        hardwareConcurrency: 6,
        deviceMemory: 8,
        doNotTrack: 'unspecified',
      },
      screen: {
        width: 440,
        height: 956,
        availWidth: 440,
        availHeight: 956,
        colorDepth: 24,
        pixelRatio: 3,
      },
      timezone: 'America/New_York',
      locale: 'en-US',
      geo: { enabled: false, latitude: 40.7128, longitude: -74.006, accuracy: 30 },
      webgl: {
        vendor: 'Apple Inc.',
        renderer: 'Apple GPU',
        unmaskedVendor: 'Apple Inc.',
        unmaskedRenderer: 'Apple GPU',
      },
      canvas: { mode: 'noise' },
      audio: { mode: 'noise' },
      webrtc: { mode: 'disabled' },
      fonts: { preset: 'ios-18' },
      storageQuotaMB: 4096,
      mobile: {
        maxTouchPoints: 5,
        brand: 'Safari',
        deviceModel: 'iPhone 17 Pro Max',
        modelCode: 'iPhone18,2',
        osVersion: '18.7.0',
        browserVersion: '26.5',
        architecture: 'arm64',
        formFactors: ['Mobile'],
      },
    },
  },
  // ---- iPhone 17 Pro (2025-09, 6.3") ----
  {
    id: 'iphone-17-pro',
    name: '📱 iPhone 17 Pro / Safari 26 / iOS 18.7',
    description: 'iPhone 17 Pro 旗舰（2025-09，6.3", A19 Pro，DPR=3）',
    marketShare: 16,
    fingerprint: {
      os: 'ios',
      device: 'mobile',
      brand: 'Chrome',
      navigator: {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        vendor: 'Apple Computer, Inc.',
        language: 'en-US',
        languages: ['en-US', 'en'],
        hardwareConcurrency: 6,
        deviceMemory: 8,
        doNotTrack: 'unspecified',
      },
      screen: {
        width: 402,
        height: 874,
        availWidth: 402,
        availHeight: 874,
        colorDepth: 24,
        pixelRatio: 3,
      },
      timezone: 'America/Los_Angeles',
      locale: 'en-US',
      geo: { enabled: false, latitude: 37.7749, longitude: -122.4194, accuracy: 30 },
      webgl: {
        vendor: 'Apple Inc.',
        renderer: 'Apple GPU',
        unmaskedVendor: 'Apple Inc.',
        unmaskedRenderer: 'Apple GPU',
      },
      canvas: { mode: 'noise' },
      audio: { mode: 'noise' },
      webrtc: { mode: 'disabled' },
      fonts: { preset: 'ios-18' },
      storageQuotaMB: 4096,
      mobile: {
        maxTouchPoints: 5,
        brand: 'Safari',
        deviceModel: 'iPhone 17 Pro',
        modelCode: 'iPhone18,1',
        osVersion: '18.7.0',
        browserVersion: '26.5',
        architecture: 'arm64',
        formFactors: ['Mobile'],
      },
    },
  },
  // ---- iPhone 17 (普通版，与 17 Pro 同屏) ----
  {
    id: 'iphone-17',
    name: '📱 iPhone 17 / Safari 26 / iOS 18.7',
    description: 'iPhone 17 标准版（2025-09，6.3", A19，DPR=3）',
    marketShare: 10,
    fingerprint: {
      os: 'ios',
      device: 'mobile',
      brand: 'Chrome',
      navigator: {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        vendor: 'Apple Computer, Inc.',
        language: 'en-US',
        languages: ['en-US', 'en'],
        hardwareConcurrency: 6,
        deviceMemory: 8,
        doNotTrack: 'unspecified',
      },
      screen: {
        width: 402,
        height: 874,
        availWidth: 402,
        availHeight: 874,
        colorDepth: 24,
        pixelRatio: 3,
      },
      timezone: 'America/New_York',
      locale: 'en-US',
      geo: { enabled: false, latitude: 40.7128, longitude: -74.006, accuracy: 30 },
      webgl: {
        vendor: 'Apple Inc.',
        renderer: 'Apple GPU',
        unmaskedVendor: 'Apple Inc.',
        unmaskedRenderer: 'Apple GPU',
      },
      canvas: { mode: 'noise' },
      audio: { mode: 'noise' },
      webrtc: { mode: 'disabled' },
      fonts: { preset: 'ios-18' },
      storageQuotaMB: 2048,
      mobile: {
        maxTouchPoints: 5,
        brand: 'Safari',
        deviceModel: 'iPhone 17',
        modelCode: 'iPhone17,3',
        osVersion: '18.7.0',
        browserVersion: '26.5',
        architecture: 'arm64',
        formFactors: ['Mobile'],
      },
    },
  },
  // ---- iPhone Air (2025-09, 6.5") ----
  {
    id: 'iphone-air',
    name: '📱 iPhone Air / Safari 26 / iOS 18.7',
    description: 'iPhone Air 超薄机型（2025-09，6.5", 钛合金，DPR=3）',
    marketShare: 4,
    fingerprint: {
      os: 'ios',
      device: 'mobile',
      brand: 'Chrome',
      navigator: {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        vendor: 'Apple Computer, Inc.',
        language: 'en-US',
        languages: ['en-US', 'en'],
        hardwareConcurrency: 6,
        deviceMemory: 8,
        doNotTrack: 'unspecified',
      },
      screen: {
        width: 420,
        height: 912,
        availWidth: 420,
        availHeight: 912,
        colorDepth: 24,
        pixelRatio: 3,
      },
      timezone: 'Europe/London',
      locale: 'en-GB',
      geo: { enabled: false, latitude: 51.5074, longitude: -0.1278, accuracy: 30 },
      webgl: {
        vendor: 'Apple Inc.',
        renderer: 'Apple GPU',
        unmaskedVendor: 'Apple Inc.',
        unmaskedRenderer: 'Apple GPU',
      },
      canvas: { mode: 'noise' },
      audio: { mode: 'noise' },
      webrtc: { mode: 'disabled' },
      fonts: { preset: 'ios-18' },
      storageQuotaMB: 2048,
      mobile: {
        maxTouchPoints: 5,
        brand: 'Safari',
        deviceModel: 'iPhone Air',
        modelCode: 'iPhone18,4',
        osVersion: '18.7.0',
        browserVersion: '26.5',
        architecture: 'arm64',
        formFactors: ['Mobile'],
      },
    },
  },
  // ---- iPhone 16 Pro / 同 17 Pro 屏 / iOS 18 早期版本 ----
  {
    id: 'iphone-16-pro',
    name: '📱 iPhone 16 Pro / Safari 18 / iOS 18.4',
    description: 'iPhone 16 Pro（2024-09，存量大，6.3", DPR=3）',
    marketShare: 12,
    fingerprint: {
      os: 'ios',
      device: 'mobile',
      brand: 'Chrome',
      navigator: {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        vendor: 'Apple Computer, Inc.',
        language: 'zh-CN',
        languages: ['zh-CN', 'zh', 'en'],
        hardwareConcurrency: 6,
        deviceMemory: 8,
        doNotTrack: 'unspecified',
      },
      screen: {
        width: 402,
        height: 874,
        availWidth: 402,
        availHeight: 874,
        colorDepth: 24,
        pixelRatio: 3,
      },
      timezone: 'Asia/Shanghai',
      locale: 'zh-CN',
      geo: { enabled: false, latitude: 31.2304, longitude: 121.4737, accuracy: 30 },
      webgl: {
        vendor: 'Apple Inc.',
        renderer: 'Apple GPU',
        unmaskedVendor: 'Apple Inc.',
        unmaskedRenderer: 'Apple GPU',
      },
      canvas: { mode: 'noise' },
      audio: { mode: 'noise' },
      webrtc: { mode: 'disabled' },
      fonts: { preset: 'ios-18' },
      storageQuotaMB: 2048,
      mobile: {
        maxTouchPoints: 5,
        brand: 'Safari',
        deviceModel: 'iPhone 16 Pro',
        modelCode: 'iPhone17,1',
        osVersion: '18.4.0',
        browserVersion: '18.4',
        architecture: 'arm64',
        formFactors: ['Mobile'],
      },
    },
  },
  // ---- iPad Pro M4 13" Safari ----
  {
    id: 'ipad-pro-m4',
    name: '📱 iPad Pro M4 13" / Safari 18 / iPadOS 18',
    description: 'iPad Pro M4 13 英寸（2024-05，2752×2064，DPR=2）',
    marketShare: 5,
    fingerprint: {
      os: 'ios',
      device: 'tablet',
      brand: 'Chrome',
      navigator: {
        userAgent:
          'Mozilla/5.0 (iPad; CPU OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1',
        platform: 'iPad',
        vendor: 'Apple Computer, Inc.',
        language: 'en-US',
        languages: ['en-US', 'en'],
        hardwareConcurrency: 10,
        deviceMemory: 8,
        doNotTrack: 'unspecified',
      },
      screen: {
        width: 1024,
        height: 1366,
        availWidth: 1024,
        availHeight: 1366,
        colorDepth: 24,
        pixelRatio: 2,
      },
      timezone: 'America/Los_Angeles',
      locale: 'en-US',
      geo: { enabled: false, latitude: 37.7749, longitude: -122.4194, accuracy: 30 },
      webgl: {
        vendor: 'Apple Inc.',
        renderer: 'Apple GPU',
        unmaskedVendor: 'Apple Inc.',
        unmaskedRenderer: 'Apple GPU',
      },
      canvas: { mode: 'noise' },
      audio: { mode: 'noise' },
      webrtc: { mode: 'disabled' },
      fonts: { preset: 'ios-18' },
      storageQuotaMB: 8192,
      mobile: {
        maxTouchPoints: 5,
        brand: 'Safari',
        deviceModel: 'iPad Pro 13" M4',
        modelCode: 'iPad16,5',
        osVersion: '18.4.0',
        browserVersion: '18.4',
        architecture: 'arm64',
        formFactors: ['Tablet'],
      },
    },
  },
  // ---- Pixel 10 Pro (2025-08, Android 16, Chrome 146) ----
  {
    id: 'pixel-10-pro',
    name: '📱 Google Pixel 10 Pro / Chrome 146 / Android 16',
    description: 'Pixel 10 Pro 旗舰（2025-08，6.3", Tensor G5，DPR=3.125）',
    marketShare: 10,
    fingerprint: {
      os: 'android',
      device: 'mobile',
      brand: 'Chrome',
      navigator: {
        userAgent:
          'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.177 Mobile Safari/537.36',
        platform: 'Linux armv81',
        vendor: 'Google Inc.',
        language: 'en-US',
        languages: ['en-US', 'en'],
        hardwareConcurrency: 8,
        deviceMemory: 8,
        doNotTrack: 'unspecified',
      },
      screen: {
        width: 410,
        height: 914,
        availWidth: 410,
        availHeight: 914,
        colorDepth: 24,
        pixelRatio: 3.125,
      },
      timezone: 'America/Chicago',
      locale: 'en-US',
      geo: { enabled: false, latitude: 41.8781, longitude: -87.6298, accuracy: 30 },
      webgl: {
        vendor: 'Google Inc. (Google)',
        renderer: 'ANGLE (Google, Mali-G725 Immortalis MC12, OpenGL ES 3.2)',
        unmaskedVendor: 'Google',
        unmaskedRenderer: 'Mali-G725 Immortalis MC12',
      },
      canvas: { mode: 'noise' },
      audio: { mode: 'noise' },
      webrtc: { mode: 'disabled' },
      fonts: { preset: 'android-14' },
      storageQuotaMB: 4096,
      mobile: {
        maxTouchPoints: 5,
        brand: 'Chrome',
        deviceModel: 'Pixel 10 Pro',
        modelCode: 'Pixel 10 Pro',
        osVersion: '16.0.0',
        browserVersion: '146.0.7680.177',
        architecture: 'arm64',
        formFactors: ['Mobile'],
      },
    },
  },
  // ---- Pixel 10 Pro XL ----
  {
    id: 'pixel-10-pro-xl',
    name: '📱 Google Pixel 10 Pro XL / Chrome 146 / Android 16',
    description: 'Pixel 10 Pro XL 大屏（2025-08，6.8", DPR=3.25）',
    marketShare: 6,
    fingerprint: {
      os: 'android',
      device: 'mobile',
      brand: 'Chrome',
      navigator: {
        userAgent:
          'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro XL) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.177 Mobile Safari/537.36',
        platform: 'Linux armv81',
        vendor: 'Google Inc.',
        language: 'en-US',
        languages: ['en-US', 'en'],
        hardwareConcurrency: 8,
        deviceMemory: 12,
        doNotTrack: 'unspecified',
      },
      screen: {
        width: 414,
        height: 921,
        availWidth: 414,
        availHeight: 921,
        colorDepth: 24,
        pixelRatio: 3.25,
      },
      timezone: 'Europe/Berlin',
      locale: 'de-DE',
      geo: { enabled: false, latitude: 52.52, longitude: 13.405, accuracy: 30 },
      webgl: {
        vendor: 'Google Inc. (Google)',
        renderer: 'ANGLE (Google, Mali-G725 Immortalis MC12, OpenGL ES 3.2)',
        unmaskedVendor: 'Google',
        unmaskedRenderer: 'Mali-G725 Immortalis MC12',
      },
      canvas: { mode: 'noise' },
      audio: { mode: 'noise' },
      webrtc: { mode: 'disabled' },
      fonts: { preset: 'android-14' },
      storageQuotaMB: 4096,
      mobile: {
        maxTouchPoints: 5,
        brand: 'Chrome',
        deviceModel: 'Pixel 10 Pro XL',
        modelCode: 'Pixel 10 Pro XL',
        osVersion: '16.0.0',
        browserVersion: '146.0.7680.177',
        architecture: 'arm64',
        formFactors: ['Mobile'],
      },
    },
  },
  // ---- Galaxy S25 Ultra (2025-01, Android 15, Chrome 146) ----
  {
    id: 'galaxy-s25-ultra',
    name: '📱 Samsung Galaxy S25 Ultra / Chrome 146 / Android 15',
    description: 'Galaxy S25 Ultra 旗舰（2025-01，6.9", Snapdragon 8 Elite，DPR=3.5）',
    marketShare: 9,
    fingerprint: {
      os: 'android',
      device: 'mobile',
      brand: 'Chrome',
      navigator: {
        userAgent:
          'Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.177 Mobile Safari/537.36',
        platform: 'Linux armv81',
        vendor: 'Google Inc.',
        language: 'en-US',
        languages: ['en-US', 'en'],
        hardwareConcurrency: 8,
        deviceMemory: 12,
        doNotTrack: 'unspecified',
      },
      screen: {
        width: 412,
        height: 891,
        availWidth: 412,
        availHeight: 891,
        colorDepth: 24,
        pixelRatio: 3.5,
      },
      timezone: 'Asia/Seoul',
      locale: 'ko-KR',
      geo: { enabled: false, latitude: 37.5665, longitude: 126.978, accuracy: 30 },
      webgl: {
        vendor: 'Google Inc. (Qualcomm)',
        renderer: 'ANGLE (Qualcomm, Adreno (TM) 830, OpenGL ES 3.2)',
        unmaskedVendor: 'Qualcomm',
        unmaskedRenderer: 'Adreno (TM) 830',
      },
      canvas: { mode: 'noise' },
      audio: { mode: 'noise' },
      webrtc: { mode: 'disabled' },
      fonts: { preset: 'android-14' },
      storageQuotaMB: 4096,
      mobile: {
        maxTouchPoints: 10,
        brand: 'Chrome',
        deviceModel: 'Galaxy S25 Ultra',
        modelCode: 'SM-S938B',
        osVersion: '15.0.0',
        browserVersion: '146.0.7680.177',
        architecture: 'arm64',
        formFactors: ['Mobile'],
      },
    },
  },
  // ---- Galaxy S25 (普通版) ----
  {
    id: 'galaxy-s25',
    name: '📱 Samsung Galaxy S25 / Chrome 146 / Android 15',
    description: 'Galaxy S25 标准版（2025-01，6.2", DPR=3）',
    marketShare: 5,
    fingerprint: {
      os: 'android',
      device: 'mobile',
      brand: 'Chrome',
      navigator: {
        userAgent:
          'Mozilla/5.0 (Linux; Android 15; SM-S931B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.177 Mobile Safari/537.36',
        platform: 'Linux armv81',
        vendor: 'Google Inc.',
        language: 'en-US',
        languages: ['en-US', 'en'],
        hardwareConcurrency: 8,
        deviceMemory: 12,
        doNotTrack: 'unspecified',
      },
      screen: {
        width: 360,
        height: 780,
        availWidth: 360,
        availHeight: 780,
        colorDepth: 24,
        pixelRatio: 3,
      },
      timezone: 'America/Chicago',
      locale: 'en-US',
      geo: { enabled: false, latitude: 41.8781, longitude: -87.6298, accuracy: 30 },
      webgl: {
        vendor: 'Google Inc. (Qualcomm)',
        renderer: 'ANGLE (Qualcomm, Adreno (TM) 830, OpenGL ES 3.2)',
        unmaskedVendor: 'Qualcomm',
        unmaskedRenderer: 'Adreno (TM) 830',
      },
      canvas: { mode: 'noise' },
      audio: { mode: 'noise' },
      webrtc: { mode: 'disabled' },
      fonts: { preset: 'android-14' },
      storageQuotaMB: 2048,
      mobile: {
        maxTouchPoints: 10,
        brand: 'Chrome',
        deviceModel: 'Galaxy S25',
        modelCode: 'SM-S931B',
        osVersion: '15.0.0',
        browserVersion: '146.0.7680.177',
        architecture: 'arm64',
        formFactors: ['Mobile'],
      },
    },
  },
];

export function getPresetById(id: string): PresetTemplate | undefined {
  return PRESETS.find((p) => p.id === id);
}

/**
 * Categorize a preset by form factor. Mobile / tablet presets advertise this
 * via `fingerprint.device`; desktop presets simply omit the field (legacy).
 */
function categoryOf(preset: PresetTemplate): DeviceCategory {
  return preset.fingerprint.device ?? 'desktop';
}

export function listPresetsByCategory(category: DeviceCategory): PresetTemplate[] {
  return PRESETS.filter((p) => categoryOf(p) === category);
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

/**
 * Random desktop preset. Default behaviour for "随机生成" so users on a
 * desktop window don't suddenly receive a mobile fingerprint. Use
 * `pickRandomPresetForCategory` to draw from a specific form factor.
 */
export function pickRandomPreset(): PresetTemplate {
  const desktop = listPresetsByCategory('desktop');
  const pool = desktop.length > 0 ? desktop : PRESETS;
  return weightedRandom(pool, pool.map((p) => p.marketShare));
}

export function pickRandomPresetForCategory(category: DeviceCategory): PresetTemplate {
  const pool = listPresetsByCategory(category);
  if (pool.length === 0) return pickRandomPreset();
  return weightedRandom(pool, pool.map((p) => p.marketShare));
}

export function generateRandomFingerprint(): FingerprintConfig {
  const preset = pickRandomPreset();
  const seed = Math.floor(Math.random() * 2_147_483_647);
  return { ...preset.fingerprint, seed };
}

export function generateRandomFingerprintForCategory(category: DeviceCategory): FingerprintConfig {
  const preset = pickRandomPresetForCategory(category);
  const seed = Math.floor(Math.random() * 2_147_483_647);
  return { ...preset.fingerprint, seed };
}

/**
 * Pick a random preset whose OS matches the given OS. Used by self-heal to
 * avoid filling missing WebGL/screen/etc. with values from a different
 * platform (e.g. Mac Apple GPU on a Windows profile).
 */
export function generateRandomFingerprintForOS(os: OSPlatform): FingerprintConfig {
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
