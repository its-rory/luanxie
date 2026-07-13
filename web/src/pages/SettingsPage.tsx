import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Health } from '../types'

interface SettingsState {
  TEXT_PROVIDER_NAME: string
  TEXT_API_KEY: string
  TEXT_BASE_URL: string
  TEXT_MODEL: string

  IMAGE_PROVIDER_NAME: string
  IMAGE_API_KEY: string
  IMAGE_BASE_URL: string
  IMAGE_MODEL: string

  AUDIO_PROVIDER_NAME: string
  AUDIO_API_KEY: string
  AUDIO_BASE_URL: string
  AUDIO_MODEL: string

  MERGE_PROVIDER_NAME: string
  MERGE_API_KEY: string
  MERGE_BASE_URL: string
  MERGE_MODEL: string
}

export default function SettingsPage({ showToast }: { showToast: (m: string) => void }) {
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
    IMAGE_PROVIDER_NAME: '',
    IMAGE_API_KEY: '',
    IMAGE_BASE_URL: '',
    IMAGE_MODEL: '',
    AUDIO_PROVIDER_NAME: '',
    AUDIO_API_KEY: '',
    AUDIO_BASE_URL: '',
    AUDIO_MODEL: '',
    MERGE_PROVIDER_NAME: '',
    MERGE_API_KEY: '',
    MERGE_BASE_URL: '',
    MERGE_MODEL: '',
  })

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
        IMAGE_PROVIDER_NAME: data.IMAGE_PROVIDER_NAME || '',
        IMAGE_API_KEY: data.IMAGE_API_KEY || '',
        IMAGE_BASE_URL: data.IMAGE_BASE_URL || '',
        IMAGE_MODEL: data.IMAGE_MODEL || '',
        AUDIO_PROVIDER_NAME: data.AUDIO_PROVIDER_NAME || '',
        AUDIO_API_KEY: data.AUDIO_API_KEY || '',
        AUDIO_BASE_URL: data.AUDIO_BASE_URL || '',
        AUDIO_MODEL: data.AUDIO_MODEL || '',
        MERGE_PROVIDER_NAME: data.MERGE_PROVIDER_NAME || '',
        MERGE_API_KEY: data.MERGE_API_KEY || '',
        MERGE_BASE_URL: data.MERGE_BASE_URL || '',
        MERGE_MODEL: data.MERGE_MODEL || '',
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

  const handleTest = async (task: 'text' | 'image' | 'audio' | 'merge') => {
    const keyPrefix = task.toUpperCase()
    const provider = settings[`${keyPrefix}_PROVIDER_NAME` as keyof SettingsState] || ''
    const api_key = settings[`${keyPrefix}_API_KEY` as keyof SettingsState] || ''
    const base_url = settings[`${keyPrefix}_BASE_URL` as keyof SettingsState] || ''
    const model = settings[`${keyPrefix}_MODEL` as keyof SettingsState] || ''

    if (!api_key) {
      setTestStates(prev => ({ ...prev, [task]: { status: 'error', message: 'API Key 不能为空' } }))
      return
    }

    setTestStates(prev => ({ ...prev, [task]: { status: 'testing', message: '测试中…' } }))
    try {
      const res = await api.testSettings({ task, provider, api_key, base_url, model })
      if (res.ok) {
        setTestStates(prev => ({ ...prev, [task]: { status: 'success', message: '连接成功' } }))
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
      // If server returns specific errors, populate them in test states
      if (e.message && typeof e.message === 'object') {
        const errors = e.message.errors || {}
        setTestStates(prev => {
          const next = { ...prev }
          for (const task of ['text', 'image', 'audio', 'merge']) {
            if (errors[task]) {
              next[task] = { status: 'error', message: errors[task] }
            }
          }
          return next
        })
      }
    } finally {
      setSaving(false)
    }
  }

  const handleInputChange = (key: keyof SettingsState, val: string) => {
    setSettings(prev => ({ ...prev, [key]: val }))
    // Reset test state for this task when edit occurs
    const task = key.split('_')[0].toLowerCase()
    setTestStates(prev => ({ ...prev, [task]: { status: 'idle', message: '' } }))
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
            <span className={`v ${health.whisper_installed ? 'ok' : 'warn'}`}>
              {health.whisper_installed ? '已安装' : '未安装'}
            </span>
          </div>
          <div className="kv">
            <span className="k">自动合并门槛</span>
            <span className="v">
              {{ high: '高置信才自动', medium: '中等以上自动', low: '全自动' }[health.auto_merge_confidence] || health.auto_merge_confidence}
            </span>
          </div>
          <div className="kv" style={{ borderBottom: 'none' }}>
            <span className="k">处理队列</span>
            <span className="v">{health.queue_depth} 条</span>
          </div>
        </div>
      )}

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
              maxWidth: '540px',
              maxHeight: '85vh',
              overflowY: 'auto',
              padding: '22px',
              boxShadow: '0 12px 40px rgba(43,38,32,0.22)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>
              <h3 style={{ fontFamily: 'var(--serif)', fontSize: '20px', fontWeight: 900 }}>配置 AI API 接口</h3>
              <button 
                onClick={() => setShowModal(false)} 
                style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: 'var(--ink-faint)' }}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Form container */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                
                {/* 1. TEXT */}
                <div style={{ border: '1px solid var(--line)', borderRadius: '10px', padding: '12px', background: 'var(--paper-deep)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontFamily: 'var(--serif)', fontWeight: 'bold', fontSize: '15px', color: 'var(--ink)' }}>文字分类 (Text)</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {testStates.text.status !== 'idle' && (
                        <span style={{ 
                          fontSize: '11px', 
                          color: testStates.text.status === 'success' ? 'var(--moss)' : testStates.text.status === 'error' ? 'var(--cinnabar)' : 'var(--ochre)',
                          fontWeight: '500'
                        }}>
                          {testStates.text.message}
                        </span>
                      )}
                      <button type="button" className="btn small ghost" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => handleTest('text')}>测试</button>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>Provider (可填任意名字)</label>
                      <input type="text" placeholder="openai" value={settings.TEXT_PROVIDER_NAME} onChange={e => handleInputChange('TEXT_PROVIDER_NAME', e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>模型名 (Model)</label>
                      <input type="text" placeholder="Qwen/Qwen2.5-7B-Instruct" value={settings.TEXT_MODEL} onChange={e => handleInputChange('TEXT_MODEL', e.target.value)} style={inputStyle} />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>API Base URL (端点)</label>
                    <input type="text" placeholder="https://api.siliconflow.cn/v1" value={settings.TEXT_BASE_URL} onChange={e => handleInputChange('TEXT_BASE_URL', e.target.value)} style={inputStyle} />
                  </div>
                  <div style={{ marginTop: '8px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>API Key</label>
                    <input type="password" placeholder="sk-..." value={settings.TEXT_API_KEY} onChange={e => handleInputChange('TEXT_API_KEY', e.target.value)} style={inputStyle} />
                  </div>
                </div>

                {/* 2. IMAGE */}
                <div style={{ border: '1px solid var(--line)', borderRadius: '10px', padding: '12px', background: 'var(--paper-deep)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontFamily: 'var(--serif)', fontWeight: 'bold', fontSize: '15px', color: 'var(--ink)' }}>图像识别 (Image)</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {testStates.image.status !== 'idle' && (
                        <span style={{ 
                          fontSize: '11px', 
                          color: testStates.image.status === 'success' ? 'var(--moss)' : testStates.image.status === 'error' ? 'var(--cinnabar)' : 'var(--ochre)',
                          fontWeight: '500'
                        }}>
                          {testStates.image.message}
                        </span>
                      )}
                      <button type="button" className="btn small ghost" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => handleTest('image')}>测试</button>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>Provider (可填任意名字)</label>
                      <input type="text" placeholder="openai" value={settings.IMAGE_PROVIDER_NAME} onChange={e => handleInputChange('IMAGE_PROVIDER_NAME', e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>模型名 (Model)</label>
                      <input type="text" placeholder="Qwen/Qwen3-VL-32B-Instruct" value={settings.IMAGE_MODEL} onChange={e => handleInputChange('IMAGE_MODEL', e.target.value)} style={inputStyle} />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>API Base URL (端点)</label>
                    <input type="text" placeholder="https://api.siliconflow.cn/v1" value={settings.IMAGE_BASE_URL} onChange={e => handleInputChange('IMAGE_BASE_URL', e.target.value)} style={inputStyle} />
                  </div>
                  <div style={{ marginTop: '8px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>API Key</label>
                    <input type="password" placeholder="sk-..." value={settings.IMAGE_API_KEY} onChange={e => handleInputChange('IMAGE_API_KEY', e.target.value)} style={inputStyle} />
                  </div>
                </div>

                {/* 3. AUDIO */}
                <div style={{ border: '1px solid var(--line)', borderRadius: '10px', padding: '12px', background: 'var(--paper-deep)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontFamily: 'var(--serif)', fontWeight: 'bold', fontSize: '15px', color: 'var(--ink)' }}>语音转写 (Audio)</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {testStates.audio.status !== 'idle' && (
                        <span style={{ 
                          fontSize: '11px', 
                          color: testStates.audio.status === 'success' ? 'var(--moss)' : testStates.audio.status === 'error' ? 'var(--cinnabar)' : 'var(--ochre)',
                          fontWeight: '500'
                        }}>
                          {testStates.audio.message}
                        </span>
                      )}
                      <button type="button" className="btn small ghost" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => handleTest('audio')}>测试</button>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>Provider (可填任意名字)</label>
                      <input type="text" placeholder="openai" value={settings.AUDIO_PROVIDER_NAME} onChange={e => handleInputChange('AUDIO_PROVIDER_NAME', e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>模型名 (Model)</label>
                      <input type="text" placeholder="FunAudioLLM/SenseVoiceSmall" value={settings.AUDIO_MODEL} onChange={e => handleInputChange('AUDIO_MODEL', e.target.value)} style={inputStyle} />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>API Base URL (端点)</label>
                    <input type="text" placeholder="https://api.siliconflow.cn/v1" value={settings.AUDIO_BASE_URL} onChange={e => handleInputChange('AUDIO_BASE_URL', e.target.value)} style={inputStyle} />
                  </div>
                  <div style={{ marginTop: '8px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>API Key</label>
                    <input type="password" placeholder="sk-..." value={settings.AUDIO_API_KEY} onChange={e => handleInputChange('AUDIO_API_KEY', e.target.value)} style={inputStyle} />
                  </div>
                </div>

                {/* 4. MERGE */}
                <div style={{ border: '1px solid var(--line)', borderRadius: '10px', padding: '12px', background: 'var(--paper-deep)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontFamily: 'var(--serif)', fontWeight: 'bold', fontSize: '15px', color: 'var(--ink)' }}>笔记合并 (Merge)</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {testStates.merge.status !== 'idle' && (
                        <span style={{ 
                          fontSize: '11px', 
                          color: testStates.merge.status === 'success' ? 'var(--moss)' : testStates.merge.status === 'error' ? 'var(--cinnabar)' : 'var(--ochre)',
                          fontWeight: '500'
                        }}>
                          {testStates.merge.message}
                        </span>
                      )}
                      <button type="button" className="btn small ghost" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => handleTest('merge')}>测试</button>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>Provider (可填任意名字)</label>
                      <input type="text" placeholder="openai" value={settings.MERGE_PROVIDER_NAME} onChange={e => handleInputChange('MERGE_PROVIDER_NAME', e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>模型名 (Model)</label>
                      <input type="text" placeholder="deepseek-ai/DeepSeek-V3" value={settings.MERGE_MODEL} onChange={e => handleInputChange('MERGE_MODEL', e.target.value)} style={inputStyle} />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>API Base URL (端点)</label>
                    <input type="text" placeholder="https://api.siliconflow.cn/v1" value={settings.MERGE_BASE_URL} onChange={e => handleInputChange('MERGE_BASE_URL', e.target.value)} style={inputStyle} />
                  </div>
                  <div style={{ marginTop: '8px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>API Key</label>
                    <input type="password" placeholder="sk-..." value={settings.MERGE_API_KEY} onChange={e => handleInputChange('MERGE_API_KEY', e.target.value)} style={inputStyle} />
                  </div>
                </div>

              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', borderTop: '1px solid var(--line)', paddingTop: '14px' }}>
                <button type="button" className="btn ghost" disabled={saving} onClick={() => setShowModal(false)}>取消</button>
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? '测试并保存中…' : '验证并保存'}
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
