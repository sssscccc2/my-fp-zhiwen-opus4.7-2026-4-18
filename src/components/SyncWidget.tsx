import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button, Tooltip, Dropdown, Modal, Progress, App as AntApp, Typography, Tag,
} from 'antd';
import {
  CloudSyncOutlined, CloudUploadOutlined, CloudDownloadOutlined,
  ReloadOutlined, WarningOutlined,
} from '@ant-design/icons';
import {
  fetchStatus, uploadAll, downloadAll, onProgress,
  describeDirection, fmtBytes, fmtTime,
} from '../lib/syncClient';
import { fireDataChanged } from '../lib/dataBus';
import { getStoredToken } from '../lib/authClient';
import type { SyncStatus, SyncProgress } from '@shared/syncTypes';

/**
 * Top-right sync button. Auto-refreshes status on mount and after every
 * successful upload/download. Click → dropdown shows last sync time + quota,
 * with explicit "Upload now" / "Download from cloud" actions.
 *
 * "Latest wins": if the user picks Upload while remote is newer (or vice
 * versa), we surface a Modal explaining what's about to be overwritten.
 */
export default function SyncWidget() {
  const { modal, message } = AntApp.useApp();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'upload' | 'download' | null>(null);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [progressOpen, setProgressOpen] = useState(false);
  const lastFetch = useRef(0);

  const refresh = useCallback(async (force = false) => {
    if (!getStoredToken()) {
      setStatus(null);
      return;
    }
    if (!force && Date.now() - lastFetch.current < 3000) return;  // throttle
    lastFetch.current = Date.now();
    setLoading(true);
    try {
      const s = await fetchStatus();
      setStatus(s);
    } catch (err) {
      console.warn('[sync] status fetch failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    // Re-check periodically — the heartbeat in authContext handles tokens,
    // but sync state can move asynchronously (e.g. another device uploaded).
    const t = setInterval(() => void refresh(false), 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    return onProgress((p) => setProgress(p));
  }, []);

  const runUpload = useCallback(async () => {
    setBusy('upload');
    setProgress({ phase: 'scan', current: 0, total: 0, message: '准备同步...' });
    setProgressOpen(true);
    try {
      const r = await uploadAll();
      if (!r.ok) {
        message.error('上传失败：' + r.error);
      } else {
        message.success(`已上传 ${r.uploadedFiles ?? 0} 个文件 · ${fmtBytes(r.bytes ?? 0)}`);
        void refresh(true);
      }
    } catch (err) {
      message.error('上传失败：' + (err as Error).message);
    } finally {
      setBusy(null);
      setProgressOpen(false);
      setProgress(null);
    }
  }, [message, refresh]);

  const runDownload = useCallback(async () => {
    setBusy('download');
    setProgress({ phase: 'download-meta', current: 0, total: 0, message: '准备下载...' });
    setProgressOpen(true);
    try {
      const r = await downloadAll();
      if (!r.ok) {
        message.error('下载失败：' + r.error);
      } else {
        message.success(`已下载 ${r.downloadedFiles ?? 0} 个文件 · ${fmtBytes(r.bytes ?? 0)}`);
        fireDataChanged();    // refresh sidebar/profile list with new data
        void refresh(true);
      }
    } catch (err) {
      message.error('下载失败：' + (err as Error).message);
    } finally {
      setBusy(null);
      setProgressOpen(false);
      setProgress(null);
    }
  }, [message, refresh]);

  const confirmUpload = useCallback(() => {
    if (!status) return;
    if (status.direction === 'remote-newer' || status.direction === 'conflict') {
      modal.confirm({
        title: '云端有更新的数据',
        icon: <WarningOutlined style={{ color: '#f59e0b' }} />,
        content: (
          <div>
            <p>云端最近上传时间：<strong>{fmtTime(status.remoteUploadedAt)}</strong></p>
            <p>云端窗口数：<strong>{status.remoteProfiles}</strong> · 本地：<strong>{status.localProfiles}</strong></p>
            <p style={{ color: '#ef4444' }}>
              继续上传将以本地为准，<strong>覆盖云端</strong>的数据。如果云端的更改是从其他电脑同步来的，建议先点"从云端下载"。
            </p>
          </div>
        ),
        okText: '仍然上传（覆盖云端）',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: runUpload,
      });
    } else {
      void runUpload();
    }
  }, [status, modal, runUpload]);

  const confirmDownload = useCallback(() => {
    if (!status) return;
    if (status.direction === 'local-newer' || status.direction === 'conflict' || status.localProfiles > 0) {
      modal.confirm({
        title: '从云端下载会覆盖本地数据',
        icon: <WarningOutlined style={{ color: '#f59e0b' }} />,
        content: (
          <div>
            <p>本地窗口数：<strong>{status.localProfiles}</strong> · 云端：<strong>{status.remoteProfiles}</strong></p>
            <p style={{ color: '#ef4444' }}>
              下载会用云端数据替换本地的窗口列表、cookies、扩展等。本地的最新更改如果还没上传，会丢失。
            </p>
          </div>
        ),
        okText: '继续下载（覆盖本地）',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: runDownload,
      });
    } else {
      void runDownload();
    }
  }, [status, modal, runDownload]);

  if (!getStoredToken()) return null;   // hide until logged in

  const direction = status?.direction ?? 'in-sync';
  const desc = describeDirection(direction);
  const hasAlert = direction === 'conflict' || direction === 'remote-newer';

  const dropdownItems = [
    {
      key: 'header',
      label: (
        <div style={{ padding: '4px 8px', minWidth: 280 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Tag color={desc.color === '#22c55e' ? 'green' : desc.color === '#ef4444' ? 'red' : desc.color === '#f59e0b' ? 'orange' : 'blue'}>
              {desc.label}
            </Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{desc.hint}</Typography.Text>
          </div>
          <div style={{ fontSize: 12, color: '#666', lineHeight: 1.8 }}>
            <div>本地窗口：<strong>{status?.localProfiles ?? '-'}</strong> · 云端：<strong>{status?.remoteProfiles ?? '-'}</strong></div>
            <div>云端上次上传：{fmtTime(status?.remoteUploadedAt ?? 0)}</div>
            <div>本地上次拉取：{fmtTime(status?.lastPulledAt ?? 0)}</div>
            {status?.quota && (
              <div style={{ marginTop: 6 }}>
                <div style={{ color: '#888' }}>
                  云端占用 {fmtBytes(status.quota.used)} / {fmtBytes(status.quota.limit)} ({status.quota.blobs} 个文件块)
                </div>
                <Progress
                  percent={Math.min(100, (status.quota.used / status.quota.limit) * 100)}
                  size="small"
                  showInfo={false}
                  strokeColor={status.quota.used / status.quota.limit > 0.9 ? '#ef4444' : '#7c5cff'}
                />
              </div>
            )}
          </div>
        </div>
      ),
      type: 'group' as const,
    },
    { type: 'divider' as const },
    {
      key: 'upload',
      icon: <CloudUploadOutlined />,
      label: '上传到云端（备份）',
      onClick: confirmUpload,
      disabled: !!busy,
    },
    {
      key: 'download',
      icon: <CloudDownloadOutlined />,
      label: '从云端下载（恢复）',
      onClick: confirmDownload,
      disabled: !!busy || (status?.remoteProfiles ?? 0) === 0,
    },
    { type: 'divider' as const },
    {
      key: 'refresh',
      icon: <ReloadOutlined />,
      label: '刷新状态',
      onClick: () => void refresh(true),
      disabled: loading,
    },
  ];

  const phaseLabel = (p: SyncProgress) => {
    switch (p.phase) {
      case 'scan': return '扫描本地文件';
      case 'upload-meta': return '提交清单';
      case 'upload-files': return '上传文件';
      case 'download-meta': return '获取清单';
      case 'download-files': return '下载文件';
      case 'apply': return '应用变更';
      case 'done': return '完成';
    }
  };

  return (
    <>
      <Dropdown menu={{ items: dropdownItems }} trigger={['click']} placement="bottomRight">
        <Tooltip title={`云同步：${desc.label}`}>
          <Button
            icon={<CloudSyncOutlined style={{ color: hasAlert ? desc.color : undefined }} />}
            loading={!!busy || loading}
          >
            <span style={{ color: hasAlert ? desc.color : undefined }}>
              云同步{hasAlert ? `（${desc.label}）` : ''}
            </span>
            {direction !== 'in-sync' && !busy && !loading && (
              <span
                style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                  background: desc.color, marginLeft: 6, verticalAlign: 'middle',
                }}
              />
            )}
          </Button>
        </Tooltip>
      </Dropdown>

      <Modal
        title={busy === 'upload' ? '正在上传到云端' : '正在从云端下载'}
        open={progressOpen}
        footer={null}
        closable={false}
        maskClosable={false}
        width={520}
      >
        {progress && (
          <div>
            <div style={{ marginBottom: 12, fontSize: 13 }}>
              <strong>{phaseLabel(progress)}</strong>
              {progress.message && <span style={{ color: '#666', marginLeft: 8 }}>{progress.message}</span>}
            </div>
            {progress.currentFile && (
              <div
                style={{
                  fontSize: 11, color: '#999', fontFamily: 'monospace',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  marginBottom: 8,
                }}
              >
                {progress.currentFile}
              </div>
            )}
            <Progress
              percent={progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}
              status="active"
              showInfo={progress.total > 0}
            />
            {progress.bytesTransferred !== undefined && progress.bytesTransferred > 0 && (
              <div style={{ fontSize: 12, color: '#888', marginTop: 8, textAlign: 'right' }}>
                已传输：{fmtBytes(progress.bytesTransferred)}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
