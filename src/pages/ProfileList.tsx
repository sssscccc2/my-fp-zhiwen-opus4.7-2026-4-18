import {
  Table, Button, Space, Tag, Dropdown, App as AntApp,
  Tooltip, Radio, Card, Empty, Typography,
} from 'antd';
import {
  PlusOutlined, PlayCircleOutlined, StopOutlined, MoreOutlined, ReloadOutlined,
  AppstoreOutlined, UnorderedListOutlined, FolderOpenOutlined,
} from '@ant-design/icons';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { fireDataChanged, useDataReload } from '../lib/dataBus';
import SyncWidget from '../components/SyncWidget';
import type { Profile, ProfileGroup, ProxyConfig, LaunchedBrowserInfo } from '@shared/types';

type ViewMode = 'table' | 'card';

export default function ProfileList() {
  const navigate = useNavigate();
  const { message, modal } = AntApp.useApp();
  const [searchParams] = useSearchParams();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [groups, setGroups] = useState<ProfileGroup[]>([]);
  const [proxies, setProxies] = useState<ProxyConfig[]>([]);
  const [running, setRunning] = useState<LaunchedBrowserInfo[]>([]);
  const [view, setView] = useState<ViewMode>('table');
  const [busy, setBusy] = useState<Set<string>>(new Set());

  // Filter state read from URL — driven by the sidebar.
  const groupFilter = searchParams.get('group');
  const search = searchParams.get('q') ?? '';

  const reload = useCallback(async () => {
    const [ps, gs, prs, rn] = await Promise.all([
      api.profile.list({ groupId: groupFilter ?? undefined, search }),
      api.group.list(),
      api.proxy.list(),
      api.profile.listRunning(),
    ]);
    setProfiles(ps);
    setGroups(gs);
    setProxies(prs);
    setRunning(rn);
  }, [groupFilter, search]);

  useEffect(() => { void reload(); }, [reload]);
  useDataReload(reload);

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const rn = await api.profile.listRunning();
        setRunning(rn);
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const proxyMap = useMemo(() => Object.fromEntries(proxies.map((p) => [p.id, p])), [proxies]);
  const groupMap = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g])), [groups]);
  const runningSet = useMemo(() => new Set(running.map((r) => r.profileId)), [running]);

  const setBusyFor = (id: string, on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleLaunch = async (p: Profile) => {
    setBusyFor(p.id, true);
    try {
      await api.profile.launch(p.id);
      message.success(`已启动：${p.name}`);
      fireDataChanged();
    } catch (err) {
      message.error('启动失败：' + (err as Error).message);
    } finally {
      setBusyFor(p.id, false);
    }
  };

  const handleClose = async (p: Profile) => {
    setBusyFor(p.id, true);
    try {
      await api.profile.close(p.id);
      message.success(`已关闭：${p.name}`);
      fireDataChanged();
    } catch (err) {
      message.error('关闭失败：' + (err as Error).message);
    } finally {
      setBusyFor(p.id, false);
    }
  };

  const handleDelete = (p: Profile) => {
    modal.confirm({
      title: `确定删除"${p.name}"？`,
      content: '配置文件及其所有 cookies / 缓存数据都将被永久删除。如果云端有备份，下次同步时也会一并移除。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.profile.delete(p.id, true);
          // Best-effort: also tell the server to drop the remote copy so it
          // doesn't keep occupying quota or reappear on next download.
          try {
            const { deleteRemote } = await import('../lib/syncClient');
            await deleteRemote(p.id);
          } catch {
            // user might not be logged in / sync might not be set up — ignore
          }
          message.success('已删除');
          fireDataChanged();
        } catch (err) {
          message.error('删除失败：' + (err as Error).message);
        }
      },
    });
  };

  const handleClone = async (p: Profile) => {
    try {
      await api.profile.clone(p.id);
      message.success('已克隆');
      fireDataChanged();
    } catch (err) {
      message.error('克隆失败：' + (err as Error).message);
    }
  };

  const renderLaunchButton = (p: Profile) => {
    const isRunning = runningSet.has(p.id);
    const isBusy = busy.has(p.id);
    return isRunning ? (
      <Button
        size="small"
        danger
        icon={<StopOutlined />}
        loading={isBusy}
        onClick={() => handleClose(p)}
      >
        关闭
      </Button>
    ) : (
      <Button
        size="small"
        type="primary"
        icon={<PlayCircleOutlined />}
        loading={isBusy}
        onClick={() => handleLaunch(p)}
      >
        打开
      </Button>
    );
  };

  const renderEditMenu = (p: Profile) => (
    <Space size={4}>
      <Button size="small" onClick={() => navigate(`/profiles/${p.id}`)}>编辑</Button>
      <Dropdown
        menu={{
          items: [
            { key: 'clone', label: '克隆', onClick: () => handleClone(p) },
            {
              key: 'openDir', label: '打开数据目录', icon: <FolderOpenOutlined />,
              onClick: () => api.system.openDir(p.userDataDir),
            },
            { type: 'divider' as const },
            { key: 'delete', label: '删除', danger: true, onClick: () => handleDelete(p) },
          ],
        }}
      >
        <Button size="small" icon={<MoreOutlined />} />
      </Dropdown>
    </Space>
  );

  // -------- Format helpers --------
  // Display the proxy's exit IP (preferred) — that's what users care about
  // when scanning the list. Fall back to host:port when not yet tested.
  const formatProxyIp = (pid: string | null | undefined): { text: string; tooltip: string } => {
    if (!pid) return { text: '直连', tooltip: '未绑定代理' };
    const px = proxyMap[pid];
    if (!px) return { text: '-', tooltip: '代理已删除' };
    const text = px.lastTestIp ?? `${px.host}:${px.port}`;
    const country = px.lastTestCountry ? ` · ${px.lastTestCountry}` : '';
    const tooltip = `${px.type}://${px.host}:${px.port}${country}\n名称：${px.name}${px.lastTestIp ? `\n出口IP：${px.lastTestIp}` : ''}`;
    return { text: `${text}${country}`, tooltip };
  };

  const fmtDate = (t?: number | null) => {
    if (!t) return '-';
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const columns = [
    {
      title: '序号',
      width: 64,
      align: 'center' as const,
      render: (_: unknown, _p: Profile, idx: number) => (
        <span style={{ color: '#999', fontVariantNumeric: 'tabular-nums' }}>{idx + 1}</span>
      ),
    },
    {
      title: '分组',
      dataIndex: 'groupId',
      width: 100,
      render: (gid: string | null) =>
        gid && groupMap[gid] ? (
          <Tag color={groupMap[gid].color} style={{ marginRight: 0 }}>{groupMap[gid].name}</Tag>
        ) : <span style={{ color: '#bbb' }}>未分组</span>,
    },
    {
      title: '窗口名称',
      dataIndex: 'name',
      width: 200,
      ellipsis: true,
      render: (_: unknown, p: Profile) => (
        <Space size={6}>
          <a onClick={() => navigate(`/profiles/${p.id}`)}>{p.name}</a>
          {runningSet.has(p.id) && <Tag color="green" style={{ marginRight: 0 }}>运行中</Tag>}
        </Space>
      ),
    },
    {
      title: '备注',
      dataIndex: 'notes',
      // No fixed width — let it stretch to fill remaining space.
      ellipsis: { showTitle: false },
      render: (notes: string) => {
        const text = (notes ?? '').trim();
        if (!text) return <span style={{ color: '#bbb' }}>-</span>;
        return (
          <Tooltip
            title={<div style={{ maxWidth: 360, whiteSpace: 'pre-wrap' }}>{text}</div>}
            placement="topLeft"
          >
            <span style={{ color: '#444' }}>{text}</span>
          </Tooltip>
        );
      },
    },
    {
      title: '最后打开',
      dataIndex: 'lastOpenedAt',
      width: 140,
      render: (t?: number | null) => (
        <span style={{ color: '#888', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
          {t ? fmtDate(t) : <span style={{ color: '#bbb' }}>从未打开</span>}
        </span>
      ),
      sorter: (a: Profile, b: Profile) => (a.lastOpenedAt ?? 0) - (b.lastOpenedAt ?? 0),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 140,
      render: (t: number) => (
        <span style={{ color: '#888', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmtDate(t)}</span>
      ),
      sorter: (a: Profile, b: Profile) => a.createdAt - b.createdAt,
      defaultSortOrder: 'descend' as const,
    },
    {
      title: '配置',
      width: 100,
      align: 'center' as const,
      fixed: 'right' as const,
      render: (_: unknown, p: Profile) => renderEditMenu(p),
    },
    {
      title: '打开',
      width: 90,
      align: 'center' as const,
      fixed: 'right' as const,
      render: (_: unknown, p: Profile) => renderLaunchButton(p),
    },
  ];

  // Build header label that reflects active filter
  const activeGroupName = groupFilter ? groupMap[groupFilter]?.name : null;
  const headerTitle = activeGroupName ?? '全部配置';

  return (
    <>
      <div className="page-header">
        <h2>
          {headerTitle}
          {search && (
            <Tag color="blue" style={{ marginLeft: 12, fontSize: 13 }}>搜索：{search}</Tag>
          )}
          <Typography.Text type="secondary" style={{ fontSize: 14, marginLeft: 12 }}>
            共 {profiles.length} 个 · 运行中 {running.length}
          </Typography.Text>
        </h2>
        <Space>
          <SyncWidget />
          <Radio.Group value={view} onChange={(e) => setView(e.target.value)} optionType="button" size="middle">
            <Radio.Button value="table"><UnorderedListOutlined /></Radio.Button>
            <Radio.Button value="card"><AppstoreOutlined /></Radio.Button>
          </Radio.Group>
          <Tooltip title="刷新">
            <Button icon={<ReloadOutlined />} onClick={reload} />
          </Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/profiles/new')}>
            新建配置
          </Button>
        </Space>
      </div>

      <div className="page-content">
        {view === 'table' ? (
          <Table
            rowKey="id"
            dataSource={profiles}
            columns={columns}
            size="small"
            pagination={{ pageSize: 20, showSizeChanger: true }}
            scroll={{ x: 980 }}
            locale={{ emptyText: <Empty description="暂无配置，点击右上角创建" /> }}
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
            {profiles.map((p) => (
              <Card
                key={p.id}
                size="small"
                className={runningSet.has(p.id) ? 'profile-card-running' : ''}
                title={
                  <Space>
                    {p.name}
                    {runningSet.has(p.id) && <Tag color="green">运行中</Tag>}
                  </Space>
                }
                extra={
                  <Dropdown
                    menu={{
                      items: [
                        { key: 'edit', label: '编辑', onClick: () => navigate(`/profiles/${p.id}`) },
                        { key: 'clone', label: '克隆', onClick: () => handleClone(p) },
                        {
                          key: 'openDir', label: '打开数据目录', icon: <FolderOpenOutlined />,
                          onClick: () => api.system.openDir(p.userDataDir),
                        },
                        { type: 'divider' as const },
                        { key: 'delete', label: '删除', danger: true, onClick: () => handleDelete(p) },
                      ],
                    }}
                  >
                    <Button size="small" type="text" icon={<MoreOutlined />} />
                  </Dropdown>
                }
              >
                <div style={{ fontSize: 12, color: '#666', lineHeight: 2 }}>
                  <div>系统：<Tag>{p.fingerprint.os}</Tag></div>
                  <div>分辨率：{p.fingerprint.screen.width}x{p.fingerprint.screen.height}</div>
                  <div>时区：{p.fingerprint.timezone}</div>
                  <div>代理 IP：{formatProxyIp(p.proxyId).text}</div>
                  <div>种子：{p.fingerprint.seed}</div>
                  {p.notes && <div style={{ marginTop: 4, color: '#444' }}>备注：{p.notes}</div>}
                </div>
                <div style={{ marginTop: 12 }}>
                  <Space size="small">{renderEditMenu(p)}{renderLaunchButton(p)}</Space>
                </div>
              </Card>
            ))}
            {profiles.length === 0 && <Empty description="暂无配置" style={{ gridColumn: '1 / -1', padding: 40 }} />}
          </div>
        )}
      </div>
    </>
  );
}
