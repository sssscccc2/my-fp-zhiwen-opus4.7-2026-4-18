import {
  Table, Button, Space, Modal, Form, Input, Select, InputNumber, App as AntApp, Tag, Tooltip,
  Typography,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, ExperimentOutlined, DeleteOutlined, EditOutlined,
  CheckCircleFilled, CloseCircleFilled, QuestionCircleOutlined,
} from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ProxyConfig } from '@shared/types';

interface ProxyFormValues {
  name: string;
  type: ProxyConfig['type'];
  host: string;
  port: number;
  username?: string;
  password?: string;
  notes?: string;
}

export default function ProxyManager() {
  const { message, modal } = AntApp.useApp();
  const [list, setList] = useState<ProxyConfig[]>([]);
  const [editing, setEditing] = useState<ProxyConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState<Set<string>>(new Set());
  const [form] = Form.useForm<ProxyFormValues>();

  const reload = async () => {
    setList(await api.proxy.list());
  };

  useEffect(() => { void reload(); }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ type: 'http', port: 8080 });
    setOpen(true);
  };

  const openEdit = (p: ProxyConfig) => {
    setEditing(p);
    form.setFieldsValue({
      name: p.name, type: p.type, host: p.host, port: p.port,
      username: p.username, password: p.password, notes: p.notes,
    });
    setOpen(true);
  };

  const onSave = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        await api.proxy.update(editing.id, values);
        message.success('已更新');
      } else {
        await api.proxy.create(values);
        message.success('已创建');
      }
      setOpen(false);
      void reload();
    } catch (err) {
      if (!(err as { errorFields?: unknown[] }).errorFields) {
        message.error('保存失败：' + (err as Error).message);
      }
    }
  };

  const onDelete = (p: ProxyConfig) => {
    modal.confirm({
      title: `确定删除代理 "${p.name}"？`,
      content: '使用此代理的配置文件将变为直连。',
      okType: 'danger',
      okText: '删除',
      cancelText: '取消',
      onOk: async () => {
        await api.proxy.delete(p.id);
        message.success('已删除');
        void reload();
      },
    });
  };

  const onTest = async (p: ProxyConfig) => {
    setTesting((prev) => new Set(prev).add(p.id));
    try {
      const r = await api.proxy.test(p.id);
      if (r.ok) {
        message.success(`代理可用：${r.ip}（${r.country ?? '未知'}） · ${r.latencyMs}ms`);
      } else {
        message.error(`代理不可用：${r.error}`);
      }
      void reload();
    } catch (err) {
      message.error('测试失败：' + (err as Error).message);
    } finally {
      setTesting((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
    }
  };

  const onTestAll = async () => {
    if (list.length === 0) {
      message.info('代理池为空');
      return;
    }
    message.loading({ content: `批量检测 ${list.length} 个代理…`, key: 'test-all', duration: 0 });
    try {
      const results = await api.proxy.testAll();
      const okCount = results.filter((r) => r.result.ok).length;
      message.success({ content: `检测完成：${okCount}/${list.length} 可用`, key: 'test-all' });
      void reload();
    } catch (err) {
      message.error({ content: '检测失败：' + (err as Error).message, key: 'test-all' });
    }
  };

  const columns = [
    { title: '名称', dataIndex: 'name' },
    {
      title: '类型', dataIndex: 'type', width: 80,
      render: (t: string) => <Tag>{t.toUpperCase()}</Tag>,
    },
    {
      title: '地址', width: 240,
      render: (_: unknown, p: ProxyConfig) => (
        <Typography.Text code>{p.host}:{p.port}</Typography.Text>
      ),
    },
    { title: '认证', width: 100, render: (_: unknown, p: ProxyConfig) => (p.username ? '是' : '否') },
    {
      title: '状态', width: 90,
      render: (_: unknown, p: ProxyConfig) => {
        if (p.lastTestOk === undefined) return <Tag icon={<QuestionCircleOutlined />}>未测试</Tag>;
        return p.lastTestOk
          ? <Tag color="success" icon={<CheckCircleFilled />}>可用</Tag>
          : <Tag color="error" icon={<CloseCircleFilled />}>失败</Tag>;
      },
    },
    {
      title: '出口 IP', width: 160,
      render: (_: unknown, p: ProxyConfig) => p.lastTestIp ?? '-',
    },
    {
      title: '国家', width: 80,
      render: (_: unknown, p: ProxyConfig) => p.lastTestCountry ?? '-',
    },
    {
      title: '延迟', width: 80,
      render: (_: unknown, p: ProxyConfig) =>
        p.lastTestLatencyMs ? <span>{p.lastTestLatencyMs}ms</span> : '-',
    },
    {
      title: '最后检测', width: 160,
      render: (_: unknown, p: ProxyConfig) =>
        p.lastTestedAt ? new Date(p.lastTestedAt).toLocaleString() : '-',
    },
    {
      title: '操作', width: 240, fixed: 'right' as const,
      render: (_: unknown, p: ProxyConfig) => (
        <Space size="small">
          <Button
            size="small"
            icon={<ExperimentOutlined />}
            loading={testing.has(p.id)}
            onClick={() => onTest(p)}
          >
            测试
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(p)}>编辑</Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDelete(p)}>删除</Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div className="page-header">
        <h2>代理管理 <Typography.Text type="secondary" style={{ fontSize: 14, marginLeft: 8 }}>
          共 {list.length} 个 · 可用 {list.filter((p) => p.lastTestOk).length}
        </Typography.Text></h2>
        <Space>
          <Tooltip title="刷新">
            <Button icon={<ReloadOutlined />} onClick={reload} />
          </Tooltip>
          <Button icon={<ExperimentOutlined />} onClick={onTestAll}>批量检测</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加代理</Button>
        </Space>
      </div>

      <div className="page-content">
        <Table
          rowKey="id"
          dataSource={list}
          columns={columns}
          size="small"
          pagination={{ pageSize: 20 }}
          scroll={{ x: 1200 }}
        />
      </div>

      <Modal
        title={editing ? '编辑代理' : '添加代理'}
        open={open}
        onOk={onSave}
        onCancel={() => setOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" autoComplete="off">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="例如：US 住宅代理 1" />
          </Form.Item>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="type" label="类型" rules={[{ required: true }]} style={{ width: 120 }}>
              <Select options={[
                { label: 'HTTP', value: 'http' },
                { label: 'HTTPS', value: 'https' },
                { label: 'SOCKS5', value: 'socks5' },
              ]} />
            </Form.Item>
            <Form.Item name="host" label="主机" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input placeholder="proxy.example.com 或 1.2.3.4" />
            </Form.Item>
            <Form.Item name="port" label="端口" rules={[{ required: true }]} style={{ width: 120 }}>
              <InputNumber style={{ width: '100%' }} min={1} max={65535} />
            </Form.Item>
          </Space.Compact>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="username" label="用户名" style={{ flex: 1 }}>
              <Input autoComplete="off" />
            </Form.Item>
            <Form.Item name="password" label="密码" style={{ flex: 1 }}>
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
