# v0.4.0 — 移动端窗口模式（手机 / 平板 反检测）

> 对标 比特浏览器 / AdsPower / Multilogin 的「手机 profile」模式，叠加 2025-2026 最新反检测研究成果。

发布日期：2026-05-03

---

## 概述

新增「**📱 移动端窗口**」模式 —— 在原有桌面 Windows / macOS / Linux 之外，可以一键创建以 iPhone / iPad / Android 真机身份运行的浏览器窗口。站点会以为是一台货真价实的手机：响应触摸、按 DPR 加载 @3x 资源、`navigator.userAgentData.mobile=true`、`Sec-CH-UA-Mobile: ?1` 全套客户端提示一致。

适用场景：

- 手机端 H5 营销活动 / 社媒账号管理
- 移动端专属价格 / 优惠监测
- 反爬绕过（部分风控对桌面 UA 加倍审查）
- 移动端真机回归测试

---

## 设备类型选择器（基本信息卡顶部）

像比特浏览器那样的 PC / 平板 / 手机分段控件。切换时自动加载对应平台的真实指纹（UA / 屏幕 / GPU / DPR / 触摸点 / 字体集 / OS 版本 / 浏览器版本），全部保持一致性。

```
设备类型：[💻 电脑] [📱 平板] [📱 手机]
```

切换会触发 `api.preset.random(category)` 按市场份额加权抽一台真机，例如手机模式默认池：

| 预设                       | 屏幕         | DPR    | UA / OS                | 占比 |
| ------------------------ | ---------- | ------ | ---------------------- | -- |
| iPhone 17 Pro Max        | 440×956    | 3      | iOS 18.7 / Safari 26.5 | 14 |
| iPhone 17 Pro            | 402×874    | 3      | iOS 18.7 / Safari 26.5 | 16 |
| iPhone 17                | 402×874    | 3      | iOS 18.7 / Safari 26.5 | 10 |
| iPhone Air               | 420×912    | 3      | iOS 18.7 / Safari 26.5 | 4  |
| iPhone 16 Pro            | 402×874    | 3      | iOS 18.4 / Safari 18.4 | 12 |
| iPad Pro 13" M4 (tablet) | 1024×1366  | 2      | iPadOS 18.4            | 5  |
| Pixel 10 Pro             | 410×914    | 3.125  | Android 16 / Chrome 146 | 10 |
| Pixel 10 Pro XL          | 414×921    | 3.25   | Android 16 / Chrome 146 | 6  |
| Galaxy S25 Ultra         | 412×891    | 3.5    | Android 15 / Chrome 146 | 9  |
| Galaxy S25               | 360×780    | 3      | Android 15 / Chrome 146 | 5  |

数据来源：**iosref.com / screensizechecker.com / whatmyuseragent.com 实采**（截至 2026-04）。

---

## 反检测核心：mobileStealth.ts

启动浏览器后，**自动**对 Context 注入两层防护：

### 第一层：CDP `Emulation.setUserAgentOverride` 完整 UA-CH

```ts
session.send('Emulation.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) ...',
  acceptLanguage: 'en-US',
  platform: 'iPhone',
  userAgentMetadata: {
    brands: [{ brand: 'Safari', version: '26' }, ...],
    fullVersionList: [{ brand: 'Safari', version: '26.5' }, ...],
    platform: 'iOS',
    platformVersion: '18.7.0',
    architecture: 'arm64',
    model: 'iPhone18,1',     // ← FingerprintJS Pro 高熵线索！
    mobile: true,
    bitness: '64',
    formFactors: ['Mobile'],
  },
});
```

效果：所有出站 HTTP 请求自动带 `Sec-CH-UA-Mobile: ?1`、`Sec-CH-UA-Platform: "iOS"`、`Sec-CH-UA-Platform-Version: "18.7.0"`、`Sec-CH-UA-Arch: "arm64"`、`Sec-CH-UA-Model: "iPhone18,1"`、`Sec-CH-UA-Form-Factors: "Mobile"`。

