import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { api } from '../api'
import type { Capture, CaptureVersion, Topic, TopicVersion } from '../types'
import DiffView from '../components/DiffView'

/* 把 [[双链]] 和 ^cap-xxxx 预处理成可点击的占位链接 */
function preprocessWikiLinks(md: string): string {
  let res = md.replace(/\[\[([^\]]+)\]\]/g, (_, title) => `[${title}](#wiki:${encodeURIComponent(title)})`)
  // 按行分割处理，检测是否为图片收录，提供不同的占位文案
  const lines = res.split('\n')
  const processed = lines.map(line => {
    if (line.includes('^cap-')) {
      const isImage = line.includes('[图片提取]')
      const label = isImage ? '🖼️ 看原图' : '🔊 听原音'
      return line.replace(/\^cap-([a-f0-9]+)/gi, (_, capId) => `[${label}](#audio-play:${capId})`)
    }
    return line
  })
  return processed.join('\n')
}

function AudioPlayButton({ capId, initialLabel }: { capId: string; initialLabel?: React.ReactNode }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [type, setType] = useState<'audio' | 'image' | 'text' | null>(null)
  const [showLightbox, setShowLightbox] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const getAudio = () => {
    if (!audioRef.current) {
      const audio = new Audio()
      audio.onplay = () => setPlaying(true)
      audio.onpause = () => setPlaying(false)
      audio.onended = () => setPlaying(false)
      audioRef.current = audio
    }
    return audioRef.current
  }

  const handlePlay = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (type === 'image' && audioUrl) {
      setShowLightbox(true)
      return
    }

    if (audioUrl && type === 'audio') {
      const audio = getAudio()
      if (playing) {
        audio.pause()
      } else {
        audio.play().catch(() => {})
      }
      return
    }

    setLoading(true)
    try {
      const cap = await api.capture(capId)
      if (cap && cap.media_path) {
        const url = `/${cap.media_path}`
        setType(cap.type)
        setAudioUrl(url)
        if (cap.type === 'audio') {
          const audio = getAudio()
          audio.src = url
          audio.play().catch(() => {})
        } else if (cap.type === 'image') {
          setShowLightbox(true)
        } else {
          setError(true)
        }
      } else {
        setError(true)
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        const audio = audioRef.current
        audio.pause()
        audio.onplay = null
        audio.onpause = null
        audio.onended = null
        audio.removeAttribute('src')
        audio.load()
        audioRef.current = null
      }
    }
  }, [])

  if (error) return <span style={{ color: 'var(--ink-faint)', fontSize: '11px', marginLeft: '6px' }}>(无原件)</span>
  if (loading) return <span style={{ color: 'var(--ink-soft)', fontSize: '11px', marginLeft: '6px' }}>加载中…</span>

  return (
    <>
      <button
        onClick={handlePlay}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          background: 'none',
          border: 'none',
          padding: '0 4px',
          color: playing ? 'var(--primary)' : 'var(--primary-soft)',
          cursor: 'pointer',
          fontSize: '11px',
          fontFamily: 'inherit',
          textDecoration: 'underline'
        }}
      >
        {playing ? '⏸ 暂停' : type === 'image' ? '🖼️ 看原图' : type === 'text' ? '📝 看原文' : initialLabel || '🔊 听原音'}
      </button>

      {showLightbox && audioUrl && (
        <div
          onClick={() => setShowLightbox(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            cursor: 'zoom-out',
            animation: 'fadeIn 0.15s ease-out'
          }}
        >
          <img
            src={audioUrl}
            alt="收录原图"
            style={{
              maxWidth: '92%',
              maxHeight: '92%',
              borderRadius: '8px',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.4)',
              objectFit: 'contain',
              cursor: 'default'
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}

/* 分割主题正文为 AI解析 和 记录轨迹 内容 */
function parseTopicBody(body: string): { aiParse: string; trajectory: string } {
  const aiHeader = '## AI解析'
  const trajHeader = '## 记录轨迹'

  const aiIndex = body.indexOf(aiHeader)
  const trajIndex = body.indexOf(trajHeader)

  let aiParse = ''
  let trajectory = ''

  if (aiIndex !== -1 && trajIndex !== -1) {
    if (aiIndex < trajIndex) {
      aiParse = body.slice(aiIndex + aiHeader.length, trajIndex)
      trajectory = body.slice(trajIndex + trajHeader.length)
    } else {
      trajectory = body.slice(trajIndex + trajHeader.length, aiIndex)
      aiParse = body.slice(aiIndex + aiHeader.length)
    }
  } else if (aiIndex !== -1) {
    aiParse = body.slice(aiIndex + aiHeader.length)
  } else if (trajIndex !== -1) {
    aiParse = body.slice(0, trajIndex)
    trajectory = body.slice(trajIndex + trajHeader.length)
  } else {
    aiParse = body
  }

  return {
    aiParse: aiParse.trim(),
    trajectory: trajectory.trim(),
  }
}

export default function TopicDetail({ id, back, openByTitle, showToast }: {
  id: string
  back: () => void
  openByTitle: (title: string) => void
  showToast: (m: string) => void
}) {
  const [topic, setTopic] = useState<Topic | null>(null)
  const [versions, setVersions] = useState<TopicVersion[]>([])
  const [showVersions, setShowVersions] = useState(false)
  const [diffFor, setDiffFor] = useState<number | null>(null)

  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editAiParse, setEditAiParse] = useState('')
  const [editTrajectory, setEditTrajectory] = useState('')
  const [saving, setSaving] = useState(false)

  const [isEditingTags, setIsEditingTags] = useState(false)
  const [tagInput, setTagInput] = useState('')

  // Sub-cards captures state
  const [captures, setCaptures] = useState<Capture[]>([])
  const [loadingCaptures, setLoadingCaptures] = useState(false)
  const [editingCaptureId, setEditingCaptureId] = useState<string | null>(null)
  const [editCapClean, setEditCapClean] = useState('')
  const [editCapRaw, setEditCapRaw] = useState('')
  const [savingCapture, setSavingCapture] = useState(false)
  const [activeCapVersions, setActiveCapVersions] = useState<Record<string, { versions: CaptureVersion[]; show: boolean }>>({})
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  const load = useCallback((active = { current: true }) => {
    api.topic(id).then(res => { if (active.current) setTopic(res); }).catch(() => {})
    api.versions(id).then(res => { if (active.current) setVersions(res); }).catch(() => {})
    
    setLoadingCaptures(true)
    api.topicCaptures(id)
      .then(res => { if (active.current) setCaptures(res); })
      .catch(() => {})
      .finally(() => { if (active.current) setLoadingCaptures(false); })
  }, [id])

  useEffect(() => {
    const active = { current: true }
    load(active)
    return () => {
      active.current = false
    }
  }, [load])

  const md = useMemo(() => preprocessWikiLinks(topic?.body_md || ''), [topic?.body_md])

  const rollback = async (v: number) => {
    if (!confirm(`回滚到 v${v}?当前内容会存为新版本,可再滚回来。`)) return
    try {
      await api.rollback(id, v)
      showToast(`已回滚到 v${v}`)
      setDiffFor(null)
      setIsEditing(false)
      load()
    } catch (e) { showToast((e as Error).message) }
  }

  const handleStartEdit = () => {
    if (!topic) return
    const { aiParse, trajectory } = parseTopicBody(topic.body_md || '')
    setEditTitle(topic.title)
    setEditAiParse(aiParse)
    setEditTrajectory(trajectory)
    setIsEditing(true)
  }

  const handleCancel = () => {
    setIsEditing(false)
  }

  const handleSave = async () => {
    if (!topic) return
    if (!editTitle.trim()) {
      showToast('标题不能为空')
      return
    }
    setSaving(true)
    try {
      const payload: { title: string; body_md?: string } = {
        title: editTitle.trim()
      }
      if (topic.body_md && topic.body_md.trim()) {
        payload.body_md = `## AI解析\n${editAiParse.trim()}\n\n## 记录轨迹\n${editTrajectory.trim()}`
      }
      const updated = await api.patchTopic(id, payload)
      setTopic(updated)
      setIsEditing(false)
      showToast('保存成功')
      api.versions(id).then(setVersions).catch(() => {})
    } catch (e) {
      showToast('保存失败: ' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveTags = async () => {
    if (!topic) return
    const parsedTags = tagInput
      .split(/[,，\s]+/)
      .map(t => t.trim())
      .filter(t => t.length > 0)
    try {
      const updated = await api.patchTopic(id, { tags: parsedTags })
      setTopic(updated)
      setIsEditingTags(false)
      showToast('标签更新成功')
    } catch (e) {
      showToast('保存标签失败: ' + (e as Error).message)
    }
  }

  const handleDelete = async () => {
    if (!confirm('确定要删除该主题及所有关联历史和捕获记录吗？此操作不可逆！')) return
    try {
      await api.deleteTopic(id)
      showToast('主题已成功删除')
      back()
    } catch (e) { showToast((e as Error).message) }
  }

  const handleStartEditCapture = (cap: Capture) => {
    setEditingCaptureId(cap.id)
    setEditCapClean(cap.clean_text || '')
    setEditCapRaw(cap.raw_text || cap.transcript || '')
  }

  const handleCancelEditCapture = () => {
    setEditingCaptureId(null)
  }

  const handleSaveCapture = async (cap: Capture) => {
    setSavingCapture(true)
    try {
      const payload: { clean_text: string; raw_text?: string; transcript?: string } = {
        clean_text: editCapClean.trim()
      }
      if (cap.type === 'audio') {
        payload.transcript = editCapRaw.trim()
      } else {
        payload.raw_text = editCapRaw.trim()
      }
      await api.patchCapture(cap.id, payload)
      showToast('保存成功')
      setEditingCaptureId(null)
      const caps = await api.topicCaptures(id)
      setCaptures(caps)

      if (activeCapVersions[cap.id]?.show) {
        const vers = await api.captureVersions(cap.id)
        setActiveCapVersions(prev => ({
          ...prev,
          [cap.id]: { ...prev[cap.id], versions: vers }
        }))
      }
    } catch (e) {
      showToast('保存子卡片失败: ' + (e as Error).message)
    } finally {
      setSavingCapture(false)
    }
  }

  const handleDeleteCapture = async (capId: string) => {
    if (!confirm('确定要删除此条记录及关联的音频/图片文件吗？此操作不可逆！')) return
    try {
      await api.deleteTopicCapture(capId)
      showToast('记录已成功删除')
      const caps = await api.topicCaptures(id)
      setCaptures(caps)
    } catch (e) {
      showToast('删除子卡片失败: ' + (e as Error).message)
    }
  }

  const toggleCapVersions = async (capId: string) => {
    const isShowing = activeCapVersions[capId]?.show
    if (isShowing) {
      setActiveCapVersions(prev => ({
        ...prev,
        [capId]: { ...prev[capId], show: false }
      }))
    } else {
      try {
        const vers = await api.captureVersions(capId)
        setActiveCapVersions(prev => ({
          ...prev,
          [capId]: { versions: vers, show: true }
        }))
      } catch (e) {
        showToast('读取版本历史失败: ' + (e as Error).message)
      }
    }
  }

  const handleRollbackCapture = async (capId: string, version: number) => {
    if (!confirm(`确定回滚此卡片到版本 v${version} 吗？`)) return
    try {
      await api.rollbackCapture(capId, version)
      showToast('已成功回滚')
      const caps = await api.topicCaptures(id)
      setCaptures(caps)
      const vers = await api.captureVersions(capId)
      setActiveCapVersions(prev => ({
        ...prev,
        [capId]: { versions: vers, show: true }
      }))
    } catch (e) {
      showToast('回滚失败: ' + (e as Error).message)
    }
  }

  if (!topic) return <div className="empty">加载中...</div>

  const diffTarget = versions.find((v) => v.version === diffFor)

  return (
    <div className="fade-in">
      <div className="detail-head">
        <button className="back" onClick={back}>← 知识库</button>
        {isEditing ? (
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            style={{
              background: 'var(--paper-deep)',
              color: 'var(--ink)',
              border: '1px solid var(--line)',
              borderRadius: '8px',
              padding: '6px 12px',
              fontSize: '20px',
              fontFamily: 'var(--serif)',
              fontWeight: 'bold',
              width: '100%',
              marginTop: '8px',
              marginBottom: '8px'
            }}
            placeholder="输入主题标题..."
          />
        ) : (
          <h2>{topic.title}</h2>
        )}
        <div className="v">子卡片共 {captures.length} 个 · {new Date(topic.updated_at).toLocaleDateString('zh-CN')}</div>
        <div className="tags" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
          {isEditingTags ? (
            <>
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="标签以逗号或空格分隔"
                style={{
                  background: 'var(--paper-deep)',
                  color: 'var(--ink)',
                  border: '1px solid var(--line)',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '12px',
                  width: '200px'
                }}
              />
              <button
                className="btn small primary"
                style={{ padding: '2px 8px', height: '24px', fontSize: '11px', minWidth: 'auto', cursor: 'pointer' }}
                onClick={handleSaveTags}
              >
                ✓
              </button>
              <button
                className="btn small ghost"
                style={{ padding: '2px 8px', height: '24px', fontSize: '11px', minWidth: 'auto', cursor: 'pointer', marginLeft: '4px' }}
                onClick={() => setIsEditingTags(false)}
              >
                ✗
              </button>
            </>
          ) : (
            <>
              {topic.tags.map((t) => <span className="tag" key={t}>{t}</span>)}
              <button
                onClick={() => {
                  setTagInput(topic.tags.join(', '))
                  setIsEditingTags(true);
                }}
                style={{
                  background: 'none',
                  border: '1px solid var(--line)',
                  borderRadius: '6px',
                  padding: '2px 6px',
                  color: 'var(--ink-soft)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  marginLeft: '8px',
                  height: '22px'
                }}
                title="修改标签"
              >
                ✏️
              </button>
            </>
          )}
        </div>
      </div>

      {isEditing && topic.body_md && topic.body_md.trim() && (
        <div className="note-body" style={{ display: 'flex', flexDirection: 'column', gap: '18px', marginBottom: '20px' }}>
          <div>
            <div style={{ fontFamily: 'var(--serif)', fontWeight: 'bold', fontSize: '16px', color: 'var(--ink)', marginBottom: '8px' }}>
              ## 历史大网志 AI解析 (编辑)
            </div>
            <textarea
              value={editAiParse}
              onChange={(e) => setEditAiParse(e.target.value)}
              style={{
                width: '100%',
                minHeight: '200px',
                background: 'var(--paper-deep)',
                color: 'var(--ink)',
                border: '1px solid var(--line)',
                borderRadius: '10px',
                padding: '12px',
                fontFamily: 'inherit',
                fontSize: '14px',
                lineHeight: '1.6',
                resize: 'vertical'
              }}
              placeholder="输入旧版AI解析..."
            />
          </div>
          <div>
            <div style={{ fontFamily: 'var(--serif)', fontWeight: 'bold', fontSize: '16px', color: 'var(--ink)', marginBottom: '8px' }}>
              ## 历史大网志 记录轨迹 (编辑)
            </div>
            <textarea
              value={editTrajectory}
              onChange={(e) => setEditTrajectory(e.target.value)}
              style={{
                width: '100%',
                minHeight: '140px',
                background: 'var(--paper-deep)',
                color: 'var(--ink)',
                border: '1px solid var(--line)',
                borderRadius: '10px',
                padding: '12px',
                fontFamily: 'inherit',
                fontSize: '14px',
                lineHeight: '1.6',
                resize: 'vertical'
              }}
              placeholder="输入旧版轨迹..."
            />
          </div>
        </div>
      )}

      {/* Backward Compatibility: Display old body_md text if exists */}
      {!isEditing && topic.body_md && topic.body_md.trim().replace(/## AI解析|## 记录轨迹/g, '').trim() && (
        <div style={{ background: 'var(--paper-deep)', border: '1px solid var(--line)', borderRadius: '12px', padding: '16px', marginBottom: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--ochre)', marginBottom: '10px', borderBottom: '1px solid var(--line)', paddingBottom: '4px' }}>
            ⚠️ 历史合并版正文 (旧版存档数据)
          </div>
          <div className="note-body">
            <ReactMarkdown
              components={{
                a: ({ href, children }) => {
                  if (href?.startsWith('#wiki:')) {
                    const title = decodeURIComponent(href.slice(6))
                    return (
                      <span
                        className="wiki-link"
                        role="link"
                        tabIndex={0}
                        onClick={() => openByTitle(title)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openByTitle(title); } }}
                      >
                        [[{children}]]
                      </span>
                    )
                  }
                  if (href?.startsWith('#audio-play:')) {
                    const capId = href.slice(12)
                    return <AudioPlayButton capId={capId} initialLabel={children} />
                  }
                  return <a href={href} target="_blank" rel="noreferrer">{children}</a>
                },
              }}
            >
              {md}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Render captures as separate sub-cards */}
      <div className="sub-cards-feed" style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '24px', marginBottom: '24px' }}>
        <h3 style={{ fontFamily: 'var(--serif)', fontSize: '18px', fontWeight: 'bold', borderBottom: '2px solid var(--line)', paddingBottom: '8px', color: 'var(--ink)', margin: 0 }}>
          子记录卡片清单 ({captures.length})
        </h3>

        {loadingCaptures && captures.length === 0 ? (
          <div style={{ color: 'var(--ink-soft)', fontSize: '14px', textAlign: 'center', padding: '24px' }}>数据加载中…</div>
        ) : captures.length === 0 ? (
          <div style={{ color: 'var(--ink-soft)', fontSize: '14px', textAlign: 'center', padding: '24px', background: 'var(--paper-deep)', borderRadius: '12px' }}>
            暂无子记录 (该主题为空或未分配捕获)
          </div>
        ) : (
          captures.map((cap, idx) => {
            const isEditingCap = editingCaptureId === cap.id
            const capVerState = activeCapVersions[cap.id] || { versions: [], show: false }
            
            const timeStr = new Date(cap.created_at).toLocaleString('zh-CN', {
              hour12: false,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            })
            const typeLabel = cap.type === 'audio' ? '🔊 语音' : cap.type === 'image' ? '🖼️ 图片' : '📝 文本'

            return (
              <div 
                key={cap.id} 
                className="sub-card"
                style={{
                  background: 'var(--paper-card)',
                  border: '1px solid var(--line)',
                  borderRadius: '12px',
                  padding: '18px',
                  boxShadow: '0 4px 14px rgba(43,38,32,0.04)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}
              >
                {/* Sub-card header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '14px', color: 'var(--ink)' }}>子卡片 #{idx + 1}</span>
                    <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'var(--paper-deep)', border: '1px solid var(--line)', color: 'var(--ink-soft)' }}>
                      {typeLabel}
                    </span>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {!isEditingCap && (
                      <>
                        <button 
                          className="btn small ghost" 
                          onClick={() => toggleCapVersions(cap.id)}
                          style={{ padding: '2px 8px', fontSize: '11px', height: '24px', minWidth: 'auto' }}
                        >
                          {capVerState.show ? '收起历史' : `历史(${cap.version || 0})`}
                        </button>
                        <button 
                          className="btn small ghost" 
                          onClick={() => handleStartEditCapture(cap)}
                          style={{ padding: '2px 8px', fontSize: '11px', height: '24px', minWidth: 'auto' }}
                        >
                          编辑
                        </button>
                        <button 
                          className="btn small danger-ghost" 
                          onClick={() => handleDeleteCapture(cap.id)}
                          style={{ padding: '2px 8px', fontSize: '11px', height: '24px', minWidth: 'auto', background: 'none', border: 'none', color: 'var(--cinnabar)', cursor: 'pointer' }}
                        >
                          删除
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Sub-card body */}
                {isEditingCap ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--ink-soft)', display: 'block', marginBottom: '3px' }}>AI解析 (Clean Text)</label>
                      <textarea
                        value={editCapClean}
                        onChange={(e) => setEditCapClean(e.target.value)}
                        style={{
                          width: '100%',
                          minHeight: '120px',
                          background: 'var(--paper-deep)',
                          color: 'var(--ink)',
                          border: '1px solid var(--line)',
                          borderRadius: '8px',
                          padding: '8px',
                          fontFamily: 'inherit',
                          fontSize: '13px',
                          lineHeight: '1.5'
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--ink-soft)', display: 'block', marginBottom: '3px' }}>
                        {cap.type === 'audio' ? '语音转写原文 (Transcript)' : '原始输入 (Raw Text)'}
                      </label>
                      <textarea
                        value={editCapRaw}
                        onChange={(e) => setEditCapRaw(e.target.value)}
                        style={{
                          width: '100%',
                          minHeight: '80px',
                          background: 'var(--paper-deep)',
                          color: 'var(--ink)',
                          border: '1px solid var(--line)',
                          borderRadius: '8px',
                          padding: '8px',
                          fontFamily: 'inherit',
                          fontSize: '13px',
                          lineHeight: '1.5'
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
                      <button className="btn small ghost" onClick={handleCancelEditCapture} disabled={savingCapture}>取消</button>
                      <button className="btn small primary" onClick={() => handleSaveCapture(cap)} disabled={savingCapture}>
                        {savingCapture ? '保存中…' : '保存'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div>
                      <div style={{ fontSize: '12px', color: 'var(--ink-soft)', fontWeight: 'bold', marginBottom: '4px' }}>AI解析</div>
                      <div className="clean-content" style={{ fontSize: '14px', lineHeight: '1.6', color: 'var(--ink)' }}>
                        <ReactMarkdown>{cap.clean_text || '(暂无解析)'}</ReactMarkdown>
                      </div>
                    </div>

                    <div style={{ background: 'var(--paper-deep)', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                      <div style={{ fontSize: '12px', color: 'var(--ink-soft)', fontWeight: 'bold', marginBottom: '6px' }}>原始附件与轨迹</div>
                      {cap.type === 'audio' && cap.media_path && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                          <AudioPlayButton capId={cap.id} initialLabel="🔊 播放原音" />
                          <span style={{ fontSize: '11px', color: 'var(--ink-faint)' }}>({cap.media_path.split('/').pop()})</span>
                        </div>
                      )}
                      
                      {cap.type === 'image' && cap.media_path && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '6px' }}>
                          <div>
                            <AudioPlayButton capId={cap.id} initialLabel="🖼️ 点击看原图" />
                          </div>
                          <img 
                            src={`/${cap.media_path}`} 
                            alt="原始图片" 
                            style={{ 
                              maxWidth: '220px', 
                              maxHeight: '150px', 
                              borderRadius: '6px', 
                              objectFit: 'cover',
                              border: '1px solid var(--line)',
                              cursor: 'zoom-in'
                            }}
                            onClick={() => {
                              setLightboxUrl(`/${cap.media_path}`)
                            }}
                          />
                        </div>
                      )}
                      
                      {(cap.raw_text || cap.transcript) && (
                        <details style={{ cursor: 'pointer', fontSize: '12px', color: 'var(--ink-soft)', marginTop: '4px' }}>
                          <summary style={{ outline: 'none', userSelect: 'none', marginBottom: '4px', fontSize: '11px', fontWeight: 'bold' }}>查看原始记录文字</summary>
                          <div style={{ 
                            background: 'var(--paper-card)', 
                            padding: '8px', 
                            borderRadius: '6px', 
                            fontSize: '12px', 
                            lineHeight: '1.5',
                            whiteSpace: 'pre-wrap',
                            color: 'var(--ink-soft)',
                            border: '1px solid var(--line)'
                          }}>
                            {cap.type === 'audio' ? cap.transcript : cap.raw_text}
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                )}

                {/* Sub-card Version History */}
                {capVerState.show && (
                  <div style={{ marginTop: '8px', background: 'var(--paper-deep)', padding: '10px 12px', borderRadius: '8px', border: '1px dashed var(--line)' }}>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--ink)', marginBottom: '8px' }}>子卡片版本历史 ({capVerState.versions.length})</div>
                    {capVerState.versions.length === 0 ? (
                      <div style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>暂无历史编辑记录</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {capVerState.versions.map((cv) => (
                          <div 
                            key={cv.id} 
                            style={{ 
                              display: 'flex', 
                              justifyContent: 'space-between', 
                              alignItems: 'center', 
                              fontSize: '12px',
                              background: 'var(--paper-card)',
                              padding: '6px 8px',
                              borderRadius: '6px',
                              border: '1px solid var(--line)'
                            }}
                          >
                            <div>
                              <span style={{ fontWeight: 'bold', marginRight: '8px' }}>v{cv.version}</span>
                              <span style={{ color: 'var(--ink-faint)', fontSize: '11px' }}>{new Date(cv.created_at).toLocaleString()}</span>
                            </div>
                            <button 
                              className="btn small ghost" 
                              style={{ padding: '1px 6px', fontSize: '11px', height: '20px', minWidth: 'auto' }}
                              onClick={() => handleRollbackCapture(cap.id, cv.version)}
                            >
                              回滚
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Sub-card footer */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', borderTop: '1px solid var(--line)', paddingTop: '8px', fontSize: '11px', color: 'var(--ink-faint)' }}>
                  <span>生成时间: {timeStr}</span>
                  {cap.version !== undefined && <span>当前版本: v{cap.version}</span>}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="versions">
        {isEditing ? (
          <>
            <button className="btn small primary" onClick={handleSave} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
            <button className="btn small ghost" style={{ marginLeft: '10px' }} onClick={handleCancel} disabled={saving}>
              取消
            </button>
          </>
        ) : (
          <>
            {topic.body_md && topic.body_md.trim() && (
              <button className="btn small ghost" onClick={() => setShowVersions(!showVersions)}>
                {showVersions ? '收起版本历史' : `主题历史(${versions.length})`}
              </button>
            )}
            <button className="btn small ghost" style={{ marginLeft: topic.body_md && topic.body_md.trim() ? '10px' : '0px' }} onClick={handleStartEdit}>
              编辑主题标题
            </button>
            <button className="btn small danger" style={{ marginLeft: '10px' }} onClick={handleDelete}>
              删除此主题
            </button>
          </>
        )}
        {showVersions && versions.map((v) => (
          <div key={v.id}>
            <div className="version-item">
              <span className="vnum">v{v.version}</span>
              <span>{new Date(v.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              {v.capture_id && <span style={{ color: 'var(--ink-faint)', fontSize: 11 }}>cap-{v.capture_id.slice(0, 6)}</span>}
              <span className="spacer" />
              <button className="btn small ghost" onClick={() => setDiffFor(diffFor === v.version ? null : v.version)}>
                {diffFor === v.version ? '收起' : '对比'}
              </button>
              <button className="btn small" onClick={() => rollback(v.version)}>回滚</button>
            </div>
            {diffFor === v.version && diffTarget && (
              <DiffView oldText={diffTarget.body_md} newText={topic.body_md || ''} />
            )}
          </div>
        ))}
      </div>

      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            cursor: 'zoom-out',
            animation: 'fadeIn 0.15s ease-out'
          }}
        >
          <img
            src={lightboxUrl}
            alt="收录原图"
            style={{
              maxWidth: '92%',
              maxHeight: '92%',
              borderRadius: '8px',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.4)',
              objectFit: 'contain',
              cursor: 'default'
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
