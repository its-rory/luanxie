import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Health } from '../types'

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

  ADMIN_PASSWORD: string

  AUTO_MERGE_EXISTING_CONFIDENCE: string
  AUTO_MERGE_NEW_CONFIDENCE: string
}

type TaskKey = 'text' | 'image' | 'audio' | 'merge'

interface ProviderPreset {
  name: string
  label: string
  baseUrl: string
  defaultHeaders: string
  models: Record<TaskKey, string>
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    name: 'OpenCodeGO',
    label: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    defaultHeaders: 'x-opencode-session: luanxie-session-affinity-01\nx-opencode-client: luanxie',
    models: {
      text: 'deepseek-v4-flash',
      image: 'deepseek-v4-flash-vision-exp',
      audio: 'mimo-v2.5',
      merge: 'deepseek-v4-flash',
    }
  },
  {
    name: 'siliconflow',
    label: 'SiliconFlow 硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultHeaders: '',
    models: {
      text: 'deepseek-ai/DeepSeek-V3',
      image: 'Qwen/Qwen3-VL-32B-Instruct',
      audio: 'FunAudioLLM/SenseVoiceSmall',
      merge: 'deepseek-ai/DeepSeek-V3',
    }
  },
  {
    name: 'openai',
    label: 'OpenAI 官方',
    baseUrl: 'https://api.openai.com/v1',
    defaultHeaders: '',
    models: {
      text: 'gpt-4o-mini',
      image: 'gpt-4o',
      audio: 'whisper-1',
      merge: 'gpt-4o',
    }
  },
  {
    name: 'anthropic',
    label: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultHeaders: '',
    models: {
      text: 'claude-3-5-haiku-latest',
      image: 'claude-3-5-sonnet-latest',
      audio: '',
      merge: 'claude-3-5-sonnet-latest',
    }
  },
]

