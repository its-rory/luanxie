import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Health } from '../types'

export interface ModelProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  protocol: 'openai-completions' | 'anthropic-messages'
  headers: string
  models: {
    text: string
    image: string
    audio: string
    merge: string
  }
  active: boolean
}

interface SettingsState {
  TEXT_PROVIDER_NAME: string
  TEXT_API_KEY: string
  TEXT_BASE_URL: string
  TEXT_MODEL: string
  TEXT_HEADERS: string

  IMAGE_PROVIDER_NAME: string
  IMAGE_API_KEY: string
  IMAGE_BASE_URL: string
  IMAGE_MODEL: string
  IMAGE_HEADERS: string

  AUDIO_PROVIDER_NAME: string
  AUDIO_API_KEY: string
  AUDIO_BASE_URL: string
  AUDIO_MODEL: string
  AUDIO_HEADERS: string

  MERGE_PROVIDER_NAME: string
  MERGE_API_KEY: string
  MERGE_BASE_URL: string
  MERGE_MODEL: string
  MERGE_HEADERS: string

  MODEL_PROVIDERS: string

  ADMIN_PASSWORD: string

  AUTO_MERGE_EXISTING_CONFIDENCE: string
  AUTO_MERGE_NEW_CONFIDENCE: string
}

export default function SettingsPage({ showToast, onLogout }: { showToast: (m: string) => void; onLogout: () => void }) {
  const [health, setHealth] = useState<Health | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [loadingSettings, setLoadingSettings] = useState(false)
  const [saving, setSaving] = useState(false)

  // 原始设置
  const [rawSettings, setRawSettings] = useState<SettingsState>({
    TEXT_PROVIDER_NAME: '',
    TEXT_API_KEY: '',
    TEXT_BASE_URL: '',
    TEXT_MODEL: '',
    TEXT_HEADERS: '',
    IMAGE_PROVIDER_NAME: '',
    IMAGE_API_KEY: '',
    IMAGE_BASE_URL: '',
    IMAGE_MODEL: '',
    IMAGE_HEADERS: '',
    AUDIO_PROVIDER_NAME: '',
    AUDIO_API_KEY: '',
    AUDIO_BASE_URL: '',
    AUDIO_MODEL: '',
    AUDIO_HEADERS: '',
    MERGE_PROVIDER_NAME: '',
    MERGE_API_KEY: '',
    MERGE_BASE_URL: '',
    MERGE_MODEL: '',
    MERGE_HEADERS: '',
    MODEL_PROVIDERS: '',
    ADMIN_PASSWORD: '',
    AUTO_MERGE_EXISTING_CONFIDENCE: 'medium',
    AUTO_MERGE_NEW_CONFIDENCE: 'high',
  })

  // 管理员密码临时输入
  const [adminPassword, setAdminPassword] = useState('')

  // 供应商列表
  const [providers, setProviders] = useState<ModelProvider[]>([])

  // 当前正在编辑的供应商（null 表示未展开编辑，'new' 表示新建，其他为编辑对应 id）
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [providerForm, setProviderForm] = useState<ModelProvider>({
    id: '',
    name: '',
    baseUrl: '',
    apiKey: '',
    protocol: 'openai-completions',
    headers: '',
    models: {
      text: '',
      image: '',
      audio: '',
      merge: '',
    },
    active: false,
  })

  // 测试状态
  const [testState, setTestState] = useState<{ status: 'idle' | 'testing' | 'success' | 'error'; message: string }>({
    status: 'idle',
    message: '',
  })

  const loadHealth = () => {
    api.health().then(setHealth).catch(() => {})
  }

  useEffect(() => {
    loadHealth()
  }, [])

  const openConfigModal = async () => {
    setLoadingSettings(true)
    try {
      const data = (await api.getSettings()) as any
      setRawSettings(data)
      setAdminPassword(data.ADMIN_PASSWORD || '')

      let parsedProviders: ModelProvider[] = []
      if (data.MODEL_PROVIDERS) {
        try {
          parsedProviders = JSON.parse(data.MODEL_PROVIDERS)
        } catch {
          parsedProviders = []
        }
      }

      // 如果未存储过提供商列表，从当前已有配置生成默认提供方
      if (!parsedProviders || parsedProviders.length === 0) {
        parsedProviders = [
          {
            id: 'opencode-go',
            name: 'opencode-go',
            baseUrl: data.AUDIO_BASE_URL || 'https://opencode.ai/zen/go/v1',
            apiKey: data.AUDIO_API_KEY || '',
            protocol: 'openai-completions',
            headers: data.AUDIO_HEADERS || 'x-opencode-session: luanxie-session-affinity-01\nx-opencode-client: luanxie',
            models: {
              text: data.TEXT_MODEL || 'deepseek-v4-flash',
              image: data.IMAGE_MODEL || 'deepseek-v4-flash-vision-exp',
              audio: data.AUDIO_MODEL || 'mimo-v2.5',
              merge: data.MERGE_MODEL || 'deepseek-v4-flash',
            },
            active: true,
          },
          {
            id: 'deepseek',
            name: 'DeepSeek',
            baseUrl: 'https://api.deepseek.com/v1',
            apiKey: '',
            protocol: 'openai-completions',
            headers: '',
            models: {
              text: 'deepseek-chat',
              image: 'deepseek-chat',
              audio: 'whisper-1',
              merge: 'deepseek-chat',
            },
            active: false,
          },
        ]
      }

      setProviders(parsedProviders)
      setEditingProviderId(null)
      setTestState({ status: 'idle', message: '' })
      setShowModal(true)
    } catch (e) {
      showToast('获取 API 配置失败: ' + (e as Error).message)
    } finally {
      setLoadingSettings(false)
    }
  }

  // 开启添加供应商
  const handleAddNewProvider = () => {
    setProviderForm({
      id: `custom-${Date.now().toString().slice(-4)}`,
      name: '',
      baseUrl: '',
      apiKey: '',
      protocol: 'openai-completions',
      headers: '',
      models: {
        text: 'deepseek-v4-flash',
        image: 'deepseek-v4-flash-vision-exp',
        audio: 'mimo-v2.5',
        merge: 'deepseek-v4-flash',
      },
      active: providers.length === 0,
    })
    setEditingProviderId('new')
    setTestState({ status: 'idle', message: '' })
  }

  // 开启编辑供应商
  const handleEditProvider = (p: ModelProvider) => {
    setProviderForm(JSON.parse(JSON.stringify(p)))
    setEditingProviderId(p.id)
    setTestState({ status: 'idle', message: '' })
  }

  // 删除供应商
  const handleDeleteProvider = (id: string) => {
    if (!confirm('确定要删除该模型供应商吗？')) return
    const updated = providers.filter(p => p.id !== id)
    if (updated.length > 0 && !updated.some(p => p.active)) {
      updated[0].active = true
    }
    setProviders(updated)
    if (editingProviderId === id) {
      setEditingProviderId(null)
    }
    // 同步保存
    persistProvidersAndSave(updated, adminPassword)
  }

  // 激活供应商
  const handleActivateProvider = (id: string) => {
    const updated = providers.map(p => ({
      ...p,
      active: p.id === id,
    }))
    setProviders(updated)
    persistProvidersAndSave(updated, adminPassword)
    showToast('已切换当前使用的模型供应商')
  }

  // 保存当前编辑的供应商
  const handleSaveProviderForm = (e: React.FormEvent) => {
    e.preventDefault()
    if (!providerForm.name.trim()) {
      showToast('请输入供应商显示名称')
      return
    }
    if (!providerForm.baseUrl.trim()) {
      showToast('请输入 API 地址 (Base URL)')
      return
    }

    let updated: ModelProvider[] = []
    if (editingProviderId === 'new') {
      const newP = { ...providerForm, id: providerForm.id.trim() || `custom-${Date.now().toString().slice(-4)}` }
      if (providers.length === 0) newP.active = true
      updated = [...providers, newP]
    } else {
      updated = providers.map(p => (p.id === editingProviderId ? { ...providerForm } : p))
    }

    setProviders(updated)
    setEditingProviderId(null)
    persistProvidersAndSave(updated, adminPassword)
    showToast('模型供应商已保存！')
  }

  // 将供应商映射回系统底层设置并持久化保存
  const persistProvidersAndSave = async (provList: ModelProvider[], newAdminPw: string) => {
    const activeProv = provList.find(p => p.active) || provList[0]
    if (!activeProv) return

    setSaving(true)
    try {
      const payload: any = {
        ...rawSettings,
        ADMIN_PASSWORD: newAdminPw,
        MODEL_PROVIDERS: JSON.stringify(provList),

        // 将当前激活的供应商映射到系统各模块
        TEXT_PROVIDER_NAME: activeProv.name || activeProv.id,
        TEXT_API_KEY: activeProv.apiKey,
        TEXT_BASE_URL: activeProv.baseUrl,
        TEXT_MODEL: activeProv.models.text || 'deepseek-v4-flash',
        TEXT_HEADERS: activeProv.headers || '',

        IMAGE_PROVIDER_NAME: activeProv.name || activeProv.id,
        IMAGE_API_KEY: activeProv.apiKey,
        IMAGE_BASE_URL: activeProv.baseUrl,
        IMAGE_MODEL: activeProv.models.image || 'deepseek-v4-flash-vision-exp',
        IMAGE_HEADERS: activeProv.headers || '',

        AUDIO_PROVIDER_NAME: activeProv.name || activeProv.id,
        AUDIO_API_KEY: activeProv.apiKey,
        AUDIO_BASE_URL: activeProv.baseUrl,
        AUDIO_MODEL: activeProv.models.audio || 'mimo-v2.5',
        AUDIO_HEADERS: activeProv.headers || '',

        MERGE_PROVIDER_NAME: activeProv.name || activeProv.id,
        MERGE_API_KEY: activeProv.apiKey,
        MERGE_BASE_URL: activeProv.baseUrl,
        MERGE_MODEL: activeProv.models.merge || 'deepseek-v4-flash',
        MERGE_HEADERS: activeProv.headers || '',
      }

      await api.saveSettings(payload)
      setRawSettings(payload)
      loadHealth()
    } catch (e: any) {
      showToast('保存设置失败: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  // 测试正在编辑的供应商连通性
  const handleTestProvider = async () => {
    const apiKey = providerForm.apiKey || rawSettings.AUDIO_API_KEY || ''
    if (!apiKey) {
      setTestState({ status: 'error', message: 'API Key 不能为空' })
      return
    }

    setTestState({ status: 'testing', message: '测试连接中…' })
    try {
      const res = await api.testSettings({
        task: 'text',
        provider: providerForm.name || providerForm.id,
        api_key: apiKey,
        base_url: providerForm.baseUrl,
        model: providerForm.models.text || 'deepseek-v4-flash',
        headers: providerForm.headers,
      })
      if (res.ok) {
        setTestState({ status: 'success', message: '连接成功 ✓' })
      } else {
        setTestState({ status: 'error', message: res.error || '测试失败' })
      }
    } catch (e: any) {
      setTestState({ status: 'error', message: e.message || '连接失败' })
    }
  }

  const cycleExistingConfidence = async () => {
    const order: ('low' | 'medium' | 'high' | 'never')[] = ['low', 'medium', 'high', 'never']
    const current = health?.auto_merge_existing_confidence || 'medium'
    const nextIdx = (order.indexOf(current as any) + 1) % order.length
    const nextVal = order[nextIdx]
    setHealth(prev => prev ? { ...prev, auto_merge_existing_confidence: nextVal } : null)
    try {
      const data = await api.getSettings()
      data.AUTO_MERGE_EXISTING_CONFIDENCE = nextVal
      await api.saveSettings(data)
      showToast('自动合并门槛更新成功')
      loadHealth()
    } catch (e) {
      showToast('更新失败: ' + (e as Error).message)
      loadHealth()
    }
  }

  const cycleNewConfidence = async () => {
    const order: ('low' | 'medium' | 'high' | 'never')[] = ['low', 'medium', 'high', 'never']
    const current = health?.auto_merge_new_confidence || 'high'
    const nextIdx = (order.indexOf(current as any) + 1) % order.length
    const nextVal = order[nextIdx]
    setHealth(prev => prev ? { ...prev, auto_merge_new_confidence: nextVal } : null)
    try {
      const data = await api.getSettings()
      data.AUTO_MERGE_NEW_CONFIDENCE = nextVal
      await api.saveSettings(data)
      showToast('自动合并门槛更新成功')
      loadHealth()
    } catch (e) {
      showToast('更新失败: ' + (e as Error).message)
      loadHealth()
    }
  }

  return (
    <div className="fade-in">
      <div className="section-title">设置</div>

      {health && (
        <div className="card" style={{ padding: '8px 16px' }}>
          <div className="kv">
            <span className="k">API 接口参数</span>
            <button
              onClick={openConfigModal}
              disabled={loadingSettings}
              className="btn small"
              style={{
                background: health.api_key_set ? '#10b981' : '#ef4444',
                color: '#fff',
                borderColor: health.api_key_set ? '#10b981' : '#ef4444',
                padding: '4px 10px',
                fontSize: '11px',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                transition: 'opacity 0.15s',
              }}
              onMouseOver={e => (e.currentTarget.style.opacity = '0.88')}
              onMouseOut={e => (e.currentTarget.style.opacity = '1')}
            >
              {loadingSettings ? '读取中…' : health.api_key_set ? '已配置 ✓' : '未配置 ✗'}
            </button>
          </div>
          <div className="kv">
            <span className="k">语音转写 (Whisper)</span>
            {health.cloud_whisper ? (
              <span className="v ok">云端 API 已就绪</span>
            ) : health.local_whisper ? (
              <span className="v ok">本地模型已就绪</span>
            ) : (
              <span className="v warn">未配置/未安装</span>
            )}
          </div>
          <div className="kv" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="k">归类至已有主题门槛</span>
            <button
              onClick={cycleExistingConfidence}
              className="btn small ghost"
              style={{
                padding: '4px 10px',
                fontSize: '11px',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {{ low: '全自动', medium: '中置信及以上', high: '高置信才自动', never: '从不自动' }[health.auto_merge_existing_confidence] || health.auto_merge_existing_confidence}
            </button>
          </div>
          <div className="kv" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="k">归类为全新主题门槛</span>
            <button
              onClick={cycleNewConfidence}
              className="btn small ghost"
              style={{
                padding: '4px 10px',
                fontSize: '11px',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {{ low: '全自动', medium: '中置信及以上', high: '高置信才自动', never: '从不自动' }[health.auto_merge_new_confidence] || health.auto_merge_new_confidence}
            </button>
          </div>
          <div className="kv" style={{ borderBottom: 'none' }}>
            <span className="k">处理队列</span>
            <span className="v">{health.queue_depth} 条</span>
          </div>
        </div>
      )}

      <div style={{ padding: '4px 0 12px' }}>
        <button
          className="btn danger"
          style={{ width: '100%', padding: '10px', borderRadius: '8px' }}
          onClick={async () => {
            if (!confirm('确定要退出登录吗？')) return
            try {
              await api.logout()
              onLogout()
            } catch (e) {
              showToast((e as Error).message)
            }
          }}
        >
          退出登录
        </button>
      </div>

      <div className="empty" style={{ padding: '36px 20px', fontSize: 12 }}>
        乱写 · 随手碎念与拍照，自动归档并提取白板文字<br />
        系统将在后台自动合并、重构、维护关联双链
      </div>

      {/* DeepSeek Harness 风格模型设置弹窗 */}
      {showModal && (
        <div
          className="modal-overlay"
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '20px',
          }}
        >
          <div
            className="modal-content"
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '560px',
              maxHeight: '88vh',
              overflowY: 'auto',
              padding: '24px',
              boxShadow: '0 20px 45px rgba(0, 0, 0, 0.12)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
              <div>
                <h3 style={{ fontSize: '19px', fontWeight: 700, color: '#0f172a', margin: 0 }}>模型</h3>
                <p style={{ fontSize: '13px', color: '#64748b', margin: '4px 0 0 0' }}>
                  填入各提供方的 API 密钥即可使用其模型。
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '22px',
                  cursor: 'pointer',
                  color: '#94a3b8',
                  padding: '2px 6px',
                }}
              >
                ×
              </button>
            </div>

            {/* 第一行：管理员密码 */}
            <div
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '12px 14px',
                background: '#f8fafc',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>管理员密码</span>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>留空或保持 ••• 即不修改</span>
              </div>
              <input
                type="password"
                placeholder="留空(或保持 •••)=不修改"
                value={adminPassword}
                onChange={e => {
                  setAdminPassword(e.target.value)
                  persistProvidersAndSave(providers, e.target.value)
                }}
                style={modernInputStyle}
              />
            </div>

            {/* 模型列表 (模型A、模型B...) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {providers.map(p => {
                const isKeySet = p.apiKey && p.apiKey !== '••••••••' ? true : (p.active && rawSettings.AUDIO_API_KEY ? true : false)
                return (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      border: p.active ? '1.5px solid #cbd5e1' : '1px solid #e2e8f0',
                      borderRadius: '10px',
                      padding: '12px 16px',
                      background: '#ffffff',
                      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.02)',
                    }}
                  >
                    {/* 左侧：文字与状态点 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
                        {p.name || p.id}
                      </span>
                      {/* 状态小圆点: 绿色代表已配置密钥/已启用，红色代表未配置 */}
                      <span
                        style={{
                          display: 'inline-block',
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: isKeySet ? '#10b981' : '#ef4444',
                        }}
                      />
                      {p.active && (
                        <span
                          style={{
                            fontSize: '11px',
                            color: '#2563eb',
                            background: '#eff6ff',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontWeight: 500,
                          }}
                        >
                          当前生效
                        </span>
                      )}
                    </div>

                    {/* 右侧：按钮组 (编辑、删除) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {!p.active && (
                        <button
                          type="button"
                          onClick={() => handleActivateProvider(p.id)}
                          style={harnessSubtleButtonStyle}
                          title="设为当前生效提供商"
                        >
                          使用
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleEditProvider(p)}
                        style={harnessSubtleButtonStyle}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteProvider(p.id)}
                        style={harnessDangerButtonStyle}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* 模型A、B下面一行是靠右的按钮：增加模型供应商 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '-4px' }}>
              <button
                type="button"
                onClick={handleAddNewProvider}
                style={{
                  background: '#ffffff',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: '#1e293b',
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                  transition: 'all 0.15s ease',
                }}
                onMouseOver={e => (e.currentTarget.style.background = '#f8fafc')}
                onMouseOut={e => (e.currentTarget.style.background = '#ffffff')}
              >
                + 增加模型供应商
              </button>
            </div>

            {/* 点击后展开全宽页面（自定义提供方 / 编辑提供方） */}
            {editingProviderId !== null && (
              <div
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '18px',
                  background: '#f8fafc',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                  animation: 'fadeIn 0.2s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
                  <h4 style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a', margin: 0 }}>
                    {editingProviderId === 'new' ? '自定义提供方' : `编辑提供方 · ${providerForm.name || providerForm.id}`}
                  </h4>
                  <button
                    type="button"
                    onClick={() => setEditingProviderId(null)}
                    style={{ background: 'none', border: 'none', fontSize: '18px', color: '#94a3b8', cursor: 'pointer' }}
                  >
                    ×
                  </button>
                </div>

                <form onSubmit={handleSaveProviderForm} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* Provider ID */}
                  <div>
                    <label style={formLabelStyle}>Provider ID</label>
                    <input
                      type="text"
                      placeholder="acme-gateway"
                      value={providerForm.id}
                      onChange={e => setProviderForm(prev => ({ ...prev, id: e.target.value }))}
                      style={modernInputStyle}
                    />
                    <p style={formHelpTextStyle}>
                      以小写字母开头的标识，在请求中唯一标识该提供方，并用于派生凭据名。
                    </p>
                  </div>

                  {/* 显示名称 */}
                  <div>
                    <label style={formLabelStyle}>显示名称</label>
                    <input
                      type="text"
                      placeholder="如 OpenCode Go、DeepSeek 官方"
                      value={providerForm.name}
                      onChange={e => setProviderForm(prev => ({ ...prev, name: e.target.value }))}
                      style={modernInputStyle}
                    />
                  </div>

                  {/* API 地址 */}
                  <div>
                    <label style={formLabelStyle}>API 地址 (Base URL)</label>
                    <input
                      type="text"
                      placeholder="https://gateway.example/v1"
                      value={providerForm.baseUrl}
                      onChange={e => setProviderForm(prev => ({ ...prev, baseUrl: e.target.value }))}
                      style={modernInputStyle}
                    />
                  </div>

                  {/* API 协议 */}
                  <div>
                    <label style={formLabelStyle}>API 协议</label>
                    <select
                      value={providerForm.protocol}
                      onChange={e => setProviderForm(prev => ({ ...prev, protocol: e.target.value as any }))}
                      style={modernInputStyle}
                    >
                      <option value="openai-completions">openai-completions</option>
                      <option value="anthropic-messages">anthropic-messages</option>
                    </select>
                  </div>

                  {/* API 密钥 */}
                  <div>
                    <label style={formLabelStyle}>API 密钥</label>
                    <input
                      type="password"
                      placeholder="输入 API 密钥"
                      value={providerForm.apiKey}
                      onChange={e => setProviderForm(prev => ({ ...prev, apiKey: e.target.value }))}
                      style={modernInputStyle}
                    />
                  </div>

                  {/* 自定义请求头 (每家不一样的选项以文本框体现) */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={formLabelStyle}>自定义请求头 (Headers)</label>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>支持每行 Key: Value 或 JSON 格式</span>
                    </div>
                    <textarea
                      rows={3}
                      placeholder={"x-opencode-session: luanxie-session-affinity-01\nx-opencode-client: luanxie"}
                      value={providerForm.headers}
                      onChange={e => setProviderForm(prev => ({ ...prev, headers: e.target.value }))}
                      style={{
                        ...modernInputStyle,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        fontSize: '12px',
                        lineHeight: '1.45',
                        resize: 'vertical',
                      }}
                    />
                    <p style={formHelpTextStyle}>
                      用于满足每家服务商特殊的请求头认证或路由机制（如 OpenCode Go 需提供 x-opencode-session）。
                    </p>
                  </div>

                  {/* 各功能模型目录配置 */}
                  <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: '10px' }}>
                    <label style={{ ...formLabelStyle, marginBottom: '8px' }}>模型目录分配 (可直接指定任务模型)</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <div>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>文字分类 (Text)</span>
                        <input
                          type="text"
                          placeholder="deepseek-v4-flash"
                          value={providerForm.models.text}
                          onChange={e => setProviderForm(prev => ({ ...prev, models: { ...prev.models, text: e.target.value } }))}
                          style={modernInputStyle}
                        />
                      </div>
                      <div>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>图像识别 (Image)</span>
                        <input
                          type="text"
                          placeholder="deepseek-v4-flash-vision-exp"
                          value={providerForm.models.image}
                          onChange={e => setProviderForm(prev => ({ ...prev, models: { ...prev.models, image: e.target.value } }))}
                          style={modernInputStyle}
                        />
                      </div>
                      <div>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>语音转写 (Audio)</span>
                        <input
                          type="text"
                          placeholder="mimo-v2.5"
                          value={providerForm.models.audio}
                          onChange={e => setProviderForm(prev => ({ ...prev, models: { ...prev.models, audio: e.target.value } }))}
                          style={modernInputStyle}
                        />
                      </div>
                      <div>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>笔记合并 (Merge)</span>
                        <input
                          type="text"
                          placeholder="deepseek-v4-flash"
                          value={providerForm.models.merge}
                          onChange={e => setProviderForm(prev => ({ ...prev, models: { ...prev.models, merge: e.target.value } }))}
                          style={modernInputStyle}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 展开面板底栏动作 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', borderTop: '1px solid #e2e8f0', paddingTop: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={handleTestProvider}
                        disabled={testState.status === 'testing'}
                        style={harnessSubtleButtonStyle}
                      >
                        {testState.status === 'testing' ? '测试中…' : '测试连接'}
                      </button>
                      {testState.status !== 'idle' && (
                        <span
                          style={{
                            fontSize: '11px',
                            color: testState.status === 'success' ? '#10b981' : testState.status === 'error' ? '#ef4444' : '#f59e0b',
                            fontWeight: 500,
                          }}
                        >
                          {testState.message}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setEditingProviderId(null)}
                        style={harnessSubtleButtonStyle}
                      >
                        收起
                      </button>
                      <button
                        type="submit"
                        disabled={saving}
                        style={{
                          background: '#2563eb',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '5px 14px',
                          fontSize: '12px',
                          fontWeight: 500,
                          cursor: 'pointer',
                        }}
                      >
                        {saving ? '保存中…' : '保存提供方'}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const formLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: '#334155',
  marginBottom: '4px',
}

const formHelpTextStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#94a3b8',
  margin: '3px 0 0 0',
  lineHeight: '1.4',
}

const modernInputStyle: React.CSSProperties = {
  width: '100%',
  fontSize: '13px',
  padding: '8px 10px',
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  background: '#ffffff',
  color: '#0f172a',
  outline: 'none',
  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
  transition: 'border-color 0.15s ease',
}

const harnessSubtleButtonStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  padding: '4px 12px',
  fontSize: '12px',
  color: '#1e293b',
  cursor: 'pointer',
  transition: 'all 0.12s ease',
}

const harnessDangerButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: '4px 10px',
  fontSize: '12px',
  color: '#ef4444',
  cursor: 'pointer',
  transition: 'all 0.12s ease',
}
