# 天胡 6 金 / 指纹浏览器 (Fingerprint Browser)

> 开源、本地化、类 AdsPower 的反关联指纹浏览器配置文件管理器
> 基于 [CloakBrowser](https://github.com/CloakHQ/CloakBrowser)（C++ 源码级补丁的 Chromium 145）构建

---

## 更新日志

### v0.3.2 — Cookie 解密剥离 SHA256 host_key 前缀（2026-04-19）

修复 v0.3.1 解密后的 cookie value 字段开头有 32 字节二进制乱码的问题。

**根因**：从 Chromium 116（[CL 4609637](https://chromium-review.googlesource.com/c/chromium/src/+/4609637)）开始，cookies 加密前的明文实际格式是：

```
SHA256(host_key)  ||  real_value
```

也就是说 AES-GCM 解密成功后的明文前面**还有 32 字节 host_key 的 SHA256 哈希**，作为 cookie 的反篡改/host-binding 校验。v0.3.1 直接把整个解密结果当 value，导致每条 cookie value 开头都是一坨二进制（按 domain 分组完全相同，正好是该 domain 的 SHA256）。

**修复**：在 `cookieExtractor.decryptCookieValue()` 末尾增加一个步骤：

```ts
if (hostKey && plain.length >= 32) {
  const hostHash = crypto.createHash('sha256').update(hostKey, 'utf-8').digest();
  if (plain.subarray(0, 32).equals(hostHash)) {
    plain = plain.subarray(32);   // 剥离 host-binding prefix
  }
}
```

校验机制（如果前 32 字节不等于 SHA256(host_key) 就保留原文），保证旧版 Chromium（< 116）写入的 cookie 不受影响。

**实测验证**（Chromium 145 / CloakBrowser）：本机 2 个窗口 113 条 cookie，10+ 个域（reddit / google / discord / yandex / whoer / criteo / hcaptcha / ...），**全部解密成 100% 干净明文，零乱码零失败**。

**新增工具**

- `scripts/test-cookie-extract.cjs` — 独立的端到端解密自检脚本，可直接 `node scripts/test-cookie-extract.cjs` 跑
- `scripts/check-reddit-login.cjs` — Reddit 登录态专项探测脚本

### v0.3.1 — 云同步登录态修复（DPAPI 解密 + 注入回放）（2026-04-19）

修复 v0.3.0 一个**关键问题**：上传到服务器的 Cookies SQLite 文件因为 Chromium 用 Windows DPAPI（绑定 Windows 用户登录凭证）加密了 `value` 字段，跨电脑下载后解不开 → 表现为"窗口同步过来了但都没登录"。

**修复方式（方案 C）**

- **上传前**：sync engine 对每个 profile 自动调用 `cookieExtractor`：
  1. 读 `Local State.os_crypt.encrypted_key`
  2. 通过 PowerShell 子进程调用 DPAPI `Unprotect` 拿到 32 字节 AES master key
  3. 用 sql.js 读 `Default/Network/Cookies` 表
  4. 对每条 cookie 的 `encrypted_value`（v10/v11 格式）做 AES-256-GCM 解密
  5. 转成 v0.2 标准 cookie JSON，写入 `profile.cookies` 字段
- **服务器**：snapshot.json 里多了明文 `cookies` 字段（基于"不加密"的整体策略）
- **下载后**：`profile.cookies` 写回本地数据库
- **启动浏览器时**：v0.2 已有的 `context.addCookies()` 自动把 cookies 注入到新机器的 profile → 立即登录态

**特性 / 注意事项**

| 场景 | 处理 |
|---|---|
| Chromium v10/v11（Chrome 80~126） | ✅ 完整解密 |
| Chromium v20 App-Bound Encryption（Chrome 127+） | ⚠️ 跳过（CloakBrowser 默认禁用，正常情况遇不到） |
| Cookies 文件被运行中浏览器锁定 | 复制到临时文件再读，避开 SQLITE_BUSY |
| 上传日志 | 控制台打印 `dumped X/Y cookies for "name" (skipped Z)` |
| Local State / Cookies SQLite 仍照常同步 | 同台机器恢复时直接 work，跨机器靠注入回放 |

**新增文件**

- `electron/main/services/cookieExtractor.ts` — DPAPI + AES-GCM + Cookies SQLite 读取

**升级用户操作**

旧 v0.3.0 已经上传到云端的 cookies 没有明文版本 → 下载到新电脑还是没登录态。**升级到 v0.3.1 后，在原电脑重新点一次"上传到云端"即可补全 cookies**，新电脑再下载就有登录态了。

### v0.3.0 — 云同步（多端账号同步）（2026-04-19）

新增「**整账号云同步**」功能 — 在另一台电脑安装本程序、用同一账号登录，一键把所有窗口（含 cookies / 扩展 / 本地存储）拉过去，无需手动复制目录。

**架构**

- 客户端 → 服务端走原有的认证服务器（`146.190.45.66:3000`），新加一组 `/api/sync/*` REST API
- 服务端按用户隔离存储于 `/opt/fp-browser-auth/sync-data/<用户名>/`：
  - `snapshot.json` — 元数据（窗口列表、分组、代理）
  - `manifests/<id>.json` — 每窗口的文件清单（路径 + sha256 + 大小）
  - `blobs/<sha[:2]>/<sha>` — 实际文件内容，**SHA-256 内容寻址** + **跨用户无关字段去重**
- 同步范围由 `shared/profileWhitelist.ts` 白名单决定：Cookies / Local Storage / IndexedDB / Extensions / Preferences / Bookmarks / Login Data… 排除一切磁盘缓存（GPU Cache / Code Cache / Service Worker）

**功能要点**

- 主页右上角「**云同步**」按钮，5 种状态自动识别：`已同步 / 需要上传 / 云端更新 / 存在冲突 / 尚未同步`
- **手动触发** — 点按钮才传，不静默后台同步
- **增量上传** — 用 sha256 对比，第二次同步只传变化的文件，相同内容自动复用云端已有 blob
- **覆盖式冲突** — 多端冲突时弹窗警告"将覆盖云端 / 覆盖本地"，由用户选择哪边为准
- **删除联动** — 客户端删窗口时自动通知服务器清理 manifest + GC 引用计数为 0 的 blob
- **进度可视化** — 扫描 / 上传 / 下载实时进度条 + 当前文件名
- **配额限制** — 每用户 500 MB / 单文件 50 MB（超限服务器返回 `QUOTA_EXCEEDED` 拒绝）

**管理后台增强**（`http://<server>:3000/admin`）

- 新增「**窗口管理**」Tab，admin 能看到所有用户已上传的窗口
- 一键 **转移窗口** 给其他用户（manifest 移动 + 引用 blob 复制 + 源端 GC，操作幂等）

**安全性**

- 不加密传输（HTTP）— token 鉴权 + 用户名空间隔离 + path traversal 防护
- 不影响指纹反检测：纯应用层数据搬运，与 Chromium 内核 / Cookies 注入完全正交

**新增文件**

| 路径 | 用途 |
|---|---|
| `shared/syncTypes.ts` | 同步协议类型定义 |
| `shared/profileWhitelist.ts` | 文件同步白名单 + 黑名单 |
| `electron/main/services/syncEngine.ts` | 主进程同步引擎（扫描 + hash + 上传下载） |
| `src/lib/syncClient.ts` | 渲染端 IPC 封装 |
| `src/components/SyncWidget.tsx` | 主页右上角同步按钮组件 |
| `auth-server/server.js` | 服务端 `/api/sync/*` 路由 + 管理后台窗口管理 Tab |

**跨电脑迁移流程**

1. 旧电脑：登录 → 主页 → 云同步 → 上传到云端
2. 新电脑：安装本程序 → 用**相同账号**登录 → 云同步 → 从云端下载
3. 完成 — 所有窗口（含登录状态）都搬过来了

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
