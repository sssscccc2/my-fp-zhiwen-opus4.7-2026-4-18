# 天胡6金 v0.5.0 — CloakBrowser 0.3.29 全量集成

发布时间：2026-05-20

## 总览

本次升级把内核从 CloakBrowser 0.3.24（Chromium 145、33 patches）一路推到 **0.3.29（Chromium 146.0.7680.177.4、57 patches）**，并把 CloakBrowser 团队在新版本里加入的 5 个反检测能力全部接进我们的窗口配置：

- ✅ **Chromium 146 内核**（+24 个新 C++ patch，含 WebAuthn、AAC audio、window position、WebGL/canvas 一致性修正）
- ✅ **WebRTC ICE IP 跟随代理出口** — 远端不再看到本机 LAN IP
- ✅ **代理信号清洗** — DNS / connect / SSL 时序归零，`Proxy-Connection` header 不再泄漏
- ✅ **`FakeShadowRoot`** — 暴露闭合 shadow DOM，让指纹检测页能看到 reCAPTCHA / Turnstile 内部
- ✅ **humanize 升级** — 0.3.29 改用 isolated worlds + trusted dispatch 投递键盘事件，对 reCAPTCHA Enterprise 更友好

外加我们自己加的几个生产级开关：
- 🆕 **每窗口独立 humanize 速度预设**（默认 / 谨慎）
- 🆕 **HTTP/2 一次性 warmup 模式**（卡 Cloudflare 全防的银行类站点首次访问）
- 🆕 **指纹噪声开关**（高级，默认开）
- 🆕 **存储配额预设**（500 / 1000 / 3000 / 5000 / 10000 MB，带 FingerprintJS vs BrowserScan trade-off 提示）
- 🆕 **二进制版本自检** — 发现 `resources/` 里的内核版本旧于 wrapper 期望版本时自动 fallback 到 cache 目录

## 详细改动

### 1. 内核升级到 Chromium 146.0.7680.177.4

| 项                          | v0.4.0 之前             | v0.5.0                                 |
| -------------------------- | --------------------- | -------------------------------------- |
| `cloakbrowser` wrapper     | `^0.3.24`             | **`^0.3.29`**                          |
| Chromium 版本（Win x64）       | 145.0.7632.159        | **146.0.7680.177.4**                   |
| C++ source-level patch 数量 | 33                    | **57**                                 |
| UA 字符串                    | `Chrome/145.0.0.0`    | `Chrome/146.0.0.0`                     |
| TLS 指纹                     | 与 Chrome 145 一致        | 与 Chrome 146 一致（ja3n/ja4/akamai match） |

`resources/cloakbrowser-windows-x64/` 已替换为 146 内核（536 MB，678 files）；旧版用户更新后直接覆盖即可，不影响窗口数据。

### 2. WebRTC IP 跟随代理出口（新）

之前 WebRTC 模式 `altered` 只是把 default route 限制到 public interface — 实际 ICE candidate 还可能暴露 LAN IP（192.168.x.x）。

v0.5.0 启用 CloakBrowser 0.3.29 的新 flag：

```
--fingerprint-webrtc-ip=<proxy_exit_ip>
```

**自动流程**：
1. 窗口启动前，launcher 通过代理 probe ipinfo.io 拿到出口 IP
2. 把 IP 传给 fingerprintBuilder → 注入 `--fingerprint-webrtc-ip=<IP>` 启动 flag
3. WebRTC ICE candidate 全部显示代理 IP，本机 LAN IP 不外泄
4. 如果探测失败，回落到 `--fingerprint-webrtc-ip=auto`（CloakBrowser 自己再 probe 一次）

`disabled` 模式下额外加 `--disable-features=WebRtcAllowDataChannelsInSdp`，彻底关掉所有 UDP 出口。

### 3. FakeShadowRoot（新默认）

默认追加 `--enable-blink-features=FakeShadowRoot`。意义：

- 让指纹检测页（包括我们自带的 `/fingerprint-test`）能查询 reCAPTCHA / Turnstile / Cloudflare challenge 的内部 DOM
- 不影响真实站点 — 普通页面行为完全不变
- CloakBrowser 0.3.29 推荐默认开启

### 4. humanize 行为预设（新选项）

每个窗口可以单独选择 humanize 速度：

