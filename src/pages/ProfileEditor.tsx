import {
  Form, Input, Select, InputNumber, Button, Space, Tabs, Card, App as AntApp,
  Alert, Divider, Tag, Switch, Tooltip, Row, Col, Typography, Segmented, Descriptions,
} from 'antd';
import {
  ReloadOutlined, ThunderboltOutlined, SaveOutlined, ArrowLeftOutlined,
  ExperimentOutlined, GlobalOutlined, CheckCircleTwoTone, CloseCircleTwoTone,
} from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { fireDataChanged } from '../lib/dataBus';
import type {
  Profile, ProfileGroup, ProxyConfig, FingerprintConfig, PresetTemplate,
  ParsedProxy, ProxyTestResult, DnsMode, DnsConfig,
} from '@shared/types';
import { DNS_PRESETS, recommendDns } from '@shared/dnsPresets';

const TIMEZONES = [
  'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Singapore', 'Asia/Bangkok',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Australia/Sydney', 'UTC',
];
const LOCALES = [
  'zh-CN', 'zh-TW', 'en-US', 'en-GB', 'ja-JP', 'ko-KR', 'fr-FR', 'de-DE', 'es-ES',
  'pt-BR', 'ru-RU', 'it-IT', 'th-TH', 'vi-VN',
];

interface FormValues extends Omit<Profile, 'fingerprint' | 'tags'> {
  tags: string;
  fingerprint: FingerprintConfig;
}

