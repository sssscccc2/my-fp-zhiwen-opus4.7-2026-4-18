import { Card, Select, Button, Space, App as AntApp, List, Tag, Typography, Alert, Checkbox } from 'antd';
import { PlayCircleOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Profile } from '@shared/types';

const ALL_TESTS: { url: string; name: string; description: string }[] = [
  { url: 'https://browserscan.net/', name: 'BrowserScan', description: '综合指纹检测，是否被识别为机器人' },
  { url: 'https://abrahamjuliot.github.io/creepjs/', name: 'CreepJS', description: '熵值/一致性最严格的指纹测试' },
  { url: 'https://demo.fingerprint.com/', name: 'FingerprintJS', description: '商业级 visitorId 一致性检测' },
  { url: 'https://browserleaks.com/canvas', name: 'BrowserLeaks Canvas', description: 'Canvas 指纹哈希' },
  { url: 'https://browserleaks.com/webgl', name: 'BrowserLeaks WebGL', description: 'WebGL GPU 信息' },
  { url: 'https://browserleaks.com/webrtc', name: 'BrowserLeaks WebRTC', description: 'WebRTC IP 泄露' },
  { url: 'https://ipleak.net/', name: 'IPLeak', description: 'IP/DNS 泄露检测' },
  { url: 'https://iphey.com/', name: 'IPHey', description: '另一款指纹综合测试' },
];

export default function FingerprintTest() {
  const { message } = AntApp.useApp();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [chosenUrls, setChosenUrls] = useState<string[]>(ALL_TESTS.slice(0, 4).map((t) => t.url));
  const [running, setRunning] = useState(false);

  useEffect(() => {
    void api.profile.list().then(setProfiles);
  }, []);

  const handleRun = async () => {
    if (!selected) {
      message.warning('请先选择一个配置文件');
      return;
    }
    if (chosenUrls.length === 0) {
      message.warning('请至少选一个测试站');
      return;
    }
    setRunning(true);
    try {
      const r = await api.fingerprintTest.run(selected, chosenUrls);
      message.success(`已在浏览器中打开 ${r.openedUrls.length} 个标签页`);
    } catch (err) {
      message.error('启动失败：' + (err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <h2>指纹检测</h2>
      </div>
      <div className="page-content">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="使用说明"
          description="选择一个配置文件，然后选择要打开的检测站点。点击运行后会启动该配置文件对应的浏览器，并依次在新标签中打开选中的站点。请人工查看每个站点的检测结果——理想情况下：BrowserScan 显示 NORMAL，CreepJS trust score 高，IPLeak 仅显示代理 IP。"
        />

        <Card title="目标配置" className="editor-card">
          <Space>
            <Select
              showSearch
              style={{ width: 360 }}
              placeholder="选择要测试的配置文件"
              value={selected ?? undefined}
              onChange={setSelected}
              options={profiles.map((p) => ({
                label: `${p.name}（${p.fingerprint.os} · ${p.fingerprint.screen.width}x${p.fingerprint.screen.height}）`,
                value: p.id,
              }))}
            />
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={running}
              onClick={handleRun}
            >
              启动并测试
            </Button>
          </Space>
        </Card>

        <Card title="选择检测站点" extra={
          <Space>
            <Button size="small" onClick={() => setChosenUrls(ALL_TESTS.map((t) => t.url))}>全选</Button>
            <Button size="small" onClick={() => setChosenUrls([])}>清空</Button>
          </Space>
        }>
          <Checkbox.Group
            value={chosenUrls}
            onChange={(v) => setChosenUrls(v as string[])}
            style={{ width: '100%' }}
          >
            <List
              size="small"
              dataSource={ALL_TESTS}
              renderItem={(t) => (
                <List.Item>
                  <Checkbox value={t.url} style={{ width: '100%' }}>
                    <Space>
                      <Typography.Text strong>{t.name}</Typography.Text>
                      <Tag>{t.url}</Tag>
                      <Typography.Text type="secondary">{t.description}</Typography.Text>
                    </Space>
                  </Checkbox>
                </List.Item>
              )}
            />
          </Checkbox.Group>
        </Card>
      </div>
    </>
  );
}
