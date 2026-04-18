# 天胡 6 金 / 指纹浏览器 (Fingerprint Browser)

> 开源、本地化、类 AdsPower 的反关联指纹浏览器配置文件管理器
> 基于 [CloakBrowser](https://github.com/CloakHQ/CloakBrowser)（C++ 源码级补丁的 Chromium 145）构建

---

## 更新日志

### v0.2.0 — Cookies 导入注入（2026-04-18）

新增「**每个窗口独立的 Cookies 注入**」功能，专为接管异地账号 / 迁移会话设计。

**功能要点**

- 在「编辑配置」页新增 **Cookies（可选）** 卡片，支持粘贴 JSON 后保存
- **三种格式自动识别 + 互相转换**：
  1. iSO / AdsPower / Bit 风格（PascalCase：`Name / Value / Domain / Secure / HttpOnly / Persistent / HasExpires / Expires / Samesite`）
  2. EditThisCookie / Cookie-Editor 扩展导出（`name / value / domain / sameSite / expirationDate`）
  3. Playwright JSON 导出（`name / value / domain / expires / sameSite`）
- **实时预览**：识别条目数、跳过条目数、涉及域名分布、识别格式
- **自动去重**：同 `name + domain + path` 重复取首条，避免 cookie jar 写入冲突
- **字段安全映射**：
  - `Samesite "-1"`→未设置、`"0"`→`None`、`"1"`→`Lax`、`"2"`→`Strict`（Chromium 内部 enum）
  - `1601-01-01` 这类 sentinel 时间戳自动当作 session cookie
  - `Expires` 仅当 `HasExpires="1"` 且 `Persistent="1"` 时才参与持久化
- **启动时自动注入**：每次启动浏览器，会在第一个 `newPage()` 之前调用 Playwright `BrowserContext.addCookies()`
  完成注入。访问目标站点的第一个请求就带 cookie，刷新即登录态
- **导出标准 JSON**：一键复制规范化后的 cookie 列表给其他工具使用
- **一键清空**：保存后立即生效

**安全性说明**

| 检测层 | 是否受影响 | 原因 |
|---|---|---|
| Canvas / WebGL / Audio / 字体 fingerprint | **无** | cookie 是应用层数据，与 C++ 层指纹完全正交 |
| `document.cookie` / `cookieStore` 表面 | **看不出** | `addCookies` 直接写 cookie jar，与 `Set-Cookie` 入库等价 |
| TLS / JA3 / TCP fingerprint | **无** | OS / Chromium 网络层 |
| 站点服务端会话校验 | **可能扣分** | 站点会绑定 IP 国家 / UA / 设备指纹，跨环境注入会触发风控（这是 cookie 本身的特性，不是注入手段的问题） |

**最佳实践**

1. **同国代理** — cookie 来源浏览器是哪个国家 IP，本窗口用同国代理
2. **UA 系列匹配** — 来源是 Chrome Windows，本窗口指纹也用 Chrome Windows
3. **导入后先正常浏览** — 不要立刻做敏感操作（发帖 / 改密 / 转账）
4. **localStorage 也要补** — 仅导 cookie 是「半登录态」，部分站点会不稳定（后续版本计划支持）

详见源码：[`shared/cookieFormats.ts`](./shared/cookieFormats.ts) / [`electron/main/services/browserLauncher.ts`](./electron/main/services/browserLauncher.ts)

### v0.1.0 — 首个可用版本（2026-04-17）

- Profile / Group / Proxy CRUD（SQLite）
- 50+ 指纹参数配置 + 7 套真实预设
- 每窗口独立绑定 SOCKS5 / HTTP 代理，自动检测出口 IP / 时区 / 语言
- 自建 DNS-over-SOCKS5 桥（避免 IP / DNS 跨国不一致）
- 远程认证服务器 + 管理后台（启用 / 禁用账号）
- 一键打包 NSIS 安装包（内置 CloakBrowser，无需额外下载）

---

## 它能做什么

为每一个账号 / 每一次任务创建一个完全独立的浏览器身份：

- **独立的指纹**：Canvas / WebGL / Audio / 字体 / WebRTC / TLS 等 50+ 参数全部由 CloakBrowser 在 C++ 层修改，JS 无法侦测
- **独立的 cookies / localStorage / 缓存**：每个 profile 一个隔离目录
- **独立的代理（HTTP / HTTPS / SOCKS5）**
- **独立的时区 / 语言**（开启 `geoip` 时按代理出口 IP 自动对齐）

> **核心理念**：不是单点伪装，而是**多层一致性**。
> Modern 反爬系统（Cloudflare、DataDome、PerimeterX）会跨 TLS / HTTP / Browser API 三层做交叉校验，
> 任一层不一致即被封号。本工具的指纹一致性校验器会在保存配置前就标红致死组合（如 Win UA + Mac GPU）。

## 技术栈

| 层 | 选择 |
|---|---|
| 浏览器内核 | CloakBrowser 0.3.x（Chromium 145 + 33 个 C++ 补丁，MIT） |
| 桌面框架 | Electron 32 + electron-vite |
| 前端 | React 18 + TypeScript + Ant Design 5 |
| 本地数据库 | SQLite (better-sqlite3) |
| 代理校验 | 原生 socket（HTTP CONNECT / SOCKS5）→ ipinfo.io |

## 架构

```
┌──────────────────────────────────────────────────────┐
│                   Electron App                        │
│  ┌──────────────┐         ┌──────────────────────┐  │
│  │ React Renderer│  IPC   │  Main Process         │  │
│  │ (UI / Forms)  │ <────> │  Profile/Proxy/Launch │  │
│  └──────────────┘         │  ┌────────────────┐  │  │
│                            │  │  SQLite        │  │  │
│                            │  └────────────────┘  │  │
│                            └──────────┬───────────┘  │
└───────────────────────────────────────┼──────────────┘
                                        │
                                        ▼
┌──────────────────────────────────────────────────────┐
│  cloakbrowser (npm)  →  patched Chromium 145 binary  │
│                                                       │
│  /userData/profiles/<uuid>/   ← 独立 cookies/storage │
└──────────────────────────────────────────────────────┘
                                        │
                                        ▼
              HTTP/SOCKS5 Proxy → Internet
```

## 安装与运行

### 先决条件

- Node.js 20+ （已用 24 测试）
- Windows 10/11 x64（macOS / Linux 也可以，但 CloakBrowser 二进制需对应平台）
- 网络可访问 GitHub Releases（首次启动会下载 ~200MB CloakBrowser 二进制）

### 开发模式

```bash
npm install
npm run dev
```

首次启动 CloakBrowser 时会从 GitHub Releases 下载补丁版 Chromium（约 200MB），
请确保网络通畅；建议预先 `npx cloakbrowser install` 触发下载。

### 打包 Windows 安装包

```bash
npm run package
```

产物在 `release/` 目录。

## 项目结构

```
.
├── electron/
│   ├── main/
│   │   ├── index.ts                 主进程入口
│   │   ├── ipc/                     IPC 路由
│   │   ├── services/
│   │   │   ├── profileService.ts    profile CRUD
│   │   │   ├── browserLauncher.ts   调用 cloakbrowser
│   │   │   ├── proxyService.ts      代理 CRUD + 测试
│   │   │   ├── fingerprintBuilder.ts 一致性校验 + 启动参数生成
│   │   │   └── presets.ts           内置 7 套设备指纹预设
│   │   └── db/                      SQLite schema + client
│   └── preload/
│       └── index.ts                 contextBridge API
├── src/                             React 渲染进程
│   ├── App.tsx
│   ├── api.ts                       类型安全的 IPC 封装
│   ├── pages/
│   │   ├── ProfileList.tsx          列表 + 卡片视图
│   │   ├── ProfileEditor.tsx        50+ 参数编辑器（10 个 Tab）
│   │   ├── ProxyManager.tsx
│   │   ├── FingerprintTest.tsx
│   │   └── About.tsx
│   └── styles.css
├── shared/                          主进程 / 渲染进程共享类型
└── electron.vite.config.ts
```

## 使用流程

1. **登录**（首启）：连接到内置认证服务器（默认 `http://146.190.45.66:3000`），可注册新账号
2. **创建配置**：左下角「新建窗口」
   - 在「基本信息」填名字 / 分组 / 备注
   - 在「代理 / 出口 IP」直接粘贴 `host:port:user:pass` 或 `socks5://...`，点「测试 & 识别出口 IP」自动获取国家 / 时区 / 语言
   - 在「**Cookies（可选）**」粘贴 JSON（v0.2.0 起支持，详见上方更新日志）
   - 在「DNS 设置」选「自建 DNS」搭配同国 ISP DNS（最大化"本地用户"伪装）
   - 在「指纹参数」10 个 Tab 内精细调整任何参数；编辑器会实时高亮致死的不一致组合
3. **一键启动**：列表上点「打开」按钮，CloakBrowser 会以该 profile 的指纹 + 代理 + cookies 打开
4. **指纹检测**（推荐）：进入「指纹检测」，选择该 profile 并打开 whoer.net / iphey.com / browserleaks.com 验证

## 防关联设计要点

1. **C++ 层指纹**（来自 CloakBrowser）：Canvas / WebGL / Audio / 字体 / 硬件并发数 / 设备内存 / 屏幕 / 时区均在浏览器二进制层修改，JS 无法察觉
2. **TLS / JA3 一致**：CloakBrowser 内核 TLS 握手与真实 Chrome 145 完全一致
3. **WebRTC 默认禁用**：防止本机 IP 泄露
4. **每个 profile 独立 seed**：保证回访时指纹完全稳定（避免 ML 检测到漂移）
5. **代理 + 时区 geoip 联动**：避免 "美国 IP + 北京时区" 破绽
6. **一致性校验器**：保存前自动检测 OS / GPU / Platform / UA 矛盾

## Roadmap

已完成：

- [x] 多窗口隔离（profile / cookies / cache）
- [x] 每窗口独立代理 + 自动出口 IP / 时区 / 语言对齐
- [x] DNS-over-SOCKS5（杜绝 IP / DNS 跨国不一致）
- [x] Cookies 注入（v0.2.0，AdsPower / iSO / EditThisCookie / Playwright 多格式）
- [x] 远程认证 + 管理后台
- [x] 标准 NSIS 安装包（内置 Chromium）

计划中：

- [ ] **localStorage / sessionStorage / IndexedDB 一并导入**（让 cookie 注入达到完整登录态）
- [ ] 批量导入 / 导出 profile（Excel / JSON）
- [ ] RPA 可视化脚本编排
- [ ] 多窗口同步器（鼠标键盘镜像）
- [ ] 团队 / 多用户权限（已有认证基础设施）
- [ ] WebDAV / S3 云端同步
- [ ] 移动端 UA 模拟（iOS / Android）

## 免责声明

**本工具仅限合法用途**：

- 个人隐私保护
- 自动化测试 / QA
- 广告投放验证
- 反爬虫研究
- 多账号合规管理（在符合平台 ToS 的前提下）

**严禁**用于欺诈、刷单、绕过版权保护、攻击他人系统、传播恶意软件等违法行为。
使用者须自行承担因不当使用产生的一切法律后果。

## License

MIT

## 致谢

- [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) — Stealth Chromium binary
- [BotBrowser](https://github.com/MiddleSchoolStudent/BotBrowser) — Reference design
- [Camoufox](https://github.com/daijro/camoufox) — Firefox-side approach
