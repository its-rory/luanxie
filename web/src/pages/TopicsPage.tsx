import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { Topic } from '../types'

export default function TopicsPage({ tick, openTopic }: {
  tick: number
  openTopic: (id: string) => void
}) {
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const debounceRef = useRef<number | null>(null)

  const loadTopics = (searchQuery?: string) => {
    setLoading(true)
    api.topics(searchQuery)
      .then(res => setTopics(res))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadTopics(q.trim() || undefined)
  }, [tick])

  const handleSearchChange = (val: string) => {
    setQ(val)
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current)
    }
    debounceRef.current = window.setTimeout(() => {
      loadTopics(val.trim() || undefined)
    }, 300)
  }

  return (
    <div className="fade-in">
      <div className="section-title">知识库 <span className="count">{topics.length} 个主题</span></div>
      <input className="search-box" placeholder="搜标题、摘要、标签…" value={q} onChange={(e) => handleSearchChange(e.target.value)} />
      {loading ? (
        <div className="empty">加载中...</div>
      ) : !topics.length ? (
        <div className="empty"><span className="mark">库</span>{q.trim() ? '未找到匹配的主题' : '知识库还是空的\n丢几条乱写,主题会自己长出来'}</div>
      ) : (
        topics.map((t) => (
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
        ))
      )}
    </div>
  )
}
