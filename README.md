# 指纹浏览器 (Fingerprint Browser)

> 开源、本地化、类 AdsPower 的反关联指纹浏览器配置文件管理器
> 基于 [CloakBrowser](https://github.com/CloakHQ/CloakBrowser)（C++ 源码级补丁的 Chromium 145）构建

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

1. **添加代理**（可选）：进入"代理管理"，添加 HTTP / SOCKS5 代理，点"测试"验证可用性
2. **创建配置**：进入"配置文件" → "新建配置"
   - 点击右上角"随机生成"按真实设备分布加权抽样一份指纹
   - 或从预设下拉选择（Win10+NVIDIA / Win11+Intel / Mac M2 / Linux 等 7 套真实模板）
   - 在 10 个 Tab 中精细调整任何参数；编辑器会实时高亮致死的不一致组合
   - 选择代理（推荐）
3. **一键启动**：列表上点"启动"按钮，CloakBrowser 会以该 profile 的指纹和代理打开
4. **指纹检测**（推荐）：进入"指纹检测"，选择该 profile 并打开 BrowserScan / CreepJS / FingerprintJS 验证

## 防关联设计要点

1. **C++ 层指纹**（来自 CloakBrowser）：Canvas / WebGL / Audio / 字体 / 硬件并发数 / 设备内存 / 屏幕 / 时区均在浏览器二进制层修改，JS 无法察觉
2. **TLS / JA3 一致**：CloakBrowser 内核 TLS 握手与真实 Chrome 145 完全一致
3. **WebRTC 默认禁用**：防止本机 IP 泄露
4. **每个 profile 独立 seed**：保证回访时指纹完全稳定（避免 ML 检测到漂移）
5. **代理 + 时区 geoip 联动**：避免 "美国 IP + 北京时区" 破绽
6. **一致性校验器**：保存前自动检测 OS / GPU / Platform / UA 矛盾

## Roadmap (Phase 2)

- [ ] 批量导入 / 导出（Excel / JSON）
- [ ] RPA 可视化脚本编排
- [ ] 多窗口同步器（鼠标键盘镜像）
- [ ] 团队 / 多用户权限
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