export default function ProfileEditor() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<FormValues>();
  const [groups, setGroups] = useState<ProfileGroup[]>([]);
  const [proxies, setProxies] = useState<ProxyConfig[]>([]);
  const [presets, setPresets] = useState<PresetTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [issues, setIssues] = useState<{ level: 'error' | 'warning'; field: string; message: string }[]>([]);

  // -------- Inline proxy state ----------
  // We dropped the "select existing proxy" option per UX request: every window
  // gets its own dedicated proxy. The library still exists internally — when
  // saving we persist into the same `proxies` table and bind by id, but the
  // UI only ever shows the paste form. Editing an existing profile pre-fills
  // the textarea so the user can verify or replace.
  const [rawProxy, setRawProxy] = useState('');
  const [parsedProxy, setParsedProxy] = useState<ParsedProxy | null>(null);
  const [proxyType, setProxyType] = useState<'socks5' | 'http' | 'https'>('socks5');
  const [proxyName, setProxyName] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<(ProxyTestResult & { parsed?: ParsedProxy }) | null>(null);

  // -------- DNS routing state (per-proxy, persisted on save) --------
  // Default: 'proxy' (let upstream provider resolve hostnames). Switching to
  // 'custom' tunnels DNS-over-TCP through the SOCKS5 proxy to a server we pick.
  const [dnsMode, setDnsMode] = useState<DnsMode>('proxy');
  const [dnsServer, setDnsServer] = useState<string>('1.1.1.1');
  const [dnsManualEntry, setDnsManualEntry] = useState(false);

  // Display string for the currently-bound proxy when editing — shown in a
  // green banner so the user sees what's already configured before deciding
  // whether to overwrite. Format mirrors what `parseProxyString` accepts.
  const [currentProxySummary, setCurrentProxySummary] = useState<string>('');

  /** Compose the DnsConfig the editor currently represents (or undefined for default). */
  const composeDnsConfig = (): DnsConfig | undefined => {
    if (dnsMode === 'proxy') return { mode: 'proxy' };
    if (!dnsServer) return { mode: 'proxy' };
    const preset = DNS_PRESETS.find((p) => p.server === dnsServer);
    return {
      mode: 'custom',
      customServer: dnsServer,
      customLabel: preset?.label ?? dnsServer,
    };
  };

  useEffect(() => {
    void Promise.all([api.group.list(), api.proxy.list(), api.preset.list()]).then(([gs, prs, ps]) => {
      setGroups(gs);
      setProxies(prs);
      setPresets(ps);
    });
  }, []);

  useEffect(() => {
    void (async () => {
      if (isEdit && id) {
        const p = await api.profile.get(id);
        if (!p) {
          message.error('配置不存在');
          navigate('/profiles');
          return;
        }
        form.setFieldsValue({
          ...p,
          tags: (p.tags ?? []).join(','),
          fingerprint: p.fingerprint,
        } as unknown as FormValues);
        // Hydrate DNS state + current-proxy preview from the bound proxy.
        if (p.proxyId) {
          const allProxies = await api.proxy.list();
          const bound = allProxies.find((x) => x.id === p.proxyId);
          if (bound) {
            // Reconstruct a host:port:user:pass / host:port string so the
            // user can see (and copy/edit) what's bound. This is also the
            // format we re-parse in onSave to detect changes.
            const summary = bound.username
              ? `${bound.host}:${bound.port}:${bound.username}:${bound.password ?? ''}`
              : `${bound.host}:${bound.port}`;
            setCurrentProxySummary(`${bound.type}://${summary}`);
            // Pre-fill textarea with the same string so saving without changes
            // is a no-op. (User can clear or paste over to replace.)
            setRawProxy(summary);
            setProxyType(bound.type);
            setProxyName(bound.name);
            if (bound.dns?.mode === 'custom' && bound.dns.customServer) {
              setDnsMode('custom');
              setDnsServer(bound.dns.customServer);
            } else {
              setDnsMode('proxy');
            }
          }
        }
      } else {
        const fp = await api.preset.random();
        form.setFieldsValue({
          name: '新配置 ' + new Date().toLocaleTimeString(),
          tags: '',
          fingerprint: fp,
          proxyId: null,
          groupId: null,
          notes: '',
        } as unknown as FormValues);
      }
    })();
  }, [id, isEdit, form, navigate, message]);

  const applyPreset = async (presetId: string) => {
    const fp = await api.preset.random(presetId);
    form.setFieldsValue({ fingerprint: fp } as unknown as FormValues);
    message.success('已应用预设');
  };

  const randomize = async () => {
    const fp = await api.preset.random();
    form.setFieldsValue({ fingerprint: fp } as unknown as FormValues);
    message.success('已随机生成（按市场份额加权）');
  };

  const newSeed = () => {
    const fp = form.getFieldValue('fingerprint') as FingerprintConfig;
    form.setFieldsValue({
      fingerprint: { ...fp, seed: Math.floor(Math.random() * 2_147_483_647) },
    } as unknown as FormValues);
  };

  // --------- Quick proxy: parse / test / apply ---------
  const handleParseProxy = async (raw?: string) => {
    const text = (raw ?? rawProxy).trim();
    if (!text) {
      setParsedProxy(null);
      return null;
    }
    try {
      const p = await api.proxy.parse(text);
      if (!p) {
        message.warning('无法识别代理格式');
        setParsedProxy(null);
        return null;
      }
      setParsedProxy(p);
      setProxyType(p.type);
      if (!proxyName) {
        setProxyName(`${p.host}:${p.port}`);
      }
      return p;
    } catch (err) {
      message.error('解析失败：' + (err as Error).message);
      return null;
    }
  };

  const handleTestProxy = async () => {
    const text = rawProxy.trim();
    if (!text) { message.warning('请先粘贴代理'); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.proxy.testAdhoc(text);
      setTestResult(r);
      if (r.parsed) {
        setParsedProxy(r.parsed);
        setProxyType(r.parsed.type);
        if (!proxyName) setProxyName(`${r.parsed.host}:${r.parsed.port}`);
      }
      if (r.ok) {
        message.success(`代理可用 · ${r.country ?? '?'} · ${r.latencyMs ?? '?'}ms`);
        // If the user hasn't manually picked a DNS yet (still on Cloudflare
        // default) and we now know the exit country, suggest a country-local
        // DNS so toggling to "custom" is one click away.
        if (dnsMode === 'proxy' && r.country && dnsServer === '1.1.1.1') {
          const suggested = recommendDns(r.country);
          setDnsServer(suggested.server);
        }
      } else {
        message.error('代理测试失败：' + (r.error ?? '未知错误'));
      }
    } catch (err) {
      message.error('测试失败：' + (err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const applyToFingerprint = () => {
    if (!testResult || !testResult.ok) {
      message.warning('请先成功测试代理');
      return;
    }
    const cur = (form.getFieldValue('fingerprint') ?? {}) as FingerprintConfig;
    const next: FingerprintConfig = JSON.parse(JSON.stringify(cur));
    const changed: string[] = [];

    if (testResult.timezone) {
      next.timezone = testResult.timezone;
      changed.push('时区');
    }
    if (testResult.suggestedLocale) {
      next.locale = testResult.suggestedLocale;
      next.navigator = next.navigator ?? ({} as FingerprintConfig['navigator']);
      next.navigator.language = testResult.suggestedLocale;
      const existing = Array.isArray(next.navigator.languages) ? next.navigator.languages : [];
      const merged = [testResult.suggestedLocale, ...existing.filter((l) => l !== testResult.suggestedLocale)];
      next.navigator.languages = merged.slice(0, 4);
      changed.push('语言');
    }
    if (typeof testResult.latitude === 'number' && typeof testResult.longitude === 'number') {
      next.geo = {
        enabled: true,
        latitude: testResult.latitude,
        longitude: testResult.longitude,
        accuracy: 35,
      };
      changed.push('GPS 坐标');
    }
    form.setFieldsValue({ fingerprint: next } as unknown as FormValues);
    message.success('已应用到指纹：' + (changed.join(' / ') || '无变更'));
  };

  const onSave = async () => {
    setLoading(true);
    try {
      // Validate (only triggers rules on mounted fields, which is fine).
      await form.validateFields();
      // CRITICAL: use getFieldsValue(true) instead of validateFields' return —
      // antd's Tabs lazy-mounts panels, so fields inside tabs the user never
      // clicked won't appear in validateFields(). getFieldsValue(true) returns
      // the COMPLETE internal store, including initial values set via
      // setFieldsValue() that were never mounted.
      const values = form.getFieldsValue(true) as FormValues;
      const tags = values.tags
        ? String(values.tags).split(/[,，]/).map((s) => s.trim()).filter(Boolean)
        : [];

      const dnsCfg = composeDnsConfig();

      // Per-window proxy semantics:
      //   - empty textarea => no proxy (direct connection)
      //   - textarea matches what was bound on load => keep existing id, just
      //     update DNS settings if changed
      //   - textarea differs => parse + create a NEW proxy row, bind its id
      //     (we don't update the old row in case other profiles still use it)
      let resolvedProxyId: string | null = values.proxyId ?? null;
      const trimmedRaw = rawProxy.trim();

      // Reconstruct what we initialised the textarea with (if editing existing)
      const originalRaw = isEdit && resolvedProxyId
        ? (() => {
            const bound = proxies.find((x) => x.id === resolvedProxyId);
            if (!bound) return '';
            return bound.username
              ? `${bound.host}:${bound.port}:${bound.username}:${bound.password ?? ''}`
              : `${bound.host}:${bound.port}`;
          })()
        : '';

      if (!trimmedRaw) {
        // User cleared the proxy → unbind
        resolvedProxyId = null;
      } else if (trimmedRaw !== originalRaw) {
        // User pasted something different (or this is a new profile)
        const parsed = parsedProxy ?? await handleParseProxy();
        if (!parsed) {
          message.error('代理格式无法识别，无法保存');
          setLoading(false);
          return;
        }
        const created = await api.proxy.create({
          name: proxyName.trim() || `${parsed.host}:${parsed.port}`,
          type: proxyType,
          host: parsed.host,
          port: parsed.port,
          username: parsed.username,
          password: parsed.password,
          notes: trimmedRaw,
          dns: dnsCfg,
        });
        resolvedProxyId = created.id;
        const fresh = await api.proxy.list();
        setProxies(fresh);
      } else if (resolvedProxyId && dnsCfg) {
        // Same proxy, possibly different DNS settings
        try {
          await api.proxy.update(resolvedProxyId, { dns: dnsCfg });
        } catch (err) {
          console.warn('failed to update proxy dns config', err);
        }
      }

      const payload = {
        name: values.name,
        groupId: values.groupId ?? null,
        proxyId: resolvedProxyId,
        tags,
        notes: values.notes ?? '',
        fingerprint: values.fingerprint,
      };

      if (isEdit && id) {
        await api.profile.update({ id, ...payload });
        message.success('已保存');
      } else {
        const created = await api.profile.create(payload);
        message.success('已创建');
        navigate(`/profiles/${created.id}`, { replace: true });
      }
      fireDataChanged();
    } catch (err) {
      if ((err as { errorFields?: unknown[] }).errorFields) {
        message.warning('请检查表单');
      } else {
        message.error('保存失败：' + (err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  };

  const fp: FingerprintConfig | undefined = Form.useWatch('fingerprint', form);

  useEffect(() => {
    if (!fp) {
      setIssues([]);
      return;
    }
    const list: typeof issues = [];
    const ua = (fp.navigator?.userAgent ?? '').toLowerCase();
    if (fp.os === 'windows' && !ua.includes('windows')) {
      list.push({ level: 'error', field: 'navigator.userAgent', message: 'OS=windows 但 UA 中未包含 Windows 标识' });
    }
    if (fp.os === 'mac' && !(ua.includes('mac os x') || ua.includes('macintosh'))) {
      list.push({ level: 'error', field: 'navigator.userAgent', message: 'OS=mac 但 UA 中未包含 Mac 标识' });
    }
    const renderer = (fp.webgl?.renderer ?? '').toLowerCase();
    if (fp.os === 'windows' && (renderer.includes('apple') || renderer.includes('metal'))) {
      list.push({ level: 'error', field: 'webgl.renderer', message: 'Windows 系统不可能出现 Apple Metal 渲染器' });
    }
    if (fp.os === 'linux' && (renderer.includes('direct3d') || renderer.includes('d3d11'))) {
      list.push({ level: 'error', field: 'webgl.renderer', message: 'Linux 不能使用 DirectX/D3D' });
    }
    if (fp.os === 'mac' && fp.screen?.pixelRatio === 1) {
      list.push({ level: 'warning', field: 'screen.pixelRatio', message: 'Mac 视网膜屏 pixelRatio 通常为 2' });
    }
    setIssues(list);
  }, [fp]);

  const presetOptions = useMemo(() => presets.map((p) => ({
    label: `${p.name} (${p.marketShare}%)`,
    value: p.id,
  })), [presets]);

  return (
    <>
      <div className="page-header">
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/profiles')}>返回</Button>
          <h2 style={{ margin: 0 }}>{isEdit ? '编辑配置' : '新建配置'}</h2>
        </Space>
        <Space>
          <Tooltip title="按真实市场份额加权随机生成完整指纹">
            <Button icon={<ThunderboltOutlined />} onClick={randomize}>随机生成</Button>
          </Tooltip>
          <Select
            placeholder="从预设加载"
            style={{ width: 280 }}
            options={presetOptions}
            onChange={applyPreset}
          />
          <Button type="primary" icon={<SaveOutlined />} loading={loading} onClick={onSave}>
            保存
          </Button>
        </Space>
      </div>

      <div className="page-content">
        {issues.length > 0 && (
          <Alert
            type={issues.some((i) => i.level === 'error') ? 'error' : 'warning'}
            showIcon
            style={{ marginBottom: 12 }}
            message="指纹一致性提示"
            description={
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {issues.map((it, idx) => (
                  <li key={idx}>
                    <Tag color={it.level === 'error' ? 'red' : 'orange'}>{it.level}</Tag>
                    {it.field}：{it.message}
                  </li>
                ))}
              </ul>
            }
          />
        )}

        <Form form={form} layout="vertical" autoComplete="off">
          <Card className="editor-card" title="基本信息">
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="name" label="配置名称" rules={[{ required: true, message: '必填' }]}>
                  <Input placeholder="例如：FB-账号 1" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="groupId" label="分组">
                  <Select allowClear placeholder="未分组" options={groups.map((g) => ({ label: g.name, value: g.id }))} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="tags" label="标签（逗号分隔）">
                  <Input placeholder="例如：facebook,海外,高优先" />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item name="notes" label="备注">
                  <Input.TextArea rows={2} />
                </Form.Item>
              </Col>
            </Row>
          </Card>

          <Card
            className="editor-card"
            title={
              <Space>
                <GlobalOutlined />
                <span>代理 / 出口 IP</span>
                <Tag color="blue">每个窗口独立绑定</Tag>
              </Space>
            }
          >
            <>
                <Form.Item name="proxyId" hidden><Input /></Form.Item>
                {isEdit && currentProxySummary && (
                  <Alert
                    type="success"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message={<span>当前代理：<code>{currentProxySummary}</code></span>}
                    description="如需替换，直接在下方粘贴新的代理字符串覆盖即可。"
                  />
                )}
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="支持的代理格式（自动识别）"
                  description={
                    <div style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.8 }}>
                      <div>1. <code>host:port:user:pass</code> &nbsp;← DataImpulse / IPRoyal / ProxyEmpire 默认</div>
                      <div>2. <code>host:port</code></div>
                      <div>3. <code>user:pass@host:port</code></div>
                      <div>4. <code>socks5://user:pass@host:port</code></div>
                      <div>5. <code>http://user:pass@host:port</code> / <code>https://...</code></div>
                    </div>
                  }
                />
                <Row gutter={12}>
                  <Col span={24}>
                    <Form.Item label="粘贴代理字符串">
                      <Input.TextArea
                        rows={2}
                        value={rawProxy}
                        onChange={(e) => { setRawProxy(e.target.value); setParsedProxy(null); setTestResult(null); }}
                        onBlur={() => void handleParseProxy()}
                        placeholder="例如：gw.dataimpulse.com:823:050b81be1d01913520d1__cr.us:2ad3a1cc427d8906"
                        style={{ fontFamily: 'monospace' }}
                      />
                    </Form.Item>
                  </Col>
                </Row>

                {parsedProxy && (
                  <Card size="small" style={{ marginBottom: 12, background: '#fafafa' }}>
                    <Descriptions size="small" column={4} colon>
                      <Descriptions.Item label="协议">
                        <Select
                          size="small"
                          value={proxyType}
                          onChange={setProxyType}
                          style={{ width: 110 }}
                          options={[
                            { label: 'SOCKS5', value: 'socks5' },
                            { label: 'HTTP', value: 'http' },
                            { label: 'HTTPS', value: 'https' },
                          ]}
                        />
                      </Descriptions.Item>
                      <Descriptions.Item label="主机">{parsedProxy.host}</Descriptions.Item>
                      <Descriptions.Item label="端口">{parsedProxy.port}</Descriptions.Item>
                      <Descriptions.Item label="用户">{parsedProxy.username || <Tag>无</Tag>}</Descriptions.Item>
                      <Descriptions.Item label="密码" span={2}>
                        {parsedProxy.password
                          ? <code>{'•'.repeat(Math.min(parsedProxy.password.length, 12))}</code>
                          : <Tag>无</Tag>}
                      </Descriptions.Item>
                      <Descriptions.Item label="保存名称" span={2}>
                        <Input
                          size="small"
                          value={proxyName}
                          onChange={(e) => setProxyName(e.target.value)}
                          placeholder={`${parsedProxy.host}:${parsedProxy.port}`}
                        />
                      </Descriptions.Item>
                    </Descriptions>
                  </Card>
                )}

                <Space wrap>
                  <Button onClick={() => void handleParseProxy()}>解析</Button>
                  <Button
                    type="primary"
                    icon={<ExperimentOutlined />}
                    loading={testing}
                    onClick={() => void handleTestProxy()}
                  >
                    测试 &amp; 识别出口 IP
                  </Button>
                  <Button
                    icon={<ThunderboltOutlined />}
                    disabled={!testResult?.ok}
                    onClick={applyToFingerprint}
                  >
                    应用到指纹（时区 / 语言 / 经纬度）
                  </Button>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    保存配置时，此代理会自动入库并绑定到当前 profile
                  </Typography.Text>
                </Space>

                {testResult && (
                  <Card
                    size="small"
                    style={{ marginTop: 12 }}
                    title={
                      <Space>
                        {testResult.ok
                          ? <CheckCircleTwoTone twoToneColor="#52c41a" />
                          : <CloseCircleTwoTone twoToneColor="#ff4d4f" />}
                        <span>{testResult.ok ? '出口信息（来自 ipinfo.io）' : '测试失败'}</span>
                        {testResult.latencyMs && <Tag color="geekblue">{testResult.latencyMs} ms</Tag>}
                      </Space>
                    }
                  >
                    {testResult.ok ? (
                      <Descriptions size="small" column={3}>
                        <Descriptions.Item label="出口 IP">
                          <code>{testResult.ip}</code>
                        </Descriptions.Item>
                        <Descriptions.Item label="国家">
                          <Tag color="blue">{testResult.country}</Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="城市">
                          {[testResult.city, testResult.region].filter(Boolean).join(' / ')}
                        </Descriptions.Item>
                        <Descriptions.Item label="时区">
                          <Tag color="purple">{testResult.timezone || '—'}</Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="建议语言">
                          <Tag color="cyan">{testResult.suggestedLocale || '—'}</Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="坐标">
                          {typeof testResult.latitude === 'number'
                            ? `${testResult.latitude.toFixed(4)}, ${testResult.longitude?.toFixed(4)}`
                            : '—'}
                        </Descriptions.Item>
                        <Descriptions.Item label="ISP / 组织" span={3}>
                          {testResult.org || '—'}
                        </Descriptions.Item>
                      </Descriptions>
                    ) : (
                      <Alert type="error" showIcon message={testResult.error || '未知错误'} />
                    )}
                  </Card>
                )}
              </>

            {/* ---------- DNS routing ---------- */}
            <Divider style={{ margin: '12px 0' }}>DNS 设置</Divider>
            <Row gutter={16} align="top">
              <Col span={24} style={{ marginBottom: 8 }}>
                <Segmented
                  value={dnsMode}
                  onChange={(v) => setDnsMode(v as DnsMode)}
                  options={[
                    { label: '跟随代理 DNS（默认）', value: 'proxy' },
                    { label: '自建 DNS（DNS-over-SOCKS5）', value: 'custom' },
                  ]}
                />
              </Col>
              <Col span={24}>
                {dnsMode === 'proxy' ? (
                  <Alert
                    type="info"
                    showIcon
                    message="由代理出口节点解析域名（最常见做法）"
                    description={
                      <span style={{ fontSize: 12, lineHeight: 1.7 }}>
                        网站只能看到代理供应商配置的 DNS 服务器（DataImpulse 等住宅代理通常用 Google DNS）。
                        实测兼容性最好，但可能出现「IP 在 X 国，DNS 在 Y 国」的破绽，部分风控会扣分。
                      </span>
                    }
                  />
                ) : (
                  <>
                    <Alert
                      type="success"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message="本地解析 → 通过 SOCKS5 隧道发送 DNS 查询到指定服务器"
                      description={
                        <span style={{ fontSize: 12, lineHeight: 1.7 }}>
                          浏览器看到的 DNS 解析器 IP = 你选的服务器（如台湾 HiNet）。
                          <br />
                          <strong>要求</strong>：上游必须是 SOCKS5 代理（HTTP 代理无法承载 DNS 隧道）。
                          <br />
                          <strong>建议</strong>：选跟代理出口同国家的 ISP DNS，最大化"本地用户"伪装。
                        </span>
                      }
                    />
                    <Row gutter={12}>
                      <Col span={dnsManualEntry ? 18 : 20}>
                        {dnsManualEntry ? (
                          <Input
                            value={dnsServer}
                            onChange={(e) => setDnsServer(e.target.value.trim())}
                            placeholder="DNS 服务器 IP，例如 168.95.1.1"
                            addonBefore="IP"
                          />
                        ) : (
                          <Select
                            showSearch
                            value={dnsServer}
                            onChange={setDnsServer}
                            optionFilterProp="label"
                            style={{ width: '100%' }}
                            placeholder="选择按国家推荐的 DNS"
                            options={DNS_PRESETS.map((p) => ({
                              label: `[${p.country === 'XX' ? '全球' : p.country}] ${p.label}`,
                              value: p.server,
                            }))}
                          />
                        )}
                      </Col>
                      <Col span={dnsManualEntry ? 6 : 4}>
                        <Button
                          block
                          onClick={() => setDnsManualEntry((v) => !v)}
                        >
                          {dnsManualEntry ? '从预设选' : '手动输入 IP'}
                        </Button>
                      </Col>
                      {testResult?.country && (
                        <Col span={24} style={{ marginTop: 8 }}>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            根据测试结果建议：
                          </Typography.Text>
                          {(() => {
                            const sug = recommendDns(testResult.country);
                            return (
                              <Tag
                                color="cyan"
                                style={{ marginLeft: 8, cursor: 'pointer' }}
                                onClick={() => { setDnsServer(sug.server); setDnsManualEntry(false); }}
                              >
                                {sug.label} ← 点击应用
                              </Tag>
                            );
                          })()}
                        </Col>
                      )}
                    </Row>
                  </>
                )}
              </Col>
            </Row>
          </Card>

          <Card className="editor-card" title="指纹参数">
            <Tabs
              className="fp-tabs"
              destroyInactiveTabPane={false}
              items={[
                {
                  key: 'navigator', label: 'Navigator', forceRender: true,
                  children: (
                    <Row gutter={16}>
                      <Col span={8}>
                        <Form.Item name={['fingerprint', 'os']} label="操作系统" rules={[{ required: true }]}>
                          <Select options={[
                            { label: 'Windows', value: 'windows' },
                            { label: 'macOS', value: 'mac' },
                            { label: 'Linux', value: 'linux' },
                          ]} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name={['fingerprint', 'brand']} label="品牌">
                          <Select options={[{ label: 'Chrome', value: 'Chrome' }, { label: 'Edge', value: 'Edge' }]} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name={['fingerprint', 'seed']} label={
                          <Space>种子 <Button size="small" icon={<ReloadOutlined />} onClick={newSeed} type="link">换一个</Button></Space>
                        }>
                          <InputNumber style={{ width: '100%' }} min={1} max={2147483647} />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Form.Item name={['fingerprint', 'navigator', 'userAgent']} label="User-Agent" rules={[{ required: true }]}>
                          <Input.TextArea rows={2} />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name={['fingerprint', 'navigator', 'platform']} label="navigator.platform">
                          <Select options={[
                            { label: 'Win32', value: 'Win32' },
                            { label: 'MacIntel', value: 'MacIntel' },
                            { label: 'Linux x86_64', value: 'Linux x86_64' },
                            { label: 'Linux armv8l', value: 'Linux armv8l' },
                          ]} />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name={['fingerprint', 'navigator', 'vendor']} label="navigator.vendor">
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name={['fingerprint', 'navigator', 'language']} label="主语言">
                          <Select showSearch options={LOCALES.map((l) => ({ label: l, value: l }))} />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name={['fingerprint', 'navigator', 'doNotTrack']} label="DNT">
                          <Select options={[
                            { label: '未设置', value: 'unspecified' },
                            { label: '0 (允许追踪)', value: '0' },
                            { label: '1 (拒绝追踪)', value: '1' },
                          ]} />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Form.Item
                          name={['fingerprint', 'navigator', 'languages']}
                          label="navigator.languages（按优先级）"
                          getValueFromEvent={(v) => Array.isArray(v) ? v : v.split(',').map((s: string) => s.trim()).filter(Boolean)}
                        >
                          <Select mode="tags" options={LOCALES.map((l) => ({ label: l, value: l }))} />
                        </Form.Item>
                      </Col>
                    </Row>
                  ),
                },
                {
                  key: 'hardware', label: 'Hardware', forceRender: true,
                  children: (
                    <Row gutter={16}>
                      <Col span={8}>
                        <Form.Item name={['fingerprint', 'navigator', 'hardwareConcurrency']} label="CPU 核心数">
                          <Select options={[1, 2, 4, 6, 8, 12, 16, 20, 24, 32].map((v) => ({ label: String(v), value: v }))} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name={['fingerprint', 'navigator', 'deviceMemory']} label="设备内存 (GB)">
                          <Select options={[0.25, 0.5, 1, 2, 4, 8].map((v) => ({ label: String(v), value: v }))} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name={['fingerprint', 'storageQuotaMB']} label="存储配额 (MB)">
                          <InputNumber style={{ width: '100%' }} min={500} max={1024 * 100} step={500} />
                        </Form.Item>
                      </Col>
                    </Row>
                  ),
                },
                {
                  key: 'screen', label: 'Screen', forceRender: true,
                  children: (
                    <Row gutter={16}>
                      <Col span={6}>
                        <Form.Item name={['fingerprint', 'screen', 'width']} label="宽度">
                          <InputNumber style={{ width: '100%' }} min={800} max={7680} />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name={['fingerprint', 'screen', 'height']} label="高度">
                          <InputNumber style={{ width: '100%' }} min={600} max={4320} />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name={['fingerprint', 'screen', 'availWidth']} label="可用宽度">
                          <InputNumber style={{ width: '100%' }} min={800} max={7680} />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name={['fingerprint', 'screen', 'availHeight']} label="可用高度">
                          <InputNumber style={{ width: '100%' }} min={600} max={4320} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name={['fingerprint', 'screen', 'colorDepth']} label="颜色深度">
                          <Select options={[24, 30, 32].map((v) => ({ label: String(v), value: v }))} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name={['fingerprint', 'screen', 'pixelRatio']} label="设备像素比 (DPR)">
                          <Select options={[1, 1.25, 1.5, 2, 3].map((v) => ({ label: String(v), value: v }))} />
                        </Form.Item>
                      </Col>
                    </Row>
                  ),
                },
                {
                  key: 'webgl', label: 'WebGL', forceRender: true,
                  children: (
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name={['fingerprint', 'webgl', 'vendor']} label="WebGL Vendor">
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name={['fingerprint', 'webgl', 'unmaskedVendor']} label="Unmasked Vendor">
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Form.Item name={['fingerprint', 'webgl', 'renderer']} label="WebGL Renderer">
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Form.Item name={['fingerprint', 'webgl', 'unmaskedRenderer']} label="Unmasked Renderer">
                          <Input />
                        </Form.Item>
                      </Col>
                    </Row>
                  ),
                },
                {
                  key: 'canvas', label: 'Canvas', forceRender: true,
                  children: (
                    <Form.Item name={['fingerprint', 'canvas', 'mode']} label="模式" extra="推荐：噪声模式（每个 profile 独立但稳定）">
                      <Select options={[
                        { label: '噪声（推荐）', value: 'noise' },
                        { label: '真实硬件', value: 'real' },
                        { label: '阻断', value: 'block' },
                      ]} />
                    </Form.Item>
                  ),
                },
                {
                  key: 'audio', label: 'Audio', forceRender: true,
                  children: (
                    <Form.Item name={['fingerprint', 'audio', 'mode']} label="AudioContext 模式" extra="推荐：噪声模式">
                      <Select options={[
                        { label: '噪声（推荐）', value: 'noise' },
                        { label: '真实硬件', value: 'real' },
                        { label: '阻断', value: 'block' },
                      ]} />
                    </Form.Item>
                  ),
                },
                {
                  key: 'fonts', label: 'Fonts', forceRender: true,
                  children: (
                    <Form.Item name={['fingerprint', 'fonts', 'preset']} label="字体集预设" extra="字体集应匹配操作系统，自定义请慎重（可能造成不一致）">
                      <Select options={[
                        { label: 'Windows 10 默认 (~200 字体)', value: 'windows-10' },
                        { label: 'Windows 11 默认 (~220 字体)', value: 'windows-11' },
                        { label: 'macOS 13 默认', value: 'macos-13' },
                        { label: 'macOS 14 默认', value: 'macos-14' },
                        { label: 'Linux 通用 (~80 字体)', value: 'linux' },
                      ]} />
                    </Form.Item>
                  ),
                },
                {
                  key: 'webrtc', label: 'WebRTC', forceRender: true,
                  children: (
                    <Form.Item name={['fingerprint', 'webrtc', 'mode']} label="WebRTC 模式" extra="搭配代理时强烈推荐 disabled">
                      <Select options={[
                        { label: 'Disabled（彻底关闭，最安全）', value: 'disabled' },
                        { label: 'Altered（仅展示代理出口 IP）', value: 'altered' },
                        { label: 'Real（展示真实本机 IP，禁用！）', value: 'real' },
                      ]} />
                    </Form.Item>
                  ),
                },
                {
                  key: 'tz', label: 'Timezone & Locale', forceRender: true,
                  children: (
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name={['fingerprint', 'timezone']} label="时区">
                          <Select showSearch options={TIMEZONES.map((t) => ({ label: t, value: t }))} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name={['fingerprint', 'locale']} label="区域 (locale)">
                          <Select showSearch options={LOCALES.map((l) => ({ label: l, value: l }))} />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Alert type="info" showIcon message="如果配置了代理且未关闭 geoip，启动时会自动按代理出口 IP 覆写时区和区域，避免 IP 与时区不匹配。" />
                      </Col>
                    </Row>
                  ),
                },
                {
                  key: 'geo', label: 'Geolocation', forceRender: true,
                  children: (
                    <Row gutter={16}>
                      <Col span={6}>
                        <Form.Item name={['fingerprint', 'geo', 'enabled']} label="启用 GPS 定位" valuePropName="checked">
                          <Switch />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name={['fingerprint', 'geo', 'latitude']} label="纬度">
                          <InputNumber style={{ width: '100%' }} step={0.0001} />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name={['fingerprint', 'geo', 'longitude']} label="经度">
                          <InputNumber style={{ width: '100%' }} step={0.0001} />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name={['fingerprint', 'geo', 'accuracy']} label="精度 (米)">
                          <InputNumber style={{ width: '100%' }} min={1} max={10000} />
                        </Form.Item>
                      </Col>
                    </Row>
                  ),
                },
              ]}
            />
          </Card>

          <Divider />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            提示：所有指纹参数会编译为 CloakBrowser 的 C++ 层启动参数，在 JS 层不可被检测到。
          </Typography.Text>
        </Form>
      </div>
    </>
  );
}
