# =============================================================================
#  CloakBrowser 离线安装脚本
# =============================================================================
#  用法 1（推荐）：把下载好的 cloakbrowser-windows-x64.zip 拖到本脚本图标上
#  用法 2：右键此脚本 → "用 PowerShell 运行"，按提示选择 zip 文件
#  用法 3：powershell -ExecutionPolicy Bypass -File install-from-zip.ps1 <zip路径>
# =============================================================================

param(
    [Parameter(Position=0)]
    [string]$ZipPath
)

$ErrorActionPreference = 'Stop'

# 当前 cloakbrowser 在 Windows 上使用的 Chromium 版本（请勿随意修改）
$ChromiumVersion = '145.0.7632.159.7'
$ExpectedZipName = 'cloakbrowser-windows-x64.zip'

# 项目根 = 本脚本所在目录的上一级
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ProjectRoot) { $ProjectRoot = (Get-Location).Path }
$CacheDir    = Join-Path $ProjectRoot 'bin\cloakbrowser'
$BinaryDir   = Join-Path $CacheDir   "chromium-$ChromiumVersion"
$BinaryPath  = Join-Path $BinaryDir  'chrome.exe'

Write-Host ''
Write-Host '=========================================================' -ForegroundColor Cyan
Write-Host ' CloakBrowser 离线安装' -ForegroundColor Cyan
Write-Host '=========================================================' -ForegroundColor Cyan
Write-Host "  Chromium 版本 : $ChromiumVersion"
Write-Host "  缓存目录      : $CacheDir"
Write-Host "  目标二进制    : $BinaryPath"
Write-Host ''

# --- 已经安装则直接退出 ---------------------------------------------------
if (Test-Path $BinaryPath) {
    $size = (Get-Item $BinaryPath).Length
    Write-Host "[OK] 已安装：$BinaryPath ($([math]::Round($size/1MB,2)) MB)" -ForegroundColor Green
    Read-Host 'Press Enter to exit'
    exit 0
}

# --- 选择 zip 文件 -------------------------------------------------------
if (-not $ZipPath -or -not (Test-Path $ZipPath)) {
    Write-Host '请输入 cloakbrowser-windows-x64.zip 的完整路径:' -ForegroundColor Yellow
    Write-Host '（可以直接把 zip 文件拖到本窗口然后回车）' -ForegroundColor DarkGray
    $ZipPath = (Read-Host '路径').Trim('"').Trim()
}

if (-not (Test-Path $ZipPath)) {
    Write-Host "[ERROR] 找不到文件: $ZipPath" -ForegroundColor Red
    Read-Host 'Press Enter to exit'
    exit 1
}

$zipFile = Get-Item $ZipPath
Write-Host ""
Write-Host "源文件: $($zipFile.FullName)" -ForegroundColor White
Write-Host "大小  : $([math]::Round($zipFile.Length/1MB,2)) MB"

if ($zipFile.Name -ne $ExpectedZipName) {
    Write-Host "[WARN] 文件名 $($zipFile.Name) 与预期 $ExpectedZipName 不同，仍继续。" -ForegroundColor Yellow
}

if ($zipFile.Length -lt 100MB) {
    Write-Host "[WARN] 文件大小 $([math]::Round($zipFile.Length/1MB,2)) MB 小于 100MB，可能不完整。" -ForegroundColor Yellow
    $ans = Read-Host '仍要继续吗？(y/N)'
    if ($ans -ne 'y' -and $ans -ne 'Y') { exit 1 }
}

# --- 准备目录 -----------------------------------------------------------
if (Test-Path $BinaryDir) {
    Write-Host '[..] 清理旧的不完整目录...' -ForegroundColor DarkGray
    Remove-Item -Recurse -Force $BinaryDir
}
New-Item -ItemType Directory -Path $BinaryDir | Out-Null

# --- 解压 -------------------------------------------------------------
Write-Host ''
Write-Host '[..] 正在解压（约 1-3 分钟）...' -ForegroundColor Yellow
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zipFile.FullName, $BinaryDir)
} catch {
    Write-Host "[ERROR] 解压失败: $_" -ForegroundColor Red
    Read-Host 'Press Enter to exit'
    exit 1
}
$sw.Stop()
Write-Host "[OK] 解压完成 ($($sw.Elapsed.TotalSeconds.ToString('0.0')) 秒)" -ForegroundColor Green

# --- 扁平化（如果 zip 有外层包装目录） ----------------------------------
$entries = Get-ChildItem -LiteralPath $BinaryDir
if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) {
    Write-Host '[..] 检测到外层目录，正在扁平化...' -ForegroundColor DarkGray
    $sub = $entries[0].FullName
    Get-ChildItem -LiteralPath $sub -Force | ForEach-Object {
        Move-Item -LiteralPath $_.FullName -Destination $BinaryDir
    }
    Remove-Item -LiteralPath $sub -Recurse -Force
}

# --- 验证 -------------------------------------------------------------
if (-not (Test-Path $BinaryPath)) {
    Write-Host ''
    Write-Host "[ERROR] 解压后未找到 chrome.exe，请检查 zip 内容" -ForegroundColor Red
    Write-Host '解压后的目录结构：' -ForegroundColor DarkGray
    Get-ChildItem $BinaryDir | Select-Object Name, Mode | Format-Table -AutoSize
    Read-Host 'Press Enter to exit'
    exit 1
}

$binSize = (Get-Item $BinaryPath).Length
Write-Host ''
Write-Host '=========================================================' -ForegroundColor Green
Write-Host '  安装成功！' -ForegroundColor Green
Write-Host '=========================================================' -ForegroundColor Green
Write-Host "  Chromium 二进制: $BinaryPath"
Write-Host "  大小            : $([math]::Round($binSize/1MB,2)) MB"
Write-Host ''
Write-Host '现在可以启动 App: npm run dev' -ForegroundColor Cyan
Write-Host ''
Read-Host 'Press Enter to exit'
