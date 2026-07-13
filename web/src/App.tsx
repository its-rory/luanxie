import { useCallback, useEffect, useRef, useState } from 'react'
import { api, subscribeEvents } from './api'
import CapturePage from './pages/CapturePage'
import InboxPage from './pages/InboxPage'
import ReviewPage from './pages/ReviewPage'
import TopicsPage from './pages/TopicsPage'
import TopicDetail from './pages/TopicDetail'
import SettingsPage from './pages/SettingsPage'

export type Tab = 'capture' | 'inbox' | 'review' | 'topics' | 'settings'

const TABS: { key: Tab; glyph: string; label: string }[] = [
  { key: 'capture', glyph: '写', label: '乱写' },
  { key: 'inbox', glyph: '件', label: '收件箱' },
  { key: 'review', glyph: '审', label: '待确认' },
  { key: 'topics', glyph: '库', label: '知识库' },
  { key: 'settings', glyph: '设', label: '设置' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('capture')
  const [topicId, setTopicId] = useState<string | null>(null)
  const [reviewCount, setReviewCount] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const [tick, setTick] = useState(0) // SSE 驱动的刷新信号

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current)
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null)
      toastTimerRef.current = null
    }, 2600)
  }, [])

  const refreshReviewCount = useCallback(() => {
    api.review().then((items) => setReviewCount(items.length)).catch(() => {})
  }, [])

  useEffect(() => {
    refreshReviewCount()
    const unsubscribe = subscribeEvents((ev) => {
      setTick((t) => t + 1)
      if (ev.kind === 'capture' && ev.status === 'awaiting_review') refreshReviewCount()
      if (ev.kind === 'capture' && ev.status === 'done') refreshReviewCount()
    })
    return () => {
      unsubscribe()
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current)
      }
    }
  }, [refreshReviewCount])

  const openTopic = useCallback((id: string) => {
    setTopicId(id)
    setTab('topics')
  }, [])

  return (
    <>
      <header className="masthead">
        <h1>乱写</h1>
        <span className="seal">收录</span>
        <span className="sub">丢进来,慢慢长</span>
      </header>
      <main>
        {tab === 'capture' && <CapturePage onDone={() => { showToast('已收录,后台整理中'); }} showToast={showToast} />}
        {tab === 'inbox' && <InboxPage tick={tick} openTopic={openTopic} showToast={showToast} />}
        {tab === 'review' && (
          <ReviewPage tick={tick} onDecided={() => { refreshReviewCount(); showToast('已处理') }} showToast={showToast} />
        )}
        {tab === 'topics' && !topicId && <TopicsPage tick={tick} openTopic={setTopicId} />}
        {tab === 'topics' && topicId && (
          <TopicDetail id={topicId} back={() => setTopicId(null)} openByTitle={async (title) => {
            const list = await api.topics()
            const hit = list.find((t) => t.title === title)
            if (hit) setTopicId(hit.id)
          }} showToast={showToast} />
        )}
        {tab === 'settings' && <SettingsPage showToast={showToast} />}
      </main>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''}
            onClick={() => { setTab(t.key); if (t.key !== 'topics') setTopicId(null) }}>
            <span className="glyph">{t.glyph}</span>
            {t.label}
            {t.key === 'review' && reviewCount > 0 && <span className="badge">{reviewCount}</span>}
          </button>
        ))}
      </nav>
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
