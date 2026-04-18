import { Input, Button, Dropdown, ColorPicker, App as AntApp, Tooltip, Spin } from 'antd';
import {
  AppstoreOutlined,
  ExperimentOutlined,
  InfoCircleOutlined,
  SearchOutlined,
  PlusOutlined,
  EllipsisOutlined,
  LogoutOutlined,
  CrownOutlined,
} from '@ant-design/icons';
import {
  Routes, Route, Navigate, useLocation, useNavigate, useSearchParams,
} from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ProfileList from './pages/ProfileList';
import ProfileEditor from './pages/ProfileEditor';
import FingerprintTest from './pages/FingerprintTest';
import About from './pages/About';
import LoginPage from './pages/LoginPage';
import { api } from './api';
import type { Profile, ProfileGroup } from '@shared/types';
import { fireDataChanged, useDataReload } from './lib/dataBus';
import { useAuth } from './lib/authContext';

const PRESET_COLORS = [
  '#7c5cff', '#1677ff', '#13c2c2', '#52c41a', '#faad14',
  '#fa541c', '#eb2f96', '#722ed1', '#2f54eb', '#a0d911',
];

export default function App() {
  const { state: authState, logout } = useAuth();
  const { modal: authModal } = AntApp.useApp();

  // ------- Auth gate (must come BEFORE any data fetch) -------
  if (authState.status === 'loading') {
    return (
      <div style={{
        height: '100vh', width: '100vw', display: 'flex',
        alignItems: 'center', justifyContent: 'center', background: '#0a0c14',
      }}>
        <Spin size="large" tip="正在校验登录状态..." />
      </div>
    );
  }
  if (authState.status === 'unauthenticated') {
    return <LoginPage />;
  }

  return <AuthedShell user={authState.user} offline={authState.offline} onLogout={(reason) => {
    if (reason) {
      authModal.warning({
        title: '已退出登录',
        content: reason,
        okText: '去登录',
        onOk: () => logout(reason),
      });
    } else {
      logout();
    }
  }} />;
}

interface AuthedShellProps {
  user: { username: string; role: string };
  offline: boolean;
  onLogout: (reason?: string) => void;
}

