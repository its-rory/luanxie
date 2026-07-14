import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { api } from '../api'
import type { Topic, TopicVersion } from '../types'
import DiffView from '../components/DiffView'

/* 把 [[双链]] 和 ^cap-xxxx 预处理成可点击的占位链接 */
function preprocessWikiLinks(md: string): string {
  let res = md.replace(/\[\[([^\]]+)\]\]/g, (_, title) => `[${title}](#wiki:${encodeURIComponent(title)})`)
  res = res.replace(/\^cap-([a-f0-9]+)/gi, (_, capId) => `[🔊 听原音](#audio-play:${capId})`)
  return res
}

function AudioPlayButton({ capId }: { capId: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [audio] = useState(() => new Audio())
  const [type, setType] = useState<'audio' | 'image' | 'text' | null>(null)

  const handlePlay = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (type === 'image' && audioUrl) {
      window.open(audioUrl, '_blank')
      return
    }

    if (audioUrl && type === 'audio') {
      if (playing) {
        audio.pause()
        setPlaying(false)
      } else {
        audio.play().then(() => setPlaying(true)).catch(() => {})
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
          audio.src = url
          audio.play().then(() => setPlaying(true)).catch(() => {})
          audio.onended = () => {
            setPlaying(false)
          }
        } else if (cap.type === 'image') {
          window.open(url, '_blank')
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
      audio.pause()
    }
  }, [audio])

  if (error) return <span style={{ color: 'var(--ink-faint)', fontSize: '11px', marginLeft: '6px' }}>(无原件)</span>
  if (loading) return <span style={{ color: 'var(--ink-soft)', fontSize: '11px', marginLeft: '6px' }}>加载中…</span>

  return (
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
      {playing ? '⏸ 暂停' : type === 'image' ? '🖼️ 看原图' : '🔊 听原音'}
    </button>
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
  const [editAiParse, setEditAiParse] = useState('')
  const [editTrajectory, setEditTrajectory] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => {
    api.topic(id).then(setTopic).catch(() => {})
    api.versions(id).then(setVersions).catch(() => {})
  }
  useEffect(load, [id])

  const md = useMemo(() => preprocessWikiLinks(topic?.body_md || ''), [topic])

  const rollback = async (v: number) => {
    if (!confirm(`回滚到 v${v}?当前内容会存为新版本,可再滚回来。`)) return
    try {
      await api.rollback(id, v)
      showToast(`已回滚到 v${v}`)
      setDiffFor(null)
      setIsEditing(false) // Exit edit mode if rollbacked
      load()
    } catch (e) { showToast((e as Error).message) }
  }

  const handleStartEdit = () => {
    if (!topic) return
    const { aiParse, trajectory } = parseTopicBody(topic.body_md || '')
    setEditAiParse(aiParse)
    setEditTrajectory(trajectory)
    setIsEditing(true)
  }

  const handleCancel = () => {
    setIsEditing(false)
  }

  const handleSave = async () => {
    if (!topic) return
    setSaving(true)
    try {
      const newBody = `## AI解析\n${editAiParse.trim()}\n\n## 记录轨迹\n${editTrajectory.trim()}`
      const updated = await api.patchTopic(id, { body_md: newBody })
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

  const handleDelete = async () => {
    if (!confirm('确定要删除该主题及所有关联历史和捕获记录吗？此操作不可逆！')) return
    try {
      await api.deleteTopic(id)
      showToast('主题已成功删除')
      back()
    } catch (e) { showToast((e as Error).message) }
  }

  if (!topic) return <div className="empty">加载中...</div>

  const diffTarget = versions.find((v) => v.version === diffFor)

  return (
    <div className="fade-in">
      <div className="detail-head">
        <button className="back" onClick={back}>← 知识库</button>
        <h2>{topic.title}</h2>
        <div className="v">v{topic.version} · {new Date(topic.updated_at).toLocaleDateString('zh-CN')}</div>
        <div className="tags">{topic.tags.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
      </div>

      {isEditing ? (
        <div className="note-body" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <div style={{ fontFamily: 'var(--serif)', fontWeight: 'bold', fontSize: '16px', color: 'var(--ink)', marginBottom: '8px' }}>
              ## AI解析
            </div>
            <textarea
              value={editAiParse}
              onChange={(e) => setEditAiParse(e.target.value)}
              style={{
                width: '100%',
                minHeight: '220px',
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
              placeholder="输入AI解析内容..."
            />
          </div>
          <div>
            <div style={{ fontFamily: 'var(--serif)', fontWeight: 'bold', fontSize: '16px', color: 'var(--ink)', marginBottom: '8px' }}>
              ## 记录轨迹
            </div>
            <textarea
              value={editTrajectory}
              onChange={(e) => setEditTrajectory(e.target.value)}
              style={{
                width: '100%',
                minHeight: '160px',
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
              placeholder="输入收录轨迹历史记录，如：- 2026-07-14 收录: “原文” ^cap-xxx"
            />
          </div>
        </div>
      ) : (
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
                  return <AudioPlayButton capId={capId} />
                }
                return <a href={href} target="_blank" rel="noreferrer">{children}</a>
              },
            }}
          >
            {md}
          </ReactMarkdown>
        </div>
      )}

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
            <button className="btn small ghost" onClick={() => setShowVersions(!showVersions)}>
              {showVersions ? '收起版本历史' : `版本历史(${versions.length})`}
            </button>
            <button className="btn small ghost" style={{ marginLeft: '10px' }} onClick={handleStartEdit}>
              编辑
            </button>
            <button className="btn small danger" style={{ marginLeft: '10px' }} onClick={handleDelete}>
              删除
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
    </div>
  )
}
