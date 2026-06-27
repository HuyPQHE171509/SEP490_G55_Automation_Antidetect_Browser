import React, { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Select, message, Popconfirm, Tag, Tooltip, Badge, ConfigProvider, theme, Drawer, Descriptions } from 'antd';
import { collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuthStore } from '../../store/authStore';
import dayjs from 'dayjs';
import { LogOut, ArrowLeft, Shield, Globe, Settings2, Edit2, Trash2, Box, Cpu, Server, Fingerprint, Eye, Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function MyProfiles() {
  const { user, logout } = useAuthStore();
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [editingId, setEditingId] = useState(null);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [detailsRecord, setDetailsRecord] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user?.id) return;

    setLoading(true);
    const unsubscribe = onSnapshot(
      collection(db, `users/${user.id}/profiles`),
      (qSnap) => {
        const data = [];
        qSnap.forEach(docSnap => {
          data.push({ id: docSnap.id, ...docSnap.data() });
        });
        data.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); // Newest first
        setProfiles(data);
        setLoading(false);
      },
      (err) => {
        console.error("Firestore Error:", err);
        message.error('Failed to load profiles');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  const handleSave = async (values) => {
    try {
      const profileId = editingId || `prof-${Date.now()}`;
      const profileData = {
        id: profileId,
        name: values.name,
        note: values.note || '',
        settings: {
          engine: values.engine || 'playwright',
          proxy: {
            type: values.proxyType || 'none',
            server: values.proxyServer || '',
            username: values.proxyUsername || '',
            password: values.proxyPassword || ''
          }
        },
        createdAt: editingId ? (profiles.find(p => p.id === editingId)?.createdAt || Date.now()) : Date.now(),
        updatedAt: Date.now()
      };

      if (editingId) {
        const existing = profiles.find(p => p.id === editingId);
        if (existing && existing.settings) {
          profileData.settings = { ...existing.settings, ...profileData.settings };
          profileData.fingerprint = existing.fingerprint;
        }
      }

      await setDoc(doc(db, `users/${user.id}/profiles`, profileId), profileData);
      message.success('Profile updated successfully!');
      setModalVisible(false);
      form.resetFields();
    } catch (err) {
      console.error(err);
      message.error('Failed to save profile');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteDoc(doc(db, `users/${user.id}/profiles`, id));
      message.success('Profile deleted!');
    } catch (err) {
      console.error(err);
      message.error('Failed to delete profile');
    }
  };

  const openEdit = (record) => {
    setEditingId(record.id);
    form.setFieldsValue({
      name: record.name,
      note: record.note,
      engine: record.settings?.engine || 'playwright',
      proxyType: record.settings?.proxy?.type || 'none',
      proxyServer: record.settings?.proxy?.server || '',
      proxyUsername: record.settings?.proxy?.username || '',
      proxyPassword: record.settings?.proxy?.password || '',
    });
    setModalVisible(true);
  };

  const openDetails = (record) => {
    setDetailsRecord(record);
    setDetailsVisible(true);
  };

  const getEngineColor = (engine) => {
    switch (engine) {
      case 'camoufox': return 'purple';
      case 'playwright-firefox': return 'orange';
      case 'cloakbrowser': return 'cyan';
      default: return 'blue';
    }
  };

  const columns = [
    { 
      title: 'Profile Name', 
      dataIndex: 'name', 
      key: 'name', 
      render: (text, record) => (
        <div className="flex flex-col">
          <span className="font-semibold text-white/90">{text}</span>
          <span className="text-xs text-white/40 truncate max-w-[200px]">{record.id}</span>
        </div>
      ) 
    },
    { 
      title: 'Note', 
      dataIndex: 'note', 
      key: 'note',
      render: (text) => text ? <span className="text-white/70">{text}</span> : <span className="text-white/30 italic">No note</span>
    },
    { 
      title: 'Browser Engine', 
      dataIndex: ['settings', 'engine'], 
      key: 'engine', 
      render: e => (
        <Tag color={getEngineColor(e)} className="flex items-center gap-1 w-max px-2 py-1 rounded-md border-0 bg-opacity-20">
          <Cpu size={12} /> {e || 'playwright'}
        </Tag>
      ) 
    },
    { 
      title: 'Proxy', 
      key: 'proxy', 
      render: (_, r) => {
        const p = r.settings?.proxy;
        if (!p || p.type === 'none' || !p.server) {
          return <span className="text-white/40 flex items-center gap-1"><Globe size={14} /> Direct</span>;
        }
        return (
          <Tooltip title={`${p.type}://${p.server}`}>
            <Tag color="green" className="flex items-center gap-1 w-max px-2 py-1 rounded-md border-0 bg-opacity-20">
              <Server size={12} /> {p.type.toUpperCase()}
            </Tag>
          </Tooltip>
        );
      }
    },
    { 
      title: 'Last Updated', 
      dataIndex: 'updatedAt', 
      key: 'updatedAt', 
      render: (val) => <span className="text-white/50 text-sm">{val ? dayjs(val).format('MMM DD, YYYY HH:mm') : '-'}</span> 
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 150,
      render: (_, record) => (
        <div className="flex items-center gap-2">
          <Tooltip title="View Details">
            <Button 
              type="text" 
              className="text-white/60 hover:text-cyan-400 hover:bg-cyan-400/10" 
              icon={<Eye size={16} />} 
              onClick={() => openDetails(record)} 
            />
          </Tooltip>
          <Tooltip title="Edit Settings">
            <Button 
              type="text" 
              className="text-white/60 hover:text-primary hover:bg-primary/10" 
              icon={<Edit2 size={16} />} 
              onClick={() => openEdit(record)} 
            />
          </Tooltip>
          <Tooltip title="Delete Profile">
            <Popconfirm 
              title="Are you sure?" 
              description="This action cannot be undone."
              onConfirm={() => handleDelete(record.id)}
              okText="Yes"
              cancelText="No"
              placement="topRight"
            >
              <Button 
                type="text" 
                danger 
                icon={<Trash2 size={16} />} 
                className="hover:bg-red-500/10"
              />
            </Popconfirm>
          </Tooltip>
        </div>
      )
    }
  ];

  return (
    <div className="min-h-screen bg-[#080a0c] text-white flex flex-col font-sans relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
      
      <header className="border-b border-white/5 bg-[#080a0c]/60 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <button 
              className="group flex items-center gap-2 px-4 py-1.5 mr-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-all duration-300 backdrop-blur-md cursor-pointer shadow-lg shadow-black/20"
              onClick={() => navigate('/')}
            >
              <div className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center group-hover:-translate-x-1 transition-transform">
                <ArrowLeft size={14} className="text-cyan-400" />
              </div>
              <span className="text-sm font-medium text-white/80 group-hover:text-white transition-colors">Home</span>
            </button>
            
            <div className="flex items-center gap-3 cursor-pointer group" onClick={() => navigate('/')}>
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/30 flex items-center justify-center group-hover:scale-105 transition-transform">
                <Shield className="text-primary" size={20} />
              </div>
              <span className="font-bold text-lg tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70 hidden sm:inline-block">HL-MCK</span>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-sm text-white/50 bg-white/5 px-3 py-1.5 rounded-full border border-white/5">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              {user?.email}
            </div>
            <Button type="text" className="text-white/50 hover:text-red-400 flex items-center gap-2 transition-colors" onClick={() => logout()}>
              <LogOut size={16} /> Sign out
            </Button>
          </div>
        </div>
      </header>
      
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 mt-8 relative z-10">
        
        {/* Header Stats */}
        <div className="mb-10">
          <h1 className="text-3xl font-extrabold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-white to-white/50">
            Profile Dashboard
          </h1>
          <p className="text-white/40">Manage your synced browser profiles from the cloud.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-gradient-to-br from-white/5 to-transparent p-6 rounded-2xl border border-white/5 backdrop-blur-sm">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-blue-500/10 rounded-xl text-blue-400"><Box size={24} /></div>
              <div>
                <p className="text-white/40 text-sm font-medium">Total Profiles</p>
                <h3 className="text-3xl font-bold text-white">{profiles.length}</h3>
              </div>
            </div>
          </div>
          <div className="bg-gradient-to-br from-white/5 to-transparent p-6 rounded-2xl border border-white/5 backdrop-blur-sm">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-purple-500/10 rounded-xl text-purple-400"><Fingerprint size={24} /></div>
              <div>
                <p className="text-white/40 text-sm font-medium">Active Sync</p>
                <h3 className="text-3xl font-bold text-white">Real-time</h3>
              </div>
            </div>
          </div>
        </div>

        {/* Table Section */}
        <div className="bg-[#12161b]/80 backdrop-blur-md p-6 rounded-2xl border border-white/5 shadow-2xl">
          <Table 
            dataSource={profiles} 
            columns={columns} 
            rowKey="id" 
            loading={loading}
            pagination={{ 
              pageSize: 15,
              position: ['bottomCenter'],
              showSizeChanger: false
            }}
            scroll={{ x: 900 }}
            theme="dark"
            className="premium-dark-table"
            locale={{ emptyText: <div className="py-12 text-white/30">No profiles found in cloud.</div> }}
          />
        </div>
      </main>

      <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
        <Modal
          title={
            <div className="flex items-center gap-2 text-lg text-white">
              <Settings2 className="text-primary" size={20} /> Edit Configuration
            </div>
          }
          open={modalVisible}
          onCancel={() => setModalVisible(false)}
          onOk={() => form.submit()}
          okText="Save Changes"
          destroyOnClose
          className="premium-dark-modal"
          centered
          width={500}
        >
          <Form layout="vertical" form={form} onFinish={handleSave} className="mt-6">
            <Form.Item name="name" label={<span className="text-white/70">Profile Name</span>} rules={[{ required: true }]}>
              <Input size="large" placeholder="e.g. Amazon US Account" />
            </Form.Item>
            <Form.Item name="note" label={<span className="text-white/70">Internal Note</span>}>
              <Input.TextArea rows={3} placeholder="Add some notes..." />
            </Form.Item>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Form.Item name="engine" label={<span className="text-white/70">Browser Engine</span>} className="mb-0">
                <Select size="large">
                  <Select.Option value="playwright">Chromium</Select.Option>
                  <Select.Option value="playwright-firefox">Firefox</Select.Option>
                  <Select.Option value="camoufox">Camoufox</Select.Option>
                  <Select.Option value="cloakbrowser">CloakBrowser</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item name="proxyType" label={<span className="text-white/70">Proxy Type</span>} className="mb-0">
                <Select size="large">
                  <Select.Option value="none">Direct (No Proxy)</Select.Option>
                  <Select.Option value="http">HTTP / HTTPS</Select.Option>
                  <Select.Option value="socks5">SOCKS5</Select.Option>
                </Select>
              </Form.Item>
            </div>

            <Form.Item noStyle shouldUpdate={(prev, cur) => prev.proxyType !== cur.proxyType}>
              {({ getFieldValue }) => {
                const type = getFieldValue('proxyType');
                if (type === 'none') return null;
                return (
                  <div className="mt-4 p-4 rounded-xl bg-white/5 border border-white/5 space-y-4">
                    <Form.Item name="proxyServer" label={<span className="text-white/70">Server (IP:Port)</span>} className="mb-0">
                      <Input size="large" placeholder="192.168.1.1:8080" />
                    </Form.Item>
                    <div className="grid grid-cols-2 gap-4">
                      <Form.Item name="proxyUsername" label={<span className="text-white/70">Username</span>} className="mb-0">
                        <Input size="large" placeholder="Optional" />
                      </Form.Item>
                      <Form.Item name="proxyPassword" label={<span className="text-white/70">Password</span>} className="mb-0">
                        <Input.Password size="large" placeholder="Optional" />
                      </Form.Item>
                    </div>
                  </div>
                );
              }}
            </Form.Item>
          </Form>
        </Modal>

        <Drawer
          title={
            <div className="flex items-center gap-2 text-white">
              <Info className="text-cyan-400" size={20} /> Profile Details
            </div>
          }
          placement="right"
          width={600}
          onClose={() => setDetailsVisible(false)}
          open={detailsVisible}
          className="premium-dark-drawer"
        >
          {detailsRecord && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-bold text-white mb-2">{detailsRecord.name}</h3>
                <p className="text-white/50 text-sm">ID: {detailsRecord.id}</p>
              </div>

              <Descriptions title={<span className="text-white/80">Basic Settings</span>} bordered column={2} size="small" className="dark-descriptions">
                <Descriptions.Item label="Engine" span={2}><Tag color={getEngineColor(detailsRecord.settings?.engine)}>{detailsRecord.settings?.engine || 'playwright'}</Tag></Descriptions.Item>
                <Descriptions.Item label="Proxy" span={2}>
                  {detailsRecord.settings?.proxy?.type !== 'none' 
                    ? `${detailsRecord.settings?.proxy?.type}://${detailsRecord.settings?.proxy?.server}` 
                    : 'Direct'}
                </Descriptions.Item>
                <Descriptions.Item label="WebRTC" span={2}>{detailsRecord.settings?.webrtc || 'Default'}</Descriptions.Item>
                <Descriptions.Item label="Headless" span={2}>{detailsRecord.settings?.headless ? 'Yes' : 'No'}</Descriptions.Item>
                <Descriptions.Item label="Note" span={2}>{detailsRecord.note || '-'}</Descriptions.Item>
                <Descriptions.Item label="Created At" span={2}>{dayjs(detailsRecord.createdAt).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
              </Descriptions>

              <Descriptions title={<span className="text-white/80">Hardware & Screen</span>} bordered column={2} size="small" className="dark-descriptions">
                <Descriptions.Item label="CPU Cores">{detailsRecord.settings?.cpuCores || 'Auto'}</Descriptions.Item>
                <Descriptions.Item label="Memory (RAM)">{detailsRecord.settings?.memoryGB ? `${detailsRecord.settings.memoryGB} GB` : 'Auto'}</Descriptions.Item>
                <Descriptions.Item label="Resolution">{detailsRecord.fingerprint?.screenResolution || `${detailsRecord.settings?.windowWidth || 1920}x${detailsRecord.settings?.windowHeight || 1080}`}</Descriptions.Item>
                <Descriptions.Item label="Color Depth">{detailsRecord.fingerprint?.colorDepth || detailsRecord.settings?.display?.colorDepth || 24}-bit</Descriptions.Item>
                <Descriptions.Item label="Pixel Ratio">{detailsRecord.fingerprint?.pixelRatio || detailsRecord.settings?.display?.pixelRatio || 1}</Descriptions.Item>
                <Descriptions.Item label="GPU Vendor" span={2}>{detailsRecord.settings?.gpuVendor || detailsRecord.settings?.hardware?.gpuVendor || 'Auto'}</Descriptions.Item>
                <Descriptions.Item label="GPU Renderer" span={2}>{detailsRecord.settings?.gpuRenderer || detailsRecord.settings?.hardware?.gpuRenderer || 'Auto'}</Descriptions.Item>
              </Descriptions>

              {detailsRecord.fingerprint && (
                <Descriptions title={<span className="text-white/80">Fingerprint Details</span>} bordered column={1} size="small" className="dark-descriptions">
                  <Descriptions.Item label="OS">{detailsRecord.fingerprint.os}</Descriptions.Item>
                  <Descriptions.Item label="Browser">{detailsRecord.fingerprint.browser} v{detailsRecord.fingerprint.browserVersion}</Descriptions.Item>
                  <Descriptions.Item label="User Agent"><span className="text-xs">{detailsRecord.fingerprint.userAgent}</span></Descriptions.Item>
                  <Descriptions.Item label="Language">{detailsRecord.fingerprint.language}</Descriptions.Item>
                  <Descriptions.Item label="Timezone">{detailsRecord.fingerprint.timezone}</Descriptions.Item>
                  <Descriptions.Item label="Connection">{detailsRecord.fingerprint.connectionType || 'Default'}</Descriptions.Item>
                  <Descriptions.Item label="Canvas Noise">{detailsRecord.fingerprint.canvas ? `Intensity: ${detailsRecord.fingerprint.canvasNoiseIntensity} (Seed: ${detailsRecord.fingerprint.canvasNoise})` : 'Off'}</Descriptions.Item>
                  <Descriptions.Item label="WebGL Noise">{detailsRecord.fingerprint.webgl ? `Seed: ${detailsRecord.fingerprint.webglNoise}` : 'Off'}</Descriptions.Item>
                  <Descriptions.Item label="Audio">{detailsRecord.fingerprint.audio ? `${detailsRecord.fingerprint.audioSampleRate} Hz / ${detailsRecord.fingerprint.audioChannels}` : 'Off'}</Descriptions.Item>
                </Descriptions>
              )}
            </div>
          )}
        </Drawer>
      </ConfigProvider>

      <style dangerouslySetInnerHTML={{ __html: `
        /* Premium Table Styles */
        .premium-dark-table .ant-table { background: transparent !important; color: white !important; font-size: 14px; }
        .premium-dark-table .ant-table-thead > tr > th { background: rgba(255,255,255,0.02) !important; color: rgba(255,255,255,0.5) !important; font-weight: 500; border-bottom: 1px solid rgba(255,255,255,0.05); text-transform: uppercase; letter-spacing: 0.05em; font-size: 12px; padding: 16px; }
        .premium-dark-table .ant-table-tbody > tr > td { border-bottom: 1px solid rgba(255,255,255,0.03); padding: 16px; transition: all 0.2s; }
        .premium-dark-table .ant-table-tbody > tr:hover > td { background: rgba(255,255,255,0.03) !important; }
        .premium-dark-table .ant-pagination { color: white; }
        .premium-dark-table .ant-pagination-item { background: transparent; border-color: rgba(255,255,255,0.1); }
        .premium-dark-table .ant-pagination-item a { color: rgba(255,255,255,0.6); }
        .premium-dark-table .ant-pagination-item-active { background: rgba(59, 130, 246, 0.2); border-color: #3b82f6; }
        .premium-dark-table .ant-pagination-item-active a { color: #3b82f6; }
        
        /* Premium Modal Styles Overrides (on top of dark theme) */
        .premium-dark-modal .ant-modal-content { background: #161b22 !important; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
        .premium-dark-modal .ant-modal-header { background: transparent !important; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 16px; }
        .premium-dark-modal .ant-btn-primary { background: #3b82f6; box-shadow: 0 4px 14px 0 rgba(59, 130, 246, 0.39); border: none; }
        .premium-dark-modal .ant-btn-primary:hover { background: #2563eb !important; }
        
        /* Drawer Styles */
        .premium-dark-drawer .ant-drawer-content { background: #080a0c !important; border-left: 1px solid rgba(255,255,255,0.05); }
        .premium-dark-drawer .ant-drawer-header { background: #12161b !important; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .premium-dark-drawer .ant-drawer-close { color: rgba(255,255,255,0.5) !important; }
        .premium-dark-drawer .ant-drawer-close:hover { color: white !important; }
        .premium-dark-drawer .ant-descriptions-title { color: white !important; margin-bottom: 12px; }
        
        .dark-descriptions .ant-descriptions-item-label { background: rgba(255,255,255,0.02) !important; color: rgba(255,255,255,0.6) !important; border-color: rgba(255,255,255,0.05) !important; width: 140px; }
        .dark-descriptions .ant-descriptions-item-content { background: transparent !important; color: white !important; border-color: rgba(255,255,255,0.05) !important; word-break: break-all; }
      `}} />
    </div>
  );
}
