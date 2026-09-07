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
  models: string[]
  active?: boolean
}

export interface ModelGroupsConfig {
  text: { providerId: string; model: string }
  image: { providerId: string; model: string }
  audio: { providerId: string; model: string }
  merge: { providerId: string; model: string }
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
  MODEL_GROUPS: string

  ADMIN_PASSWORD: string

  AUTO_MERGE_EXISTING_CONFIDENCE: string
  AUTO_MERGE_NEW_CONFIDENCE: string
}

export default function SettingsPage({ showToast, onLogout }: { showToast: (m: string) => void; onLogout: () => void }) {
  const [health, setHealth] = useState<Health | null>(null)
  const [showApiModal, setShowApiModal] = useState(false)
  const [showGroupsModal, setShowGroupsModal] = useState(false)
  const [loadingSettings, setLoadingSettings] = useState(false)
  const [saving, setSaving] = useState(false)

  // 原始设置数据
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
    MODEL_GROUPS: '',
    ADMIN_PASSWORD: '',
    AUTO_MERGE_EXISTING_CONFIDENCE: 'medium',
    AUTO_MERGE_NEW_CONFIDENCE: 'high',
  })

  // 管理员密码临时编辑
  const [adminPassword, setAdminPassword] = useState('')

  // 供应商列表
  const [providers, setProviders] = useState<ModelProvider[]>([])

  // 模型分组设置
  const [modelGroups, setModelGroups] = useState<ModelGroupsConfig>({
    text: { providerId: '', model: '' },
    image: { providerId: '', model: '' },
    audio: { providerId: '', model: '' },
    merge: { providerId: '', model: '' },
  })

  // 当前正在编辑的供应商（null 表示未展开编辑，'new' 表示新建，其余为编辑指定 id）
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [newModelInput, setNewModelInput] = useState('')
  const [providerForm, setProviderForm] = useState<ModelProvider>({
    id: '',
    name: '',
    baseUrl: '',
    apiKey: '',
    protocol: 'openai-completions',
    headers: '',
    models: [],
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
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    setLoadingSettings(true)
    try {
      const data = (await api.getSettings()) as any
      setRawSettings(data)
      setAdminPassword(data.ADMIN_PASSWORD || '')

      // 1. 解析模型供应商
      let parsedProviders: ModelProvider[] = []
      if (data.MODEL_PROVIDERS) {
        try {
          const raw = JSON.parse(data.MODEL_PROVIDERS)
          if (Array.isArray(raw)) {
            parsedProviders = raw.map((p: any) => {
              let models: string[] = []
              if (Array.isArray(p.models)) {
                models = p.models.map((m: any) => String(m).trim()).filter(Boolean)
              } else if (p.models && typeof p.models === 'object') {
                models = Array.from(new Set(Object.values(p.models).map((m: any) => String(m).trim()).filter(Boolean))) as string[]
              }
              return {
                id: p.id || '',
                name: p.name || '',
                baseUrl: p.baseUrl || '',
                apiKey: p.apiKey || '',
                protocol: p.protocol || 'openai-completions',
                headers: p.headers || '',
                models: models.length > 0 ? models : ['deepseek-v4-flash'],
                active: Boolean(p.active),
              }
            })
          }
        } catch {
          parsedProviders = []
        }
      }

      // 若未存储供应商列表，则添加默认的 opencode-go 与 deepseek 模版
      if (!parsedProviders || parsedProviders.length === 0) {
        parsedProviders = [
          {
            id: 'opencode-go',
            name: 'OpenCode Go',
            baseUrl: data.AUDIO_BASE_URL || 'https://opencode.ai/zen/go/v1',
            apiKey: data.AUDIO_API_KEY || '',
            protocol: 'openai-completions',
            headers: data.AUDIO_HEADERS || 'x-opencode-session: luanxie-session-affinity-01\nx-opencode-client: luanxie',
            models: ['zen/go/v1', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'mimo-v2.5'],
            active: true,
          },
          {
            id: 'deepseek',
            name: 'DeepSeek',
            baseUrl: 'https://api.deepseek.com/v1',
            apiKey: '',
            protocol: 'openai-completions',
            headers: '',
            models: ['deepseek-chat', 'deepseek-reasoner'],
            active: false,
          },
        ]
      }
      setProviders(parsedProviders)

      // 2. 解析模型分组
      let parsedGroups: ModelGroupsConfig = {
        text: { providerId: '', model: '' },
        image: { providerId: '', model: '' },
        audio: { providerId: '', model: '' },
        merge: { providerId: '', model: '' },
      }

      if (data.MODEL_GROUPS) {
        try {
          parsedGroups = JSON.parse(data.MODEL_GROUPS)
        } catch {}
      }

      const matchProvider = (nameOrId: string, baseUrl: string) => {
        return (
          parsedProviders.find(p => p.name === nameOrId || p.id === nameOrId || (baseUrl && p.baseUrl === baseUrl)) ||
          parsedProviders[0]
        )
      }

      if (!parsedGroups.text?.providerId && parsedProviders.length > 0) {
        const p = matchProvider(data.TEXT_PROVIDER_NAME, data.TEXT_BASE_URL)
        parsedGroups.text = { providerId: p.id, model: data.TEXT_MODEL || p.models[0] || '' }
      }
      if (!parsedGroups.image?.providerId && parsedProviders.length > 0) {
        const p = matchProvider(data.IMAGE_PROVIDER_NAME, data.IMAGE_BASE_URL)
        parsedGroups.image = { providerId: p.id, model: data.IMAGE_MODEL || p.models[0] || '' }
      }
      if (!parsedGroups.audio?.providerId && parsedProviders.length > 0) {
        const p = matchProvider(data.AUDIO_PROVIDER_NAME, data.AUDIO_BASE_URL)
        parsedGroups.audio = { providerId: p.id, model: data.AUDIO_MODEL || p.models[0] || '' }
      }
      if (!parsedGroups.merge?.providerId && parsedProviders.length > 0) {
        const p = matchProvider(data.MERGE_PROVIDER_NAME, data.MERGE_BASE_URL)
        parsedGroups.merge = { providerId: p.id, model: data.MERGE_MODEL || p.models[0] || '' }
      }

      setModelGroups(parsedGroups)
    } catch (e) {
      showToast('获取配置失败: ' + (e as Error).message)
    } finally {
      setLoadingSettings(false)
    }
  }

  // 开启添加供应商
  const handleAddNewProvider = () => {
    setProviderForm({
      id: `provider-${Date.now().toString().slice(-4)}`,
      name: '',
      baseUrl: '',
      apiKey: '',
      protocol: 'openai-completions',
      headers: '',
      models: ['deepseek-v4-flash'],
      active: providers.length === 0,
    })
    setNewModelInput('')
    setEditingProviderId('new')
    setTestState({ status: 'idle', message: '' })
  }

  // 开启编辑供应商
  const handleEditProvider = (p: ModelProvider) => {
    setProviderForm(JSON.parse(JSON.stringify(p)))
    setNewModelInput('')
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
    showToast('已切换生效提供商')
  }

  // 为当前编辑的供应商添加模型
  const handleAddModelTag = () => {
    const trimmed = newModelInput.trim()
    if (!trimmed) return
    if (providerForm.models.includes(trimmed)) {
      showToast('该模型已存在')
      return
    }
    setProviderForm(prev => ({
      ...prev,
      models: [...prev.models, trimmed],
    }))
    setNewModelInput('')
  }

  // 从当前编辑的供应商中移除模型
  const handleRemoveModelTag = (m: string) => {
    setProviderForm(prev => ({
      ...prev,
      models: prev.models.filter(item => item !== m),
    }))
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
      const newP = { ...providerForm, id: providerForm.id.trim() || `provider-${Date.now().toString().slice(-4)}` }
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

  // 将供应商列表持久化保存到后端
  const persistProvidersAndSave = async (provList: ModelProvider[], newAdminPw: string) => {
    const activeProv = provList.find(p => p.active) || provList[0]
    setSaving(true)
    try {
      const payload: any = {
        ...rawSettings,
        ADMIN_PASSWORD: newAdminPw,
        MODEL_PROVIDERS: JSON.stringify(provList),
      }

      if (activeProv) {
        if (!payload.TEXT_PROVIDER_NAME || payload.TEXT_PROVIDER_NAME === activeProv.name) {
          payload.TEXT_PROVIDER_NAME = activeProv.name || activeProv.id
          payload.TEXT_BASE_URL = activeProv.baseUrl
          if (activeProv.apiKey && activeProv.apiKey !== '••••••••') payload.TEXT_API_KEY = activeProv.apiKey
          payload.TEXT_HEADERS = activeProv.headers || ''
        }
        if (!payload.IMAGE_PROVIDER_NAME || payload.IMAGE_PROVIDER_NAME === activeProv.name) {
          payload.IMAGE_PROVIDER_NAME = activeProv.name || activeProv.id
          payload.IMAGE_BASE_URL = activeProv.baseUrl
          if (activeProv.apiKey && activeProv.apiKey !== '••••••••') payload.IMAGE_API_KEY = activeProv.apiKey
          payload.IMAGE_HEADERS = activeProv.headers || ''
        }
        if (!payload.AUDIO_PROVIDER_NAME || payload.AUDIO_PROVIDER_NAME === activeProv.name) {
          payload.AUDIO_PROVIDER_NAME = activeProv.name || activeProv.id
          payload.AUDIO_BASE_URL = activeProv.baseUrl
          if (activeProv.apiKey && activeProv.apiKey !== '••••••••') payload.AUDIO_API_KEY = activeProv.apiKey
          payload.AUDIO_HEADERS = activeProv.headers || ''
        }
        if (!payload.MERGE_PROVIDER_NAME || payload.MERGE_PROVIDER_NAME === activeProv.name) {
          payload.MERGE_PROVIDER_NAME = activeProv.name || activeProv.id
          payload.MERGE_BASE_URL = activeProv.baseUrl
          if (activeProv.apiKey && activeProv.apiKey !== '••••••••') payload.MERGE_API_KEY = activeProv.apiKey
          payload.MERGE_HEADERS = activeProv.headers || ''
        }
      }

      await api.saveSettings(payload)
      setRawSettings(payload)
      loadHealth()
    } catch (e: any) {
      showToast('保存供应商失败: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  // 保存模型分组配置
  const handleSaveModelGroups = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (providers.length === 0) {
      showToast('请先在 API 接口参数中添加模型供应商')
      return
    }

    const getProv = (id: string) => providers.find(p => p.id === id) || providers[0]

    const textP = getProv(modelGroups.text?.providerId)
    const imgP = getProv(modelGroups.image?.providerId)
    const audioP = getProv(modelGroups.audio?.providerId)
    const mergeP = getProv(modelGroups.merge?.providerId)

    if (!textP || !imgP || !audioP || !mergeP) {
      showToast('请先为所有功能指定供应商')
      return
    }

    setSaving(true)
    try {
      const payload: any = {
        ...rawSettings,
        MODEL_PROVIDERS: JSON.stringify(providers),
        MODEL_GROUPS: JSON.stringify(modelGroups),

        TEXT_PROVIDER_NAME: textP.name || textP.id,
        TEXT_BASE_URL: textP.baseUrl,
        TEXT_MODEL: modelGroups.text.model || textP.models[0] || 'deepseek-v4-flash',
        TEXT_HEADERS: textP.headers || '',

        IMAGE_PROVIDER_NAME: imgP.name || imgP.id,
        IMAGE_BASE_URL: imgP.baseUrl,
        IMAGE_MODEL: modelGroups.image.model || imgP.models[0] || 'deepseek-v4-flash-vision-exp',
        IMAGE_HEADERS: imgP.headers || '',

        AUDIO_PROVIDER_NAME: audioP.name || audioP.id,
        AUDIO_BASE_URL: audioP.baseUrl,
        AUDIO_MODEL: modelGroups.audio.model || audioP.models[0] || 'mimo-v2.5',
        AUDIO_HEADERS: audioP.headers || '',

        MERGE_PROVIDER_NAME: mergeP.name || mergeP.id,
        MERGE_BASE_URL: mergeP.baseUrl,
        MERGE_MODEL: modelGroups.merge.model || mergeP.models[0] || 'deepseek-v4-flash',
        MERGE_HEADERS: mergeP.headers || '',
      }

      if (textP.apiKey && textP.apiKey !== '••••••••') payload.TEXT_API_KEY = textP.apiKey
      if (imgP.apiKey && imgP.apiKey !== '••••••••') payload.IMAGE_API_KEY = imgP.apiKey
      if (audioP.apiKey && audioP.apiKey !== '••••••••') payload.AUDIO_API_KEY = audioP.apiKey
      if (mergeP.apiKey && mergeP.apiKey !== '••••••••') payload.MERGE_API_KEY = mergeP.apiKey

      await api.saveSettings(payload)
      setRawSettings(payload)
      setShowGroupsModal(false)
      showToast('模型分组配置已成功保存！')
      loadHealth()
    } catch (e: any) {
      showToast('保存模型分组失败: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  // 保存管理员密码
  const handleSaveAdminPassword = async () => {
    if (!adminPassword.trim()) {
      showToast('密码不能为空')
      return
    }
    try {
      const payload = {
        ...rawSettings,
        ADMIN_PASSWORD: adminPassword.trim(),
      }
      await api.saveSettings(payload)
      setRawSettings(payload)
      showToast('管理员密码已更新')
    } catch (e: any) {
      showToast('更新密码失败: ' + e.message)
    }
  }

  // 测试正在编辑的供应商连通性
  const handleTestProvider = async () => {
    const apiKey = providerForm.apiKey || rawSettings.AUDIO_API_KEY || ''
    if (!apiKey) {
      setTestState({ status: 'error', message: 'API Key 不能为空' })
      return
    }

    const testModel = providerForm.models[0] || 'deepseek-v4-flash'
    setTestState({ status: 'testing', message: '测试连接中…' })
    try {
      const res = await api.testSettings({
        task: 'text',
        provider: providerForm.name || providerForm.id,
        api_key: apiKey,
        base_url: providerForm.baseUrl,
        model: testModel,
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
    setHealth(prev => (prev ? { ...prev, auto_merge_existing_confidence: nextVal } : null))
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
    setHealth(prev => (prev ? { ...prev, auto_merge_new_confidence: nextVal } : null))
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

  // 判断 API 接口参数是否已配置
  const isApiConfigured = Boolean(
    health?.api_key_set ||
      (providers.length > 0 && providers.some(p => Boolean(p.baseUrl && p.apiKey && p.apiKey !== '••••••••'))) ||
      rawSettings.TEXT_API_KEY ||
      rawSettings.AUDIO_API_KEY
  )

  // 判断模型分组是否已完整配置
  const isGroupsConfigured = Boolean(
    providers.length > 0 &&
      modelGroups.text?.providerId &&
      modelGroups.text?.model &&
      modelGroups.image?.providerId &&
      modelGroups.image?.model &&
      modelGroups.audio?.providerId &&
      modelGroups.audio?.model &&
      modelGroups.merge?.providerId &&
      modelGroups.merge?.model
  )

  return (
    <div className="fade-in">
      <div className="section-title">设置</div>

      {health && (
        <div className="card" style={{ padding: '8px 16px' }}>
          {/* 1. API 接口参数 */}
          <div className="kv" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="k">API 接口参数</span>
            <button
              type="button"
              onClick={() => setShowApiModal(true)}
              disabled={loadingSettings}
              style={{
                background: isApiConfigured ? '#10b981' : '#ef4444',
                border: `1px solid ${isApiConfigured ? '#059669' : '#dc2626'}`,
                color: '#ffffff',
                padding: '4px 10px',
                fontSize: '11px',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                transition: 'opacity 0.15s ease',
              }}
              onMouseOver={e => (e.currentTarget.style.opacity = '0.88')}
              onMouseOut={e => (e.currentTarget.style.opacity = '1')}
            >
              {loadingSettings ? '读取中…' : isApiConfigured ? '已配置 ✓' : '未配置 ✗'}
            </button>
          </div>

          {/* 2. 模型分组 */}
          <div className="kv" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="k">模型分组</span>
            <button
              type="button"
              onClick={() => setShowGroupsModal(true)}
              disabled={loadingSettings}
              style={{
                background: isGroupsConfigured ? '#10b981' : '#ef4444',
                border: `1px solid ${isGroupsConfigured ? '#059669' : '#dc2626'}`,
                color: '#ffffff',
                padding: '4px 10px',
                fontSize: '11px',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                transition: 'opacity 0.15s ease',
              }}
              onMouseOver={e => (e.currentTarget.style.opacity = '0.88')}
              onMouseOut={e => (e.currentTarget.style.opacity = '1')}
            >
              {loadingSettings ? '读取中…' : isGroupsConfigured ? '已配置 ✓' : '未配置 ✗'}
            </button>
          </div>

          {/* 3. 语音转写 */}
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

          {/* 4. 归类至已有主题门槛 */}
          <div className="kv" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="k">归类至已有主题门槛</span>
            <button
              type="button"
              onClick={cycleExistingConfidence}
              style={roundedBorderButtonStyle}
            >
              {{ low: '全自动', medium: '中置信及以上', high: '高置信才自动', never: '从不自动' }[health.auto_merge_existing_confidence] || health.auto_merge_existing_confidence}
            </button>
          </div>

          {/* 5. 归类为全新主题门槛 */}
          <div className="kv" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="k">归类为全新主题门槛</span>
            <button
              type="button"
              onClick={cycleNewConfidence}
              style={roundedBorderButtonStyle}
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

      {/* 退出登录 */}
      <div style={{ padding: '8px 0 16px' }}>
        <button
          type="button"
          style={{
            width: '100%',
            padding: '10px',
            border: '1px solid #fca5a5',
            borderRadius: '8px',
            background: '#ffffff',
            color: '#ef4444',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
            transition: 'all 0.15s ease',
          }}
          onMouseOver={e => {
            e.currentTarget.style.background = '#fef2f2'
            e.currentTarget.style.borderColor = '#f87171'
          }}
          onMouseOut={e => {
            e.currentTarget.style.background = '#ffffff'
            e.currentTarget.style.borderColor = '#fca5a5'
          }}
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

      <div className="empty" style={{ padding: '24px 20px', fontSize: 12 }}>
        乱写 · 随手碎念与拍照，自动归档并提取白板文字<br />
        系统将在后台自动合并、重构、维护关联双链
      </div>

      {/* ========================================================================= */}
      {/* 弹窗 1：API 接口参数管理 */}
      {/* ========================================================================= */}
      {showApiModal && (
        <div className="modal-overlay" style={overlayStyle}>
          <div className="modal-content" style={modalBoxStyle}>
            {/* Modal Header */}
            <div style={modalHeaderStyle}>
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', margin: 0 }}>API 接口参数</h3>
                <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0 0' }}>
                  填入各提供方的 API 密钥与地址，统一在此集中管理。
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowApiModal(false)
                  setEditingProviderId(null)
                }}
                style={closeButtonStyle}
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
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>管理员密码</span>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>保护接口配置与核心设置</span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="password"
                  placeholder="留空保持不变 (至少 6 位)"
                  value={adminPassword}
                  onChange={e => setAdminPassword(e.target.value)}
                  style={modernInputStyle}
                />
                <button
                  type="button"
                  onClick={handleSaveAdminPassword}
                  style={roundedBorderButtonStyle}
                >
                  保存
                </button>
              </div>
            </div>

            {/* 模型供应商列表 (模型A、模型B...) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>已配置供应商</div>
              {providers.map(p => {
                const isKeySet = Boolean(p.apiKey && p.apiKey !== '')
                return (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      border: p.active ? '1.5px solid #93c5fd' : '1px solid #e2e8f0',
                      borderRadius: '10px',
                      padding: '10px 14px',
                      background: p.active ? '#f8fafc' : '#ffffff',
                      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.02)',
                    }}
                  >
                    {/* 左侧：文字与状态点 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
                        {p.name || p.id}
                      </span>
                      <span
                        style={{
                          display: 'inline-block',
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: isKeySet ? '#10b981' : '#ef4444',
                        }}
                        title={isKeySet ? '已填密钥' : '未填密钥'}
                      />
                      <span
                        style={{
                          fontSize: '11px',
                          color: '#64748b',
                          background: '#f1f5f9',
                          border: '1px solid #e2e8f0',
                          padding: '1px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        {p.models.length} 个模型
                      </span>
                      {p.active && (
                        <span
                          style={{
                            fontSize: '11px',
                            color: '#2563eb',
                            background: '#eff6ff',
                            border: '1px solid #bfdbfe',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontWeight: 500,
                          }}
                        >
                          默认
                        </span>
                      )}
                    </div>

                    {/* 右侧：按钮组 (使用、编辑、删除) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {!p.active && (
                        <button
                          type="button"
                          onClick={() => handleActivateProvider(p.id)}
                          style={{
                            ...roundedBorderButtonStyle,
                            background: '#eff6ff',
                            borderColor: '#bfdbfe',
                            color: '#2563eb',
                          }}
                          title="设为默认供应商"
                        >
                          设为默认
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleEditProvider(p)}
                        style={roundedBorderButtonStyle}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteProvider(p.id)}
                        style={{
                          ...roundedBorderButtonStyle,
                          borderColor: '#fca5a5',
                          color: '#ef4444',
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* 模型A、B下面一行是靠右的按钮：增加模型供应商 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '-2px' }}>
              <button
                type="button"
                onClick={handleAddNewProvider}
                style={{
                  ...roundedBorderButtonStyle,
                  padding: '6px 14px',
                  fontWeight: 500,
                }}
              >
                + 增加模型供应商
              </button>
            </div>

            {/* 点击后展开全宽页面（自定义提供方 / 编辑提供方） */}
            {editingProviderId !== null && (
              <div
                style={{
                  border: '1px solid #cbd5e1',
                  borderRadius: '12px',
                  padding: '16px',
                  background: '#f8fafc',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.02)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
                  <h4 style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a', margin: 0 }}>
                    {editingProviderId === 'new' ? '增加模型供应商' : `编辑提供方 · ${providerForm.name || providerForm.id}`}
                  </h4>
                  <button
                    type="button"
                    onClick={() => setEditingProviderId(null)}
                    style={closeButtonStyle}
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
                      placeholder="如 opencode-go / custom-01"
                      value={providerForm.id}
                      onChange={e => setProviderForm(prev => ({ ...prev, id: e.target.value }))}
                      style={modernInputStyle}
                    />
                    <p style={formHelpTextStyle}>小写字母与短横杠组成的唯一标识。</p>
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
                      placeholder="https://opencode.ai/zen/go/v1"
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

                  {/* 自定义请求头 */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={formLabelStyle}>自定义请求头 (Headers)</label>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>支持多行 Key: Value 格式</span>
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
                      用于特定服务商的认证或路由要求（如 OpenCode Go 需指定 x-opencode-session）。
                    </p>
                  </div>

                  {/* 可用模型列表管理 (支持手动添加并保存) */}
                  <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={formLabelStyle}>可用模型列表</label>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>添加后可在“模型分组”中指定选用</span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                      <input
                        type="text"
                        placeholder="输入模型名，如 deepseek-v4-flash"
                        value={newModelInput}
                        onChange={e => setNewModelInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleAddModelTag()
                          }
                        }}
                        style={modernInputStyle}
                      />
                      <button
                        type="button"
                        onClick={handleAddModelTag}
                        style={{
                          ...roundedBorderButtonStyle,
                          padding: '6px 14px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        + 添加模型
                      </button>
                    </div>

                    {/* 已添加模型列表标签 */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
                      {providerForm.models.length === 0 && (
                        <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                          暂无模型，请在上方输入模型名后点击“添加模型”。
                        </span>
                      )}
                      {providerForm.models.map(m => (
                        <span
                          key={m}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            background: '#ffffff',
                            border: '1px solid #cbd5e1',
                            borderRadius: '16px',
                            padding: '3px 10px',
                            fontSize: '12px',
                            color: '#1e293b',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                          }}
                        >
                          <span>{m}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveModelTag(m)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#94a3b8',
                              cursor: 'pointer',
                              padding: '0 2px',
                              fontSize: '14px',
                              lineHeight: 1,
                            }}
                            title="删除该模型"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* 展开面板底栏动作 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', borderTop: '1px solid #e2e8f0', paddingTop: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={handleTestProvider}
                        disabled={testState.status === 'testing'}
                        style={roundedBorderButtonStyle}
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
                        style={roundedBorderButtonStyle}
                      >
                        收起
                      </button>
                      <button
                        type="submit"
                        disabled={saving}
                        style={{
                          background: '#2563eb',
                          color: '#fff',
                          border: '1px solid #1d4ed8',
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

      {/* ========================================================================= */}
      {/* 弹窗 2：模型分组管理 (按功能分配指定的模型供应商与模型) */}
      {/* ========================================================================= */}
      {showGroupsModal && (
        <div className="modal-overlay" style={overlayStyle}>
          <div className="modal-content" style={modalBoxStyle}>
            {/* Modal Header */}
            <div style={modalHeaderStyle}>
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', margin: 0 }}>模型分组</h3>
                <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0 0' }}>
                  为各项功能分配指定的模型供应商与模型。只能选用供应商已添加的模型。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGroupsModal(false)}
                style={closeButtonStyle}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSaveModelGroups} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {providers.length === 0 && (
                <div style={{ padding: '12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '13px' }}>
                  当前尚未配置任何模型供应商，请先在“API 接口参数”中添加供应商及模型。
                </div>
              )}

              {/* 1. 文字模型 */}
              <div style={groupCardStyle}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>文字模型 (Text)</div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>用于便签文本归档、分类整理与主题标题生成</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={formLabelStyle}>选择模型供应商</label>
                    <select
                      value={modelGroups.text?.providerId || (providers[0]?.id || '')}
                      onChange={e => {
                        const newProvId = e.target.value
                        const p = providers.find(item => item.id === newProvId)
                        const nextModel = p && p.models.length > 0 ? p.models[0] : ''
                        setModelGroups(prev => ({
                          ...prev,
                          text: { providerId: newProvId, model: nextModel },
                        }))
                      }}
                      style={modernInputStyle}
                    >
                      {providers.map(p => (
                        <option key={p.id} value={p.id}>{p.name || p.id}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={formLabelStyle}>选用模型</label>
                    {(() => {
                      const curProv = providers.find(p => p.id === (modelGroups.text?.providerId || providers[0]?.id))
                      const availableModels = curProv?.models || []
                      return (
                        <select
                          value={modelGroups.text?.model || ''}
                          onChange={e => {
                            const val = e.target.value
                            setModelGroups(prev => ({
                              ...prev,
                              text: { ...prev.text, model: val },
                            }))
                          }}
                          style={modernInputStyle}
                        >
                          {availableModels.length === 0 && (
                            <option value="">(该供应商未添加模型)</option>
                          )}
                          {availableModels.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      )
                    })()}
                  </div>
                </div>
              </div>

              {/* 2. 图像模型 */}
              <div style={groupCardStyle}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>图像模型 (Image)</div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>用于白板拍照、图片文字提取与视觉内容理解</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={formLabelStyle}>选择模型供应商</label>
                    <select
                      value={modelGroups.image?.providerId || (providers[0]?.id || '')}
                      onChange={e => {
                        const newProvId = e.target.value
                        const p = providers.find(item => item.id === newProvId)
                        const nextModel = p && p.models.length > 0 ? p.models[0] : ''
                        setModelGroups(prev => ({
                          ...prev,
                          image: { providerId: newProvId, model: nextModel },
                        }))
                      }}
                      style={modernInputStyle}
                    >
                      {providers.map(p => (
                        <option key={p.id} value={p.id}>{p.name || p.id}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={formLabelStyle}>选用模型</label>
                    {(() => {
                      const curProv = providers.find(p => p.id === (modelGroups.image?.providerId || providers[0]?.id))
                      const availableModels = curProv?.models || []
                      return (
                        <select
                          value={modelGroups.image?.model || ''}
                          onChange={e => {
                            const val = e.target.value
                            setModelGroups(prev => ({
                              ...prev,
                              image: { ...prev.image, model: val },
                            }))
                          }}
                          style={modernInputStyle}
                        >
                          {availableModels.length === 0 && (
                            <option value="">(该供应商未添加模型)</option>
                          )}
                          {availableModels.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      )
                    })()}
                  </div>
                </div>
              </div>

              {/* 3. 语音模型 */}
              <div style={groupCardStyle}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>语音模型 (Audio)</div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>用于随手录音、音频转写为文本内容</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={formLabelStyle}>选择模型供应商</label>
                    <select
                      value={modelGroups.audio?.providerId || (providers[0]?.id || '')}
                      onChange={e => {
                        const newProvId = e.target.value
                        const p = providers.find(item => item.id === newProvId)
                        const nextModel = p && p.models.length > 0 ? p.models[0] : ''
                        setModelGroups(prev => ({
                          ...prev,
                          audio: { providerId: newProvId, model: nextModel },
                        }))
                      }}
                      style={modernInputStyle}
                    >
                      {providers.map(p => (
                        <option key={p.id} value={p.id}>{p.name || p.id}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={formLabelStyle}>选用模型</label>
                    {(() => {
                      const curProv = providers.find(p => p.id === (modelGroups.audio?.providerId || providers[0]?.id))
                      const availableModels = curProv?.models || []
                      return (
                        <select
                          value={modelGroups.audio?.model || ''}
                          onChange={e => {
                            const val = e.target.value
                            setModelGroups(prev => ({
                              ...prev,
                              audio: { ...prev.audio, model: val },
                            }))
                          }}
                          style={modernInputStyle}
                        >
                          {availableModels.length === 0 && (
                            <option value="">(该供应商未添加模型)</option>
                          )}
                          {availableModels.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      )
                    })()}
                  </div>
                </div>
              </div>

              {/* 4. 合并模型 */}
              <div style={groupCardStyle}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>合并模型 (Merge)</div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>用于便签与主题深度重构、自动维护双链</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={formLabelStyle}>选择模型供应商</label>
                    <select
                      value={modelGroups.merge?.providerId || (providers[0]?.id || '')}
                      onChange={e => {
                        const newProvId = e.target.value
                        const p = providers.find(item => item.id === newProvId)
                        const nextModel = p && p.models.length > 0 ? p.models[0] : ''
                        setModelGroups(prev => ({
                          ...prev,
                          merge: { providerId: newProvId, model: nextModel },
                        }))
                      }}
                      style={modernInputStyle}
                    >
                      {providers.map(p => (
                        <option key={p.id} value={p.id}>{p.name || p.id}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={formLabelStyle}>选用模型</label>
                    {(() => {
                      const curProv = providers.find(p => p.id === (modelGroups.merge?.providerId || providers[0]?.id))
                      const availableModels = curProv?.models || []
                      return (
                        <select
                          value={modelGroups.merge?.model || ''}
                          onChange={e => {
                            const val = e.target.value
                            setModelGroups(prev => ({
                              ...prev,
                              merge: { ...prev.merge, model: val },
                            }))
                          }}
                          style={modernInputStyle}
                        >
                          {availableModels.length === 0 && (
                            <option value="">(该供应商未添加模型)</option>
                          )}
                          {availableModels.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      )
                    })()}
                  </div>
                </div>
              </div>

              {/* 弹窗底栏保存按钮 */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px', borderTop: '1px solid #e2e8f0', paddingTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowGroupsModal(false)}
                  style={roundedBorderButtonStyle}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={saving || providers.length === 0}
                  style={{
                    background: '#2563eb',
                    color: '#ffffff',
                    border: '1px solid #1d4ed8',
                    borderRadius: '6px',
                    padding: '6px 16px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                  }}
                >
                  {saving ? '保存中…' : '保存分组配置'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(15, 23, 42, 0.45)',
  backdropFilter: 'blur(8px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: '20px',
}

const modalBoxStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '16px',
  width: '100%',
  maxWidth: '580px',
  maxHeight: '88vh',
  overflowY: 'auto',
  padding: '22px',
  boxShadow: '0 20px 45px rgba(0, 0, 0, 0.12)',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
}

const modalHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  borderBottom: '1px solid #f1f5f9',
  paddingBottom: '12px',
}

const groupCardStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: '10px',
  padding: '14px',
  background: '#f8fafc',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.02)',
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
  padding: '7px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: '8px',
  background: '#ffffff',
  color: '#0f172a',
  outline: 'none',
  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
  transition: 'border-color 0.15s ease',
}

const roundedBorderButtonStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #cbd5e1',
  borderRadius: '6px',
  padding: '4px 12px',
  fontSize: '12px',
  color: '#1e293b',
  cursor: 'pointer',
  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
  transition: 'all 0.12s ease',
}

const closeButtonStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '6px',
  width: '28px',
  height: '28px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '18px',
  color: '#94a3b8',
  cursor: 'pointer',
  padding: 0,
  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.02)',
}