function AuthedShell({ user, offline, onLogout }: AuthedShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { modal, message } = AntApp.useApp();

  // ----- Data state owned by the shell so the sidebar can show counts -----
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [groups, setGroups] = useState<ProfileGroup[]>([]);
  const [version, setVersion] = useState('');

  const reload = useCallback(async () => {
    try {
      const [ps, gs] = await Promise.all([
        api.profile.list({}),
        api.group.list(),
      ]);
      setProfiles(ps);
      setGroups(gs);
    } catch (err) {
      console.warn('sidebar reload failed', err);
    }
  }, []);

  useEffect(() => {
    void reload();
    api.system.appInfo().then((info) => setVersion(info.version)).catch(() => {});
  }, [reload]);

  useDataReload(reload);

  // ----- Filter state lives in URL so deep-links + back-button work -----
  const currentGroup = searchParams.get('group');     // null = "all"
  const currentSearch = searchParams.get('q') ?? '';
  const setGroup = useCallback((gid: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (gid) next.set('group', gid); else next.delete('group');
    setSearchParams(next, { replace: true });
    if (!location.pathname.startsWith('/profiles') || location.pathname.includes('/new') || /\/profiles\/[^/]+$/.test(location.pathname)) {
      navigate({ pathname: '/profiles', search: next.toString() });
    }
  }, [searchParams, setSearchParams, location.pathname, navigate]);
  const setSearch = useCallback((q: string) => {
    const next = new URLSearchParams(searchParams);
    if (q) next.set('q', q); else next.delete('q');
    setSearchParams(next, { replace: true });
    if (!location.pathname.startsWith('/profiles') || /\/profiles\/[^/]+$/.test(location.pathname)) {
      navigate({ pathname: '/profiles', search: next.toString() });
    }
  }, [searchParams, setSearchParams, location.pathname, navigate]);

  // ----- Counts per group, computed from the in-memory profile list -----
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of profiles) {
      const gid = p.groupId ?? '__none__';
      map[gid] = (map[gid] ?? 0) + 1;
    }
    return map;
  }, [profiles]);
  const totalCount = profiles.length;

  // ----- Group CRUD -----
  const handleAddGroup = () => {
    let name = '';
    let color = PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];
    modal.confirm({
      title: '新建分组',
      content: (
        <div style={{ paddingTop: 12 }}>
          <Input
            autoFocus
            placeholder="分组名称（如 3.28 / FB广告号）"
            onChange={(e) => { name = e.target.value; }}
            style={{ marginBottom: 12 }}
            onPressEnter={(e) => {
              const target = e.currentTarget as HTMLInputElement;
              name = target.value;
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>颜色：</span>
            <ColorPicker
              defaultValue={color}
              onChange={(c) => { color = c.toHexString(); }}
              presets={[{ label: '推荐', colors: PRESET_COLORS }]}
            />
          </div>
        </div>
      ),
      okText: '创建',
      cancelText: '取消',
      onOk: async () => {
        const trimmed = name.trim();
        if (!trimmed) {
          message.warning('请输入分组名称');
          return Promise.reject();
        }
        try {
          await api.group.create(trimmed, color);
          fireDataChanged();
          message.success('已创建分组');
        } catch (err) {
          message.error('创建失败：' + (err as Error).message);
          return Promise.reject();
        }
      },
    });
  };

  const handleRenameGroup = (g: ProfileGroup) => {
    let name = g.name;
    let color = g.color;
    modal.confirm({
      title: '编辑分组',
      content: (
        <div style={{ paddingTop: 12 }}>
          <Input
            autoFocus
            defaultValue={g.name}
            onChange={(e) => { name = e.target.value; }}
            style={{ marginBottom: 12 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>颜色：</span>
            <ColorPicker
              defaultValue={g.color}
              onChange={(c) => { color = c.toHexString(); }}
              presets={[{ label: '推荐', colors: PRESET_COLORS }]}
            />
          </div>
        </div>
      ),
      okText: '保存',
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.group.update(g.id, name.trim() || g.name, color);
          fireDataChanged();
        } catch (err) {
          message.error('保存失败：' + (err as Error).message);
        }
      },
    });
  };

  const handleDeleteGroup = (g: ProfileGroup) => {
    const cnt = counts[g.id] ?? 0;
    modal.confirm({
      title: `删除分组「${g.name}」？`,
      content: cnt > 0
        ? `该分组下有 ${cnt} 个配置，删除后这些配置会变为未分组（不会删除配置本身）。`
        : '该分组下没有配置，将直接删除。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.group.delete(g.id);
          if (currentGroup === g.id) setGroup(null);
          fireDataChanged();
          message.success('已删除分组');
        } catch (err) {
          message.error('删除失败：' + (err as Error).message);
        }
      },
    });
  };

  const isAllActive = location.pathname.startsWith('/profiles') && !currentGroup;
  const isTestActive = location.pathname.startsWith('/test');
  const isAboutActive = location.pathname.startsWith('/about');

  const handleLogout = () => {
    modal.confirm({
      title: '确认退出登录？',
      content: '退出后下次启动需要重新输入用户名和密码。本地的浏览器配置不会丢失。',
      okText: '退出登录',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => onLogout(),
    });
  };

  const userInitial = (user.username[0] || '?').toUpperCase();
  const userMenuItems = [
    ...(user.role === 'admin' ? [{
      key: 'admin',
      icon: <CrownOutlined />,
      label: '打开管理后台',
      onClick: () => {
        // Open admin panel in default browser via shell (electron exposes shell.openExternal)
        const adminUrl = (() => {
          const base = (localStorage.getItem('fp.auth.server') || 'http://146.190.45.66:3000').replace(/\/+$/, '');
          return `${base}/admin`;
        })();
        api.system.openExternal(adminUrl).catch(() => {
          window.open(adminUrl, '_blank');
        });
      },
    }] : []),
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
      onClick: handleLogout,
    },
  ];

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="sidebar-logo">
          <span className="sidebar-logo-mark">天胡</span>
          <span className="sidebar-logo-text">天胡6金</span>
        </div>

        <div className="sidebar-search">
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: 'rgba(255,255,255,0.4)' }} />}
            placeholder="搜索配置..."
            value={currentSearch}
            onChange={(e) => setSearch(e.target.value)}
            className="sidebar-search-input"
          />
        </div>

        <div
          className={'sidebar-item sidebar-all' + (isAllActive ? ' active' : '')}
          onClick={() => setGroup(null)}
        >
          <AppstoreOutlined className="sidebar-item-icon" />
          <span className="sidebar-item-label">全部</span>
          <span className="sidebar-count">{totalCount}</span>
        </div>

        <div className="sidebar-section-header">
          <span>分组</span>
          <Tooltip title="新建分组">
            <Button
              type="text"
              size="small"
              icon={<PlusOutlined />}
              onClick={handleAddGroup}
              className="sidebar-add-btn"
            />
          </Tooltip>
        </div>

        <div className="sidebar-groups">
          {groups.length === 0 && (
            <div className="sidebar-empty">暂无分组，点击 + 创建</div>
          )}
          {groups.map((g) => {
            const active = location.pathname.startsWith('/profiles') && currentGroup === g.id;
            return (
              <Dropdown
                key={g.id}
                trigger={['contextMenu']}
                menu={{
                  items: [
                    { key: 'rename', label: '编辑（名称 / 颜色）', onClick: () => handleRenameGroup(g) },
                    { type: 'divider' },
                    { key: 'delete', label: '删除分组', danger: true, onClick: () => handleDeleteGroup(g) },
                  ],
                }}
              >
                <div
                  className={'sidebar-item sidebar-group' + (active ? ' active' : '')}
                  onClick={() => setGroup(g.id)}
                >
                  <span className="sidebar-dot" style={{ background: g.color }} />
                  <span className="sidebar-item-label">{g.name}</span>
                  <span className="sidebar-count">{counts[g.id] ?? 0}</span>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        { key: 'rename', label: '编辑（名称 / 颜色）', onClick: () => handleRenameGroup(g) },
                        { type: 'divider' },
                        { key: 'delete', label: '删除分组', danger: true, onClick: () => handleDeleteGroup(g) },
                      ],
                    }}
                  >
                    <span
                      className="sidebar-item-more"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <EllipsisOutlined />
                    </span>
                  </Dropdown>
                </div>
              </Dropdown>
            );
          })}
        </div>

        <Dropdown
          trigger={['click']}
          placement="topRight"
          menu={{ items: userMenuItems }}
        >
          <div className="sidebar-user" title="点击查看账号选项">
            <div className="sidebar-user-avatar">{userInitial}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">
                {user.username}
                {user.role === 'admin' && (
                  <Tooltip title="管理员"><CrownOutlined style={{ color: '#faad14', marginLeft: 6 }} /></Tooltip>
                )}
              </div>
              <div className="sidebar-user-role">
                {offline ? <><span className="offline-dot" />离线模式</> : (user.role === 'admin' ? '管理员' : '已登录')}
              </div>
            </div>
            <EllipsisOutlined style={{ color: 'rgba(255,255,255,0.4)' }} />
          </div>
        </Dropdown>

        <div className="sidebar-bottom-nav">
          <Tooltip title="指纹检测" placement="right">
            <button
              className={'sidebar-mini-btn' + (isTestActive ? ' active' : '')}
              onClick={() => navigate('/test')}
            >
              <ExperimentOutlined />
              <span>检测</span>
            </button>
          </Tooltip>
          <Tooltip title="关于" placement="right">
            <button
              className={'sidebar-mini-btn' + (isAboutActive ? ' active' : '')}
              onClick={() => navigate('/about')}
            >
              <InfoCircleOutlined />
              <span>关于</span>
            </button>
          </Tooltip>
          <span className="sidebar-version">v{version || '0.1.0'}</span>
        </div>
      </aside>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/profiles" replace />} />
          <Route path="/profiles" element={<ProfileList />} />
          <Route path="/profiles/new" element={<ProfileEditor />} />
          <Route path="/profiles/:id" element={<ProfileEditor />} />
          <Route path="/test" element={<FingerprintTest />} />
          <Route path="/about" element={<About />} />
        </Routes>
      </main>
    </div>
  );
}
