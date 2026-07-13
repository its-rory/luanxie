import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Topic } from '../types'

export default function TopicsPage({ tick, openTopic }: {
  tick: number
  openTopic: (id: string) => void
}) {
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  useEffect(() => {
    setLoading(true)
    api.topics()
      .then(setTopics)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [tick])

  const shown = q.trim()
    ? topics.filter((t) =>
        (t.title + t.summary + t.tags.join(' ')).toLowerCase().includes(q.trim().toLowerCase()))
    : topics

  if (loading)
    return <div className="empty">加载中...</div>

  if (!topics.length)
    return <div className="empty"><span className="mark">库</span>知识库还是空的<br />丢几条乱写,主题会自己长出来</div>

  return (
    <div className="fade-in">
      <div className="section-title">知识库 <span className="count">{topics.length} 个主题</span></div>
      <input className="search-box" placeholder="搜标题、摘要、标签…" value={q} onChange={(e) => setQ(e.target.value)} />
      {shown.map((t) => (
        <div
          className="card topic-card"
          key={t.id}
          role="button"
          tabIndex={0}
          onClick={() => openTopic(t.id)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTopic(t.id); } }}
        >
          <div className="t-title">{t.title}</div>
          <div className="t-summary">{t.summary}</div>
          <div className="tags">
            {t.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
            <span className="tag" style={{ color: 'var(--ink-faint)', background: 'var(--paper-deep)' }}>v{t.version}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
