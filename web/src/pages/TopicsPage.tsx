import { useEffect, useRef, useState } from 'react'
import Sortable from 'sortablejs'
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
  const listRef = useRef<HTMLDivElement>(null)
  const sortableRef = useRef<Sortable | null>(null)
  const isDraggingRef = useRef(false)
  const topicsRef = useRef<Topic[]>([])
  topicsRef.current = topics

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

  useEffect(() => {
    if (!listRef.current || loading || q.trim()) {
      if (sortableRef.current) {
        sortableRef.current.destroy()
        sortableRef.current = null
      }
      return
    }

    sortableRef.current = Sortable.create(listRef.current, {
      animation: 260,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      delay: 350,
      delayOnTouchOnly: false,
      touchStartThreshold: 5,
      chosenClass: 'sortable-chosen',
      ghostClass: 'sortable-ghost',
      dragClass: 'sortable-drag',
      draggable: '.topic-card',
      forceFallback: false,
      onStart: () => {
        isDraggingRef.current = true
        if ('vibrate' in navigator) {
          try { navigator.vibrate(40) } catch {}
        }
      },
      onEnd: (evt) => {
        setTimeout(() => { isDraggingRef.current = false }, 80)
        const { oldIndex, newIndex } = evt
        if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return
        const currentList = [...topicsRef.current]
        const [moved] = currentList.splice(oldIndex, 1)
        currentList.splice(newIndex, 0, moved)
        setTopics(currentList)
        api.reorderTopics(currentList.map(t => t.id)).catch((err) => {
          console.error('Failed to save topic order', err)
        })
      },
    })

    return () => {
      if (sortableRef.current) {
        sortableRef.current.destroy()
        sortableRef.current = null
      }
    }
  }, [loading, q, topics.length])

  return (
    <div className="fade-in">
      <div className="section-title">知识库 <span className="count">{topics.length} 个主题</span></div>
      <input className="search-box" placeholder="搜标题、摘要、标签…" value={q} onChange={(e) => handleSearchChange(e.target.value)} />
      {loading ? (
        <div className="empty">加载中...</div>
      ) : !topics.length ? (
        <div className="empty"><span className="mark">库</span>{q.trim() ? '未找到匹配的主题' : '知识库还是空的\n丢几条乱写,主题会自己长出来'}</div>
      ) : (
        <div ref={listRef} className="topics-container" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {topics.map((t) => (
            <div
              className="card topic-card"
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (isDraggingRef.current) return
                openTopic(t.id)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  openTopic(t.id)
                }
              }}
            >
              <div className="t-title">{t.title}</div>
              <div className="t-summary">{t.summary}</div>
              <div className="tags">
                {t.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
