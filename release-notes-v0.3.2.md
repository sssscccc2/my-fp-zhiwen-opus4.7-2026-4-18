## v0.3.2 — Cookie 解密剥离 SHA256 host_key 前缀

修复 v0.3.1 解密后的 cookie value 字段开头有 32 字节二进制乱码的问题（按 domain 分组完全相同的乱码前缀，后面才跟真实明文）。

### 根因

从 Chromium 116（[CL 4609637](https://chromium-review.googlesource.com/c/chromium/src/+/4609637)）开始，cookies 加密前的明文实际格式是：

```
SHA256(host_key)  ||  real_value
```

也就是说 AES-GCM 解密成功后的明文前面**还有 32 字节 host_key 的 SHA256 哈希**作为反篡改/host-binding 校验。v0.3.1 直接把整个解密结果当 value，导致每条 cookie 都被吃掉了真正 value 的前 32 字节，并附上一段难看的二进制乱码。

### 修复

`cookieExtractor.decryptCookieValue()` 增加一步校验式剥离：解密后如果前 32 字节正好等于 `SHA256(host_key)` 就去掉，否则保留原文（兼容 Chromium < 116 写入的旧 cookie）。

### 实测（Chromium 145 / CloakBrowser）

本机 2 个窗口共 113 条 cookie，10+ 个域：

| 平台 | 状态 |
|---|---|
| reddit.com（含 `reddit_session` 726B JWT + `token_v2` 1309B JWT） | OK |
| google.com / discord.com / yandex.ru | OK |
| whoer.net / criteo / hcaptcha / adnxs / 等 | OK |

**100% 干净明文，零乱码零失败。**

### 新增工具

- `scripts/test-cookie-extract.cjs` — 端到端解密自检脚本，`node scripts/test-cookie-extract.cjs` 直接跑
- `scripts/check-reddit-login.cjs` — Reddit 登录态专项探测脚本（区分 reddit_session/token_v2 等真凭证 vs g_state/eu_cookie 等装饰性 cookie）

### 升级

下载 `TianHu6Jin-0.3.2-Setup.exe` 覆盖安装，进程重启后**再点一次"上传到云端"**即可把正确解密的 cookies 推到服务器。新电脑下载后访问站点应当直接登录态。

### 完整云同步链路验证

```
本地 Chromium DPAPI-encrypted Cookies SQLite
   ↓ Local State.os_crypt.encrypted_key  (DPAPI Unprotect)
   ↓ AES-256-GCM(key, nonce, ciphertext + tag)
   ↓ strip SHA256(host_key) prefix       ← v0.3.2 修复
   ↓ 明文 cookie JSON 数组
   ↓ 写入 profiles.cookies 字段
   ↓ snapshot.json 上传到 /opt/fp-browser-auth/sync-data/<user>/
   ↓ 另一台电脑下载 snapshot
   ↓ profiles.cookies 写回 SQLite
   ↓ 启动浏览器时 BrowserContext.addCookies()
   ↓ 第一个页面请求就带上 reddit_session / token_v2
   ↓ 登录态恢复 ✓
```