参考：[WICG/ua-client-hints#386](https://github.com/WICG/ua-client-hints/issues/386)（BiDi 标准化提案，2026-01）。

### 第二层：Playwright `addInitScript` 在所有 page / iframe / worker 第一行执行

| 检测项 | 修补 | 来源 |
| --- | --- | --- |
| `navigator.userAgent` / `platform` / `vendor` / `language[s]` | `Object.defineProperty` 全替换 | 基础 |
| `navigator.userAgentData`（Android 必有，iOS 必无） | 完整模拟 + `getHighEntropyValues()` async 返回 | UA-CH 规范 |
| `navigator.maxTouchPoints` / `ontouchstart` / `TouchEvent` | iOS 强制 5、Android 5–10 | HackingLZ b7 |
| `navigator.connection`（Android NetworkInformation API） | 4G/Wi-Fi 拟态 + addEventListener | HackingLZ b12 |
| `window.chrome` 形态（Android Chrome） | 完整 `loadTimes / csi / runtime / app` | berstend stealth |
| `pdfViewerEnabled = false`（iOS） | iOS Safari 实测值 | UA 一致性 |
| `navigator.plugins` 长度（iOS=0，Chrome=5） | iOS 返回空 PluginArray | iOS 实测 |
| `navigator.getBattery`（iOS 没有） | 删除 | iOS API 表面 |
| `navigator.webdriver` | 强制 undefined + 删原型属性 | 经典 |
| Playwright 残留：`__playwright` / `__pw_manual` / `__pw_preview` / `__pwInitScripts` | delete + 拦截 getter | HackingLZ b13 |
| ChromeDriver 残留：`cdc_*` / `$cdc_*` | 全清 | HackingLZ b2 |
| `screen.colorDepth / pixelDepth` | 与设备一致（24） | 基础 |

实现位置：[`electron/main/services/mobileStealth.ts`](electron/main/services/mobileStealth.ts)（~250 行，无外部依赖）。

### 一致性校验扩展

`fingerprintBuilder.validateConsistency()` 增加 iOS / Android 校验：

- iOS UA 必须含 `iPhone` / `iPad` / `iPod`
- Android UA 必须含 `Android`
- iOS DPR 必须 ≥ 2（iPhone 4 起就是 Retina，HackingLZ b6）
- Android DPR 通常 ≥ 1.5
- 移动端屏幕宽度 ≤ 1280（防止误填桌面分辨率）
- 移动端必须竖屏（`height > width`）
- 移动端 `maxTouchPoints ≥ 1`
- iOS GPU 必须是 Apple GPU
- Android GPU 必须是 Adreno / Mali / Xclipse / PowerVR

---

## UI 升级（ProfileEditor）

### 新增「📱 移动端」Tab（仅手机 / 平板模式可见）

完全对标比特浏览器的"操作系统版本 / 浏览器版本"下拉：

| 字段 | 示例 | 用途 |
| --- | --- | --- |
| 设备型号（显示名） | `iPhone 17 Pro` | 列表卡片显示 |
| 设备代号 (`userAgentData.model`) | `iPhone18,1` / `SM-S938B` / `Pixel 10 Pro` | 高熵 Client Hints |
| 操作系统版本 | `18.7.0` / `16.0.0` | UA 字符串 + `Sec-CH-UA-Platform-Version` |
| 浏览器版本 | `26.5` / `146.0.7680.177` | UA 字符串 + `Sec-CH-UA-Full-Version-List` |
| CPU 架构 | `arm64` / `arm` / 空 | `Sec-CH-UA-Arch` |
| `maxTouchPoints` | 1 / 2 / 5 / 10 | iOS 必须 5，三星 10 |
| Form Factors | `Mobile` / `Tablet` / `Foldable` | `Sec-CH-UA-Form-Factors`（2025+ 真机） |
| 浏览器品牌 | Safari / Chrome / Edge / Samsung Internet | UA-CH 品牌列表 |

切换设备类型后，整套字段会按所选真机自动填充，无需逐个调。

### Navigator / Fonts Tab 也对应动态

- OS 选项：电脑→Windows/Mac/Linux，平板→iPadOS/Android，手机→iOS/Android
- platform 选项：手机→iPhone/iPod/Linux armv81，平板→iPad/Linux armv81
- 字体集：新增 `iOS 17 / iOS 18 / Android 13/14/15/16` 默认集

### 列表 / 卡片视图

- 表格新增「设备」列（带图标 + 三类筛选）
- 卡片标题前加设备图标 Tag，并显示 `mobile.deviceModel`（例如"iPhone 17 Pro Max"）

---

## 兼容性 / 升级说明

- **完全向后兼容**：旧 profile 缺少 `device` 字段时按桌面处理，行为零变化
- **桌面预设池随机时不会抽到手机**：避免老用户体验回归
- **CloakBrowser C++ 层指纹补丁继续生效**：iOS 在 C++ 层映射到 `macos`、Android 映射到 `linux`，移动身份完全靠 UA + Playwright mobile emulation + CDP UA-CH + InitScript 实现
- 移动端窗口的实际显示尺寸自动放大到 ~460×980（手机）/ ~820×1100（平板），保持设备宽高比，方便桌面操作；JS 层依旧看到真实手机 viewport

---

## 检测验证建议

启动手机 profile 后，访问：

1. <https://browserleaks.com/client-hints> — 应显示 `Sec-CH-UA-Mobile: ?1`、`Platform` 与所选设备一致
2. <https://abrahamjuliot.github.io/creepjs/> — 反检测综合检测，移动端预期 trust score 高于 60
3. <https://bot.sannysoft.com/> — 经典 stealth 检测，绿条全过
4. <https://pixelscan.net/> — 应判定为对应国家移动用户、提示一致性高
5. <https://hmaker.github.io/selenium-detector/> — 无 webdriver / cdc_ / playwright 痕迹

---

## 新增 / 修改文件

| 路径 | 说明 |
| --- | --- |
| `shared/types.ts` | `OSPlatform += 'ios'\|'android'`，新增 `DeviceCategory` / `MobileConfig` 完整字段 |
| `electron/main/services/presets.ts` | 10 套 2025-2026 真机预设 + `pickRandomPresetForCategory` |
| `electron/main/services/fingerprintBuilder.ts` | 移动端一致性校验、移动 viewport / DPR 注入 |
| `electron/main/services/mobileStealth.ts` ⭐ | CDP UA-CH + InitScript 全套反检测（新增） |
| `electron/main/services/browserLauncher.ts` | 启动后自动调用 `applyMobileStealthToContext` |
| `electron/main/services/profileService.ts` | 老 profile 自愈 mobile 字段 |
| `electron/main/ipc/index.ts` | `preset.random` 接受 `'mobile'\|'tablet'\|'desktop'` 分类 |
| `src/pages/ProfileEditor.tsx` | 设备分段控件 + 移动端 Tab + 联动 OS/platform/preset 列表 |
| `src/pages/ProfileList.tsx` | 设备类型列 + 卡片图标 + 显示设备型号 |

---

## 致谢

- [HackingLZ/fingerprint_js](https://github.com/HackingLZ/fingerprint_js) — 2026-03 综合检测点列表
- [itbrowser-net/undetectable-fingerprint-browser](https://github.com/itbrowser-net/undetectable-fingerprint-browser) — 移动指标设计
- [kaliiiiiiiiii/Selenium_Profiles](https://github.com/kaliiiiiiiiii/Selenium_Profiles) — userAgentMetadata 模板
- [WICG/ua-client-hints](https://github.com/WICG/ua-client-hints) — UA-CH 规范
- [iosref.com](https://iosref.com/res) / [screensizechecker.com](https://screensizechecker.com/) — 真机屏幕参数
