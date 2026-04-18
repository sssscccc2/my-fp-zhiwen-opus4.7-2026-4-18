import { Card, Descriptions, Alert, Space, Typography, Button, Tag, App as AntApp, Modal } from 'antd';
import { DownloadOutlined, CheckCircleFilled, ExclamationCircleFilled, FolderOpenOutlined, ImportOutlined, CopyOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface AppInfo {
  version: string;
  userDataPath: string;
  cloak: { ok: boolean; error?: string };
  chromiumKernel: string;
  binaryCacheDir: string;
  binaryInstalled: boolean;
}

interface BinaryStatus {
  installed: boolean;
  version?: string;
  binaryPath?: string;
  cacheDir: string;
  downloadUrl?: string;
  source?: 'override' | 'extracted' | 'cache';
}

const SOURCE_LABEL: Record<NonNullable<BinaryStatus['source']>, { color: string; text: string }> = {
  extracted: { color: 'green', text: '已解压（resources/）' },
  override:  { color: 'blue',  text: '环境变量指定' },
  cache:     { color: 'cyan',  text: 'App 缓存目录' },
};

export default function About() {
  const { message } = AntApp.useApp();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [binStatus, setBinStatus] = useState<BinaryStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const offRef = useRef<(() => void) | null>(null);

  const reload = async () => {
    try {
      const [i, s] = await Promise.all([api.system.appInfo(), api.binary.status()]);
      setInfo(i);
      setBinStatus(s);
    } catch (err) {
      message.error('加载失败：' + (err as Error).message);
    }
  };

  useEffect(() => {
    void reload();
    offRef.current = api.binary.onProgress((line) => {
      setProgressLines((prev) => [...prev.slice(-50), line]);
    });
    return () => { offRef.current?.(); };
  }, []);

  const handleDownload = async () => {
    setDownloading(true);
    setProgressLines([`[${new Date().toLocaleTimeString()}] 启动下载（约 527MB，国内网络可能很慢，建议改用「从本地 zip 导入」）…`]);
    try {
      const r = await api.binary.download();
      if (r.ok) {
        message.success(`CloakBrowser 二进制已就绪：v${r.version ?? '?'}`);
      } else {
        message.error('下载失败：' + r.error);
      }
      void reload();
    } catch (err) {
      message.error('下载失败：' + (err as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  const handleImport = async () => {
    try {
      const zipPath = await api.binary.pickZip();
      if (!zipPath) return;
      setDownloading(true);
      setProgressLines([`[${new Date().toLocaleTimeString()}] 从 ${zipPath} 导入…`]);
      const r = await api.binary.importZip(zipPath);
      if (r.ok) {
        message.success(`导入成功：Chromium ${r.version}`);
      } else {
        message.error('导入失败：' + r.error);
      }
      void reload();
    } catch (err) {
      message.error('导入失败：' + (err as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  const showDownloadGuide = () => {
    const downloadUrl = 'https://github.com/CloakHQ/cloakbrowser/releases/download/chromium-v145.0.7632.159.7/cloakbrowser-windows-x64.zip';
    Modal.info({
      title: '手动下载 CloakBrowser 内核（推荐）',
      width: 720,
      content: (
        <div>
          <Typography.Paragraph>
            完整 zip 约 <b>527 MB</b>。CloakBrowser 官方 CDN 与 GitHub Releases 在国内
            通常单线程仅 50-150 KB/s（需 60-120 分钟），强烈建议用迅雷 / IDM /
            Free Download Manager 等多线程下载器：
          </Typography.Paragraph>

          <Typography.Title level={5}>下载地址（任选一）</Typography.Title>
          <Typography.Paragraph>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Typography.Text strong>① GitHub Releases（推荐多线程下载器）</Typography.Text>
              <Typography.Text code copyable={{ text: downloadUrl }}>
                {downloadUrl}
              </Typography.Text>
              <Typography.Text strong style={{ marginTop: 8 }}>② 官方 CDN（部分地区可能更快）</Typography.Text>
              <Typography.Text code copyable={{
                text: 'https://cloakbrowser.dev/chromium-v145.0.7632.159.7/cloakbrowser-windows-x64.zip',
              }}>
                https://cloakbrowser.dev/chromium-v145.0.7632.159.7/cloakbrowser-windows-x64.zip
              </Typography.Text>
            </Space>
          </Typography.Paragraph>

          <Typography.Title level={5}>下载完成后</Typography.Title>
          <Typography.Paragraph>
            点击下方<Tag color="blue">从本地 zip 导入</Tag>按钮，选择刚下载的
            <Typography.Text code>cloakbrowser-windows-x64.zip</Typography.Text>
            文件，App 会自动解压到正确位置。
          </Typography.Paragraph>

          <Alert type="info" showIcon message="也可以双击运行 bin/install-from-zip.ps1 完成相同操作（不需要打开 App）" />
        </div>
      ),
    });
  };

  return (
    <>
      <div className="page-header">
        <h2>关于 / 内核管理</h2>
        <Button onClick={reload}>刷新</Button>
      </div>
      <div className="page-content">
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Card
            title="CloakBrowser 内核状态"
            extra={
              binStatus?.installed ? (
                <Tag color="success" icon={<CheckCircleFilled />}>已安装</Tag>
              ) : (
                <Tag color="warning" icon={<ExclamationCircleFilled />}>未安装</Tag>
              )
            }
          >
            {binStatus && (
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="版本">
                  {binStatus.version ? `Chromium ${binStatus.version}` : '未知'}
                </Descriptions.Item>
                <Descriptions.Item label="数据源">
                  {binStatus.source ? (
                    <Tag color={SOURCE_LABEL[binStatus.source].color}>
                      {SOURCE_LABEL[binStatus.source].text}
                    </Tag>
                  ) : <Tag>未安装</Tag>}
                </Descriptions.Item>
                <Descriptions.Item label="二进制位置">
                  {binStatus.binaryPath ? (
                    <Typography.Text code copyable>{binStatus.binaryPath}</Typography.Text>
                  ) : '尚未下载'}
                </Descriptions.Item>
                <Descriptions.Item label="缓存目录">
                  <Space>
                    <Typography.Text code copyable>{binStatus.cacheDir}</Typography.Text>
                    <Button size="small" icon={<FolderOpenOutlined />}
                      onClick={() => api.system.openDir(binStatus.cacheDir)}>打开</Button>
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label="下载源">
                  <Typography.Text code>{binStatus.downloadUrl ?? 'cloakbrowser.dev'}</Typography.Text>
                </Descriptions.Item>
              </Descriptions>
            )}

            <div style={{ marginTop: 16 }}>
              <Space wrap>
                <Button
                  icon={<DownloadOutlined />}
                  loading={downloading}
                  onClick={handleDownload}
                >
                  {binStatus?.installed ? '重新下载 / 更新（App 内）' : 'App 内直接下载（~527MB，国内慢）'}
                </Button>
                <Button
                  type="primary"
                  icon={<ImportOutlined />}
                  loading={downloading}
                  onClick={handleImport}
                >
                  从本地 zip 导入（推荐）
                </Button>
                <Button icon={<CopyOutlined />} onClick={showDownloadGuide}>
                  查看下载地址 / 详细说明
                </Button>
              </Space>
              {!binStatus?.installed && (
                <div style={{ marginTop: 12 }}>
                  <Alert
                    type="warning"
                    showIcon
                    message="必须先安装内核才能启动 profile"
                    description={
                      <span>
                        建议方式：点击 <b>查看下载地址</b> 复制链接 → 用迅雷/IDM 下载完整 527MB
                        zip → 点击 <b>从本地 zip 导入</b>。15-30 分钟即可完成（多线程下载）。
                      </span>
                    }
                  />
                </div>
              )}
            </div>

            {progressLines.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Typography.Title level={5}>下载日志</Typography.Title>
                <pre style={{
                  background: '#1f1f1f', color: '#d4d4d4', padding: 12, borderRadius: 4,
                  fontSize: 12, maxHeight: 200, overflow: 'auto', marginTop: 8,
                }}>
                  {progressLines.join('\n')}
                </pre>
              </div>
            )}
          </Card>

          <Card title="应用信息">
            {info && (
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="版本">{info.version}</Descriptions.Item>
                <Descriptions.Item label="数据目录">
                  <Space>
                    <Typography.Text code copyable>{info.userDataPath}</Typography.Text>
                    <Button size="small" icon={<FolderOpenOutlined />}
                      onClick={() => api.system.openDir(info.userDataPath)}>打开</Button>
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label="加载状态">
                  {info.cloak.ok ? (
                    <Typography.Text type="success">cloakbrowser 模块就绪</Typography.Text>
                  ) : (
                    <Typography.Text type="danger">未加载: {info.cloak.error}</Typography.Text>
                  )}
                </Descriptions.Item>
              </Descriptions>
            )}
          </Card>

          <Alert
            type="info"
            showIcon
            message="2026 反检测增强已启用"
            description={
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>C++ 源码级指纹补丁（Canvas / WebGL / Audio / 字体 / TLS-JA3 / HTTP/2）</li>
                <li><code>--disable-blink-features=AutomationControlled</code> 关闭 webdriver 标识</li>
                <li>Sec-CH-UA / Sec-CH-UA-Platform / Sec-CH-UA-Mobile Client Hints 自动一致</li>
                <li>Mouse / Keyboard 人类化（贝塞尔曲线 + 节奏抖动）</li>
                <li>WebRTC 默认禁用 + <code>force-webrtc-ip-handling-policy</code></li>
                <li>locale / timezone 走二进制层（<b>不</b>使用可被检测的 CDP 仿真）</li>
                <li>每个 profile 独立 seed（保证回访时指纹零漂移，对抗 ML 检测器）</li>
              </ul>
            }
          />

          <Alert
            type="warning"
            showIcon
            message="使用免责声明"
            description="本工具仅限合法用途：隐私保护、自动化测试、广告验证、反爬研究、多账户合规管理。使用者须遵守目标平台的服务条款及当地法律法规。严禁用于欺诈、刷单、绕过版权保护、攻击他人系统等违法行为。"
          />
        </Space>
      </div>
    </>
  );
}
