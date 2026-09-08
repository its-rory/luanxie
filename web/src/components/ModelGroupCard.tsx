import React from 'react'

export interface ModelDetail {
  name: string
  contextWindow?: number
  maxOutputTokens?: number
}

export interface ModelProvider {
  id: string
  name: string
  protocol: 'openai-completions' | 'anthropic-messages'
  baseUrl: string
  apiKey: string
  headers: string
  models: ModelDetail[]
}

interface ModelGroupCardProps {
  title: string
  description: string
  groupKey: 'text' | 'image' | 'audio' | 'merge'
  providerId: string
  model: string
  providers: ModelProvider[]
  onChange: (groupKey: 'text' | 'image' | 'audio' | 'merge', providerId: string, model: string) => void
  formLabelStyle?: React.CSSProperties
  modernInputStyle?: React.CSSProperties
  groupCardStyle?: React.CSSProperties
}

export default function ModelGroupCard({
  title,
  description,
  groupKey,
  providerId,
  model,
  providers,
  onChange,
  formLabelStyle,
  modernInputStyle,
  groupCardStyle,
}: ModelGroupCardProps) {
  const curProv = providers.find((p) => p.id === (providerId || providers[0]?.id))
  const availableModels = curProv?.models || []

  return (
    <div style={groupCardStyle} className="model-group-card">
      <div>
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>{title}</div>
        <div style={{ fontSize: '12px', color: '#64748b' }}>{description}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <div>
          <label style={formLabelStyle}>选择模型供应商</label>
          <select
            value={providerId || (providers[0]?.id || '')}
            onChange={(e) => {
              const newProvId = e.target.value
              const p = providers.find((item) => item.id === newProvId)
              const nextModel = p && p.models.length > 0 ? p.models[0].name : ''
              onChange(groupKey, newProvId, nextModel)
            }}
            style={modernInputStyle}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={formLabelStyle}>选用模型</label>
          <select
            value={model || ''}
            onChange={(e) => onChange(groupKey, providerId || (providers[0]?.id || ''), e.target.value)}
            style={modernInputStyle}
          >
            {availableModels.length === 0 ? (
              <option value="">(该供应商未添加模型)</option>
            ) : (
              availableModels.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))
            )}
          </select>
        </div>
      </div>
    </div>
  )
}
