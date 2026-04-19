## v0.3.0 — 整账号云同步（多端账号同步）

新增「**整账号云同步**」— 在另一台电脑安装本程序、用同一账号登录，一键把所有窗口（含 cookies / 扩展 / 本地存储）拉过去，无需手动复制目录。

### 新功能

- **主页右上角"云同步"按钮** — 5 种状态自动识别：已同步 / 需上传 / 云端更新 / 存在冲突 / 尚未同步
- **手动上传 / 下载** — 不静默后台同步，由用户决定
- **增量传输** — SHA-256 内容寻址，第二次同步只传变化的文件，跨用户去重
- **覆盖式冲突** — 多端冲突时弹窗警告（覆盖云端 / 覆盖本地），由用户选择哪边为准
- **删除联动** — 客户端删窗口自动通知服务器清理 manifest + GC 引用计数为 0 的 blob
- **进度可视化** — 扫描 / 上传 / 下载实时进度条 + 当前文件名
- **配额限制** — 每用户 500 MB / 单文件 50 MB

### 管理后台增强（http://<server>:3000/admin）

- 新增「**窗口管理**」Tab — 看到所有用户已上传的窗口
- 一键 **转移窗口** 给其他用户（manifest 移动 + 引用 blob 复制 + 源端 GC，操作幂等）

### 安装

下载下面的 `TianHu6Jin-0.3.0-Setup.exe` 双击安装即可。无需管理员权限（per-user NSIS）。

### 跨电脑迁移流程

1. 旧电脑：登录 → 主页 → 云同步 → 上传到云端
2. 新电脑：安装本程序 → 用**相同账号**登录 → 云同步 → 从云端下载
3. 完成 — 所有窗口（含登录状态）都搬过来了

### 技术细节

- 服务端 `/api/sync/*` REST API + `snapshot.json` + 内容寻址 `blobs/<sha256>`
- 客户端同步白名单：Cookies / Local Storage / IndexedDB / Extensions / Preferences / Bookmarks / Login Data
- 黑名单：GPU Cache / Code Cache / Service Worker（一切磁盘缓存）
- 不影响指纹反检测：纯应用层数据搬运，与 Chromium 内核 / Cookies 注入完全正交

完整说明见 [README](https://github.com/sssscccc2/my-fp-zhiwen-opus4.7-2026-4-18/blob/main/README.md)。
