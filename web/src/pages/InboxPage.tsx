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

  useEffect(() => {
    setLoading(true)
    api.captures()
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [tick])

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
          <div className="meta">
            <StatusBadge status={c.status} />
            {c.status === 'done' && c.topic_id && (
              <>
                <span className="arrow">→</span>
                <TopicName id={c.topic_id} onClick={() => openTopic(c.topic_id!)} />
              </>
            )}
            <span>{new Date(c.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            <button className="status-badge st-failed" style={{ marginLeft: 'auto' }} onClick={() => remove(c.id)}>删除</button>
          </div>
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
  return <span className="topic-link" onClick={onClick}>[[{title}]]</span>
}
