import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Capture } from '../types'
import StatusBadge from '../components/StatusBadge'

const TYPE_GLYPH: Record<string, string> = { text: '字', audio: '言', image: '影' }

export default function InboxPage({ tick, openTopic, showToast }: {
  tick: number
  openTopic: (id: string) => void
  showToast: (m: string) => void
}) {
  const [items, setItems] = useState<Capture[]>([])
  const [loading, setLoading] = useState(true)

  const [editingCapId, setEditingCapId] = useState<string | null>(null)
  const [newTopicTitle, setNewTopicTitle] = useState('')
  const [reassigning, setReassigning] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.captures()
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [tick])

  const handleReassign = async (id: string) => {
    if (!newTopicTitle.trim()) return
    setReassigning(true)
    try {
      const updated = await api.reassignCapture(id, newTopicTitle.trim())
      setItems((xs) => xs.map((x) => (x.id === id ? updated : x)))
      setEditingCapId(null)
      showToast('重新指派并独立成功')
    } catch (e) {
      showToast('改派失败: ' + (e as Error).message)
    } finally {
      setReassigning(false)
    }
  }

  const retry = async (id: string) => {
    try { await api.retry(id); showToast('已重新排队') } catch (e) { showToast((e as Error).message) }
  }
  const remove = async (id: string) => {
    if (!confirm('确定要删除该条目吗？')) return
    try {
      await api.deleteCapture(id)
      setItems((xs) => xs.filter((x) => x.id !== id))
    } catch (e) { showToast((e as Error).message) }
  }

  if (loading)
    return <div className="empty">加载中...</div>

  if (!items.length)
    return <div className="empty"><span className="mark">件</span>还没有乱写<br />去首页丢一条吧</div>

  return (
    <div className="fade-in">
      <div className="section-title">收件箱 <span className="count">{items.length} 条</span></div>
      {items.map((c) => (
        <div className="card" key={c.id}>
          <div className="body">
            <span className="type-glyph">{TYPE_GLYPH[c.type]} · </span>
            {c.clean_text || c.transcript || c.raw_text || (c.type === 'image' ? '(图片,待识别)' : '(音频,待转写)')}
          </div>
          {c.type === 'audio' && c.media_path && (
            <div style={{ marginTop: '6px', marginBottom: '8px' }}>
              <audio src={`/${c.media_path}`} controls style={{ width: '100%', height: '32px', display: 'block' }} />
            </div>
          )}
          {c.type === 'image' && c.media_path && (
            <div style={{ marginTop: '6px', marginBottom: '8px' }}>
              <img src={`/${c.media_path}`} alt="图片" style={{ maxWidth: '100%', maxHeight: '200px', borderRadius: '8px', display: 'block', objectFit: 'contain' }} />
            </div>
          )}
          <div className="meta" style={{ flexWrap: 'wrap', gap: '8px' }}>
            <StatusBadge status={c.status} />
            {c.status === 'done' && c.topic_id && (
              <>
                <span className="arrow">→</span>
                <TopicName id={c.topic_id} onClick={() => openTopic(c.topic_id!)} />
              </>
            )}
            <span>{new Date(c.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            
            {editingCapId !== c.id && (
              <>
                <button
                  className="status-badge"
                  style={{
                    marginLeft: 'auto',
                    background: 'var(--paper-deep)',
                    border: '1px solid var(--line)',
                    color: 'var(--ink)',
                    cursor: 'pointer'
                  }}
                  onClick={() => {
                    setEditingCapId(c.id)
                    setNewTopicTitle('')
                  }}
                >
                  编辑
                </button>
                <button className="status-badge st-failed" style={{ marginLeft: '8px', cursor: 'pointer' }} onClick={() => remove(c.id)}>删除</button>
              </>
            )}
          </div>

          {editingCapId === c.id && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px', width: '100%', borderTop: '1px dashed var(--line)', paddingTop: '8px' }}>
              <input
                type="text"
                value={newTopicTitle}
                onChange={(e) => setNewTopicTitle(e.target.value)}
                placeholder="输入改派的已有或全新主题标题..."
                style={{
                  background: 'var(--paper-deep)',
                  color: 'var(--ink)',
                  border: '1px solid var(--line)',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '12px',
                  flex: 1
                }}
              />
              <button
                className="btn small primary"
                disabled={reassigning || !newTopicTitle.trim()}
                onClick={() => handleReassign(c.id)}
                style={{ padding: '4px 10px', height: '28px', fontSize: '11px' }}
              >
                确定
              </button>
              <button
                className="btn small ghost"
                disabled={reassigning}
                onClick={() => setEditingCapId(null)}
                style={{ padding: '4px 10px', height: '28px', fontSize: '11px' }}
              >
                取消
              </button>
            </div>
          )}
          {c.status === 'failed' && (
            <>
              <div className="err">{c.error}</div>
              <div className="row">
                <button className="btn small" onClick={() => retry(c.id)}>重试</button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

function TopicName({ id, onClick }: { id: string; onClick: () => void }) {
  const [title, setTitle] = useState('…')
  useEffect(() => { api.topic(id).then((t) => setTitle(t.title)).catch(() => setTitle('?')) }, [id])
  return (
    <span
      className="topic-link"
      role="link"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      [[{title}]]
    </span>
  )
}