export default function SettingsPage({ showToast, onLogout }: { showToast: (m: string) => void; onLogout: () => void }) {
  const [health, setHealth] = useState<Health | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [loadingSettings, setLoadingSettings] = useState(false)
  const [saving, setSaving] = useState(false)

  // Settings Form State
  const [settings, setSettings] = useState<SettingsState>({
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
    ADMIN_PASSWORD: '',
    AUTO_MERGE_EXISTING_CONFIDENCE: 'medium',
    AUTO_MERGE_NEW_CONFIDENCE: 'high',
  })

  // 折叠状态控制：各个任务模块是否展开参数
  const [expandedSections, setExpandedSections] = useState<Record<TaskKey, boolean>>({
    text: true,
    image: true,
    audio: true,
    merge: true,
  })

  const toggleSection = (task: TaskKey) => {
    setExpandedSections(prev => ({ ...prev, [task]: !prev[task] }))
  }

  // Test states for each of the 4 sections: 'idle' | 'testing' | 'success' | 'error'
  const [testStates, setTestStates] = useState<Record<string, { status: string; message: string }>>({
    text: { status: 'idle', message: '' },
    image: { status: 'idle', message: '' },
    audio: { status: 'idle', message: '' },
    merge: { status: 'idle', message: '' },
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
      const data = await api.getSettings()
      setSettings({
        TEXT_PROVIDER_NAME: data.TEXT_PROVIDER_NAME || '',
        TEXT_API_KEY: data.TEXT_API_KEY || '',
        TEXT_BASE_URL: data.TEXT_BASE_URL || '',
        TEXT_MODEL: data.TEXT_MODEL || '',
        TEXT_HEADERS: data.TEXT_HEADERS || '',
        IMAGE_PROVIDER_NAME: data.IMAGE_PROVIDER_NAME || '',
        IMAGE_API_KEY: data.IMAGE_API_KEY || '',
        IMAGE_BASE_URL: data.IMAGE_BASE_URL || '',
        IMAGE_MODEL: data.IMAGE_MODEL || '',
        IMAGE_HEADERS: data.IMAGE_HEADERS || '',
        AUDIO_PROVIDER_NAME: data.AUDIO_PROVIDER_NAME || '',
        AUDIO_API_KEY: data.AUDIO_API_KEY || '',
        AUDIO_BASE_URL: data.AUDIO_BASE_URL || '',
        AUDIO_MODEL: data.AUDIO_MODEL || '',
        AUDIO_HEADERS: data.AUDIO_HEADERS || '',
        MERGE_PROVIDER_NAME: data.MERGE_PROVIDER_NAME || '',
        MERGE_API_KEY: data.MERGE_API_KEY || '',
        MERGE_BASE_URL: data.MERGE_BASE_URL || '',
        MERGE_MODEL: data.MERGE_MODEL || '',
        MERGE_HEADERS: data.MERGE_HEADERS || '',
        ADMIN_PASSWORD: data.ADMIN_PASSWORD || '',
        AUTO_MERGE_EXISTING_CONFIDENCE: data.AUTO_MERGE_EXISTING_CONFIDENCE || 'medium',
        AUTO_MERGE_NEW_CONFIDENCE: data.AUTO_MERGE_NEW_CONFIDENCE || 'high',
      })
      // Reset test states
      setTestStates({
        text: { status: 'idle', message: '' },
        image: { status: 'idle', message: '' },
        audio: { status: 'idle', message: '' },
        merge: { status: 'idle', message: '' },
      })
      setShowModal(true)
    } catch (e) {
      showToast('获取 API 配置失败: ' + (e as Error).message)
    } finally {
      setLoadingSettings(false)
    }
  }

  const applyPreset = (task: TaskKey, preset: ProviderPreset) => {
    const keyPrefix = task.toUpperCase()
    setSettings(prev => ({
      ...prev,
      [`${keyPrefix}_PROVIDER_NAME`]: preset.name,
      [`${keyPrefix}_BASE_URL`]: preset.baseUrl,
      [`${keyPrefix}_MODEL`]: preset.models[task] || prev[`${keyPrefix}_MODEL` as keyof SettingsState],
      [`${keyPrefix}_HEADERS`]: preset.defaultHeaders,
    }))
    // 自动展开该模块以供查看
    setExpandedSections(prev => ({ ...prev, [task]: true }))
    setTestStates(prev => ({ ...prev, [task]: { status: 'idle', message: '' } }))
  }

  const handleTest = async (task: TaskKey) => {
    const keyPrefix = task.toUpperCase()
    const provider = settings[`${keyPrefix}_PROVIDER_NAME` as keyof SettingsState] || ''
    const api_key = settings[`${keyPrefix}_API_KEY` as keyof SettingsState] || ''
    const base_url = settings[`${keyPrefix}_BASE_URL` as keyof SettingsState] || ''
    const model = settings[`${keyPrefix}_MODEL` as keyof SettingsState] || ''
    const headers = settings[`${keyPrefix}_HEADERS` as keyof SettingsState] || ''

    if (!api_key) {
      setTestStates(prev => ({ ...prev, [task]: { status: 'error', message: 'API Key 不能为空' } }))
      return
    }

    setTestStates(prev => ({ ...prev, [task]: { status: 'testing', message: '测试中…' } }))
    try {
      const res = await api.testSettings({ task, provider, api_key, base_url, model, headers })
      if (res.ok) {
        setTestStates(prev => ({ ...prev, [task]: { status: 'success', message: '连接成功 ✓' } }))
      } else {
        setTestStates(prev => ({ ...prev, [task]: { status: 'error', message: res.error || '测试失败' } }))
      }
    } catch (e) {
      setTestStates(prev => ({ ...prev, [task]: { status: 'error', message: (e as Error).message } }))
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.saveSettings(settings as any)
      showToast('API 配置保存成功！')
      setShowModal(false)
      loadHealth()
    } catch (e: any) {
      showToast(e.message || '部分接口验证未通过，请检查配置')
    } finally {
      setSaving(false)
    }
  }

  const handleInputChange = (key: keyof SettingsState, val: string) => {
    setSettings(prev => ({ ...prev, [key]: val }))
    const task = key.split('_')[0].toLowerCase()
    if (['text', 'image', 'audio', 'merge'].includes(task)) {
      setTestStates(prev => ({ ...prev, [task]: { status: 'idle', message: '' } }))
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

  const renderSection = (
    task: TaskKey,
    title: string,
    defaultModelPlaceholder: string
  ) => {
    const pfx = task.toUpperCase()
    const isExpanded = expandedSections[task]
    const testState = testStates[task]
    const currentProvider = settings[`${pfx}_PROVIDER_NAME` as keyof SettingsState]

    return (
      <div
        key={task}
        style={{
          border: '1px solid var(--line)',
          borderRadius: '10px',
          padding: '12px',
          background: 'var(--paper-deep)',
          transition: 'all 0.2s ease',
        }}
      >
        {/* Section Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => toggleSection(task)}>
            <span style={{ fontFamily: 'var(--serif)', fontWeight: 'bold', fontSize: '15px', color: 'var(--ink)' }}>
              {title}
            </span>
            {currentProvider && (
              <span
                style={{
                  fontSize: '11px',
                  background: 'var(--paper-card)',
                  border: '1px solid var(--line)',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  color: 'var(--ink-soft)',
                }}
              >
                {currentProvider}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleSection(task) }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--ink-faint)',
                cursor: 'pointer',
                fontSize: '12px',
                padding: '2px 4px',
              }}
            >
              {isExpanded ? '收起 ▴' : '展开参数 ▾'}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {testState.status !== 'idle' && (
              <span
                style={{
                  fontSize: '11px',
                  color: testState.status === 'success' ? 'var(--moss)' : testState.status === 'error' ? 'var(--cinnabar)' : 'var(--ochre)',
                  fontWeight: '500',
                  maxWidth: '180px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={testState.message}
              >
                {testState.message}
              </span>
            )}
            <button
              type="button"
              className="btn small ghost"
              style={{ padding: '2px 8px', fontSize: '11px' }}
              onClick={() => handleTest(task)}
              disabled={testState.status === 'testing'}
            >
              {testState.status === 'testing' ? '测试中…' : '测试'}
            </button>
          </div>
        </div>

        {/* Quick Presets Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: isExpanded ? '12px' : '0', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>快捷预设:</span>
          {PROVIDER_PRESETS.map((preset) => {
            const isActive = currentProvider.toLowerCase() === preset.name.toLowerCase()
            return (
              <button
                key={preset.name}
                type="button"
                onClick={() => applyPreset(task, preset)}
                style={{
                  background: isActive ? 'var(--ink)' : 'var(--paper-card)',
                  color: isActive ? '#fff' : 'var(--ink-soft)',
                  border: '1px solid var(--line)',
                  borderRadius: '4px',
                  padding: '2px 7px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {preset.label}
              </button>
            )
          })}
        </div>

        {/* Collapsible Parameters Body */}
        {isExpanded && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px dashed var(--line)', paddingTop: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>模型供应商 (Provider)</label>
                <input
                  type="text"
                  placeholder="OpenCodeGO / siliconflow"
                  value={settings[`${pfx}_PROVIDER_NAME` as keyof SettingsState]}
                  onChange={e => handleInputChange(`${pfx}_PROVIDER_NAME` as keyof SettingsState, e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>模型名 (Model)</label>
                <input
                  type="text"
                  placeholder={defaultModelPlaceholder}
                  value={settings[`${pfx}_MODEL` as keyof SettingsState]}
                  onChange={e => handleInputChange(`${pfx}_MODEL` as keyof SettingsState, e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>API Base URL (端点)</label>
              <input
                type="text"
                placeholder="https://opencode.ai/zen/go/v1"
                value={settings[`${pfx}_BASE_URL` as keyof SettingsState]}
                onChange={e => handleInputChange(`${pfx}_BASE_URL` as keyof SettingsState, e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>API Key (密钥)</label>
              <input
                type="password"
                placeholder="sk-..."
                value={settings[`${pfx}_API_KEY` as keyof SettingsState]}
                onChange={e => handleInputChange(`${pfx}_API_KEY` as keyof SettingsState, e.target.value)}
                style={inputStyle}
              />
            </div>

            {/* Custom Headers Textarea */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>
                  自定义请求头 (Headers)
                </label>
                <span style={{ fontSize: '10px', color: 'var(--ink-faint)' }}>
                  支持每行 Key: Value 或 JSON 对象
                </span>
              </div>
              <textarea
                rows={3}
                placeholder={"x-opencode-session: luanxie-session-affinity-01\nx-opencode-client: luanxie"}
                value={settings[`${pfx}_HEADERS` as keyof SettingsState]}
                onChange={e => handleInputChange(`${pfx}_HEADERS` as keyof SettingsState, e.target.value)}
                style={{
                  ...inputStyle,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: '12px',
                  lineHeight: '1.4',
                  resize: 'vertical',
                }}
              />
            </div>
          </div>
        )}
      </div>
    )
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
                background: health.api_key_set ? 'var(--moss)' : 'var(--cinnabar)',
                color: '#fff',
                borderColor: health.api_key_set ? 'var(--moss)' : 'var(--cinnabar)',
                padding: '4px 10px',
                fontSize: '11px',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
                transition: 'opacity 0.15s',
              }}
              onMouseOver={(e) => (e.currentTarget.style.opacity = '0.85')}
              onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
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
          style={{ width: '100%', padding: '10px', borderRadius: '10px' }}
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

      {/* Modal Dialog */}
      {showModal && (
        <div
          className="modal-overlay"
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(43, 38, 32, 0.4)',
            backdropFilter: 'blur(5px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '20px'
          }}
        >
          <div
            className="modal-content"
            style={{
              background: 'var(--paper-card)',
              border: '1px solid var(--line)',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '560px',
              maxHeight: '88vh',
              overflowY: 'auto',
              padding: '22px',
              boxShadow: '0 12px 40px rgba(43,38,32,0.22)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>
              <h3 style={{ fontFamily: 'var(--serif)', fontSize: '20px', fontWeight: 900 }}>配置 AI 模型供应商与 API</h3>
              <button
                onClick={() => setShowModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: 'var(--ink-faint)' }}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                {/* 0. 管理员密码 */}
                <div style={{ border: '1px solid var(--line)', borderRadius: '10px', padding: '12px', background: 'var(--paper-deep)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontFamily: 'var(--serif)', fontWeight: 'bold', fontSize: '15px', color: 'var(--ink)' }}>管理员密码 (Admin)</span>
                    <span style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>留空或保持 ••• 即不修改</span>
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>新密码(至少 6 位,勿用 admin)</label>
                    <input
                      type="password"
                      placeholder="留空(或保持 •••)=不修改"
                      value={settings.ADMIN_PASSWORD}
                      onChange={e => handleInputChange('ADMIN_PASSWORD', e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </div>

                {/* 1. 文字分类 */}
                {renderSection('text', '文字分类 (Text)', 'deepseek-v4-flash')}

                {/* 2. 图像识别 */}
                {renderSection('image', '图像识别 (Image)', 'deepseek-v4-flash-vision-exp')}

                {/* 3. 语音转写 */}
                {renderSection('audio', '语音转写 (Audio)', 'mimo-v2.5')}

                {/* 4. 笔记合并 */}
                {renderSection('merge', '笔记合并 (Merge)', 'deepseek-v4-flash')}

              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', borderTop: '1px solid var(--line)', paddingTop: '14px' }}>
                <button type="button" className="btn ghost" disabled={saving} onClick={() => setShowModal(false)}>取消</button>
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? '保存中…' : '保存配置'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  marginTop: '3px',
  fontSize: '13px',
  padding: '6px 8px',
  border: '1px solid var(--line)',
  borderRadius: '6px',
  background: 'var(--paper-card)',
  color: 'var(--ink)',
  outline: 'none',
}
