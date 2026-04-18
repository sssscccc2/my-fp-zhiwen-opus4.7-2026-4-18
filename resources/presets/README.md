# 指纹预设模板

7 套真实设备指纹模板，按桌面市场份额加权随机选择：

| ID | 设备 | 市场份额 |
|---|---|---|
| `win10-nvidia-1920` | Windows 10 / NVIDIA RTX 3060 / 1920x1080 | 18% |
| `win11-intel-1920` | Windows 11 / Intel UHD 770 / 1920x1080 | 22% |
| `win11-amd-2560` | Windows 11 / AMD RX 6700 XT / 2560x1440 | 6% |
| `mac-m2-2560` | macOS 14 / Apple M2 / 2560x1664 | 9% |
| `mac-intel-1440` | macOS 13 / Intel Iris Plus / 1440x900 | 3% |
| `win10-nvidia-cn` | Windows 10 / NVIDIA GTX 1660 / 1366x768 (zh-CN) | 12% |
| `linux-mesa-1920` | Linux / Mesa Intel UHD 770 / 1920x1080 | 4% |

源数据见 `electron/main/services/presets.ts`。

如需扩展，请确保以下字段保持自洽：
- `os` / `navigator.platform` / `navigator.userAgent` 三者一致
- `webgl.renderer` 与 `os` 匹配（如 Mac 不能出现 D3D11，Linux 不能出现 ANGLE）
- `screen.pixelRatio`：Mac 视网膜屏通常为 2，Windows/Linux 通常为 1
- `fonts.preset` 应匹配 OS
