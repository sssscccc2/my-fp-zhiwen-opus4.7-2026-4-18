## v0.3.1 — 云同步登录态修复（DPAPI 解密 + 注入回放）

修复 v0.3.0 一个**关键问题**：上传到服务器的 Cookies SQLite 文件因为 Chromium 用 Windows DPAPI（绑定 Windows 用户登录凭证）加密了 `value` 字段，跨电脑下载后解不开 → 表现为"窗口同步过来了但都没登录"。

### 修复方式（方案 C：解密上传 + 注入回放）

- **上传前**：sync engine 对每个 profile 自动调用 `cookieExtractor`：
  1. 读 `Local State.os_crypt.encrypted_key`
  2. 通过 PowerShell 子进程调用 DPAPI `Unprotect` 拿到 32 字节 AES master key
  3. 用 sql.js 读 `Default/Network/Cookies` 表
  4. 对每条 cookie 的 `encrypted_value`（v10/v11 格式）做 AES-256-GCM 解密
  5. 转成 v0.2 标准 cookie JSON，写入 `profile.cookies` 字段
- **服务器**：snapshot.json 里多带一份明文 cookies（基于不加密的整体策略）
- **下载后**：`profile.cookies` 写回本地数据库
- **启动浏览器时**：v0.2 已有的 `context.addCookies()` 自动注入 → 立即登录态

### 特性 / 注意事项

| 场景 | 处理 |
|---|---|
| Chromium v10/v11（Chrome 80~126） | 完整解密 |
| Chromium v20 App-Bound Encryption（Chrome 127+） | 跳过（CloakBrowser 默认禁用，正常情况遇不到） |
| Cookies 文件被运行中浏览器锁定 | 复制到临时文件再读，避开 SQLITE_BUSY |
| 上传日志 | 控制台打印 `dumped X/Y cookies for "name" (skipped Z)` |

### 升级用户必做操作

旧 v0.3.0 已经上传到云端的 cookies 没有明文版本 → 下载到新电脑还是没登录态。

**升级到 v0.3.1 后**：在原电脑重新点一次"上传到云端"，就会把 cookies 解密后的明文版本补传到服务器。新电脑再下载就有登录态了。

### 新增文件

- `electron/main/services/cookieExtractor.ts` — DPAPI + AES-GCM + Cookies SQLite 读取（约 250 行）

### 安装

下载下面的 `TianHu6Jin-0.3.1-Setup.exe` 双击安装即可（覆盖安装会保留所有窗口数据 / 数据库 / 登录信息）。