| 预设            | 鼠标速度        | 键盘速度    | 滚轮     | 适用场景                                  |
| ------------- | ----------- | ------- | ------ | ------------------------------------- |
| 默认 (default) | 正常人         | 100-200 ms/字符 | 平滑      | 日常使用，已经足够通过 reCAPTCHA v3 ≥ 0.7    |
| 谨慎 (careful) | 慢、有微抖动 | 200-400 ms/字符 | 更深思熟虑 | reCAPTCHA Enterprise / Cloudflare 全防初次登录 |

入口：**配置编辑器 → 高级 (CloakBrowser) Tab**

### 5. HTTP/2 warmup 模式（新选项）

部分银行登录页 / Cloudflare 全防站点会对**第一次 HTTP/2 访客**发硬挑战；养出 cookie 后再恢复 HTTP/2 就完全没问题。

启用方式：**配置编辑器 → 高级 Tab → 强制 HTTP/1.1**（养完 cookie 后再关掉，恢复正常 HTTP/2 性能）。

实现：启动参数追加 `--disable-http2`。

### 6. 指纹噪声开关（高级）

`--fingerprint-noise=false` — 关闭后 canvas / WebGL / audio 每次启动产生**完全相同**的指纹（仅由 seed 决定）。

> ⚠️ 默认强烈建议保持开启。只在测试指纹是否稳定时用。

### 7. 存储配额预设 + 提示

旧版只是一个 InputNumber，用户根本不知道选什么值好。新版改成下拉选项，每个值都带说明：

| 配额      | FingerprintJS    | BrowserScan notPrivate |
| ------- | ---------------- | ---------------------- |
| 500 MB  | PASS             | -10 分（标记无痕）              |
| 5000 MB | 可能触发检测        | PASS（看作正常持久窗口）            |
| 1000-3000 MB | 大概率通过      | 大概率通过                    |

trade-off 信息直接在 label 的 Tooltip 里。

### 8. 二进制版本自检（防止旧内核 + 新 wrapper 错配）

升级 wrapper 后，如果 `resources/` 里的 chrome.exe 版本（145）旧于 wrapper 期望版本（146），launcher 会：

1. 不把旧的 chrome.exe 路径设置成 `CLOAKBROWSER_BINARY_PATH`
2. 让 wrapper 走自己的 cache 解析 → 找到 `<userData>/cloakbrowser/chromium-146/chrome.exe`
3. 仍找不到则提示用户去"系统设置 → CloakBrowser 内核 → 重新下载"

这样升级期间不会因为内核没换而失去 24 个新 patch + WebRTC IP spoof 等新 flag。

## 检测对比（CloakBrowser 官方基准）

| 检测站点                  | 旧 v0.4 (Chromium 145, 33 patches) | v0.5.0 (Chromium 146, 57 patches) |
| --------------------- | -------------------------------- | -------------------------------- |
| reCAPTCHA v3           | 0.7-0.9                           | **0.9（human）**                    |
| Cloudflare Turnstile   | 大概率通过                          | **直接通过**                          |
| FingerprintJS          | 通过                              | **通过**                            |
| BrowserScan            | 部分项 -10                          | **NORMAL 4/4**                    |
| bot.incolumitas.com    | 1-3 fails                          | **1 fail (WEBDRIVER spec only)**  |
| deviceandbrowserinfo  | isBot: false                      | **isBot: false (24/24 signals)**  |
| WebRTC LAN IP 泄漏     | altered 模式下可能泄漏 192.168.* | **完全无泄漏（IP=代理出口）**             |

## 向下兼容 / 迁移

- **数据库**：自动增加 3 个新列（`human_preset` / `disable_http2` / `fingerprint_noise`），老窗口默认值就是"开箱即用"配置，不需要手动改
- **指纹配置**：完全向下兼容，老 profile 直接打开即用
- **多端同步**：服务端协议不变（只是多了 3 个可选字段），跨电脑同步无障碍
- **二进制**：升级后第一次启动 launcher 会自动识别 145→146 并使用正确版本

## 已知问题 / 注意事项

1. 移动端窗口模式（v0.4.0 添加）和 CloakBrowser 0.3.29 一起跑过两个验证场景，目前未发现冲突
2. 如果你之前手动把 chrome.exe 放在 `resources/cloakbrowser-windows-x64/`，记得更新成 146 版本（安装包已经带了）
3. WebRTC IP spoof 依赖代理 probe 成功 — 代理坏了的时候会 fallback 到 `auto`，最坏情况是启动慢 1-2 秒
