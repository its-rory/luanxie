import { useCallback, useEffect, useRef, useState } from 'react'
import { api, subscribeEvents } from './api'
import CapturePage from './pages/CapturePage'
import InboxPage from './pages/InboxPage'
import ReviewPage from './pages/ReviewPage'
import TopicsPage from './pages/TopicsPage'
import TopicDetail from './pages/TopicDetail'
import SettingsPage from './pages/SettingsPage'
import LoginPage from './pages/LoginPage'
import ErrorBoundary from './components/ErrorBoundary'

export type Tab = 'capture' | 'inbox' | 'review' | 'topics' | 'settings'

const TABS: { key: Tab; glyph: string; label: string }[] = [
  { key: 'capture', glyph: '写', label: '乱写' },
  { key: 'inbox', glyph: '件', label: '收件箱' },
  { key: 'review', glyph: '审', label: '待确认' },
  { key: 'topics', glyph: '库', label: '知识库' },
  { key: 'settings', glyph: '设', label: '设置' },
]

export default function App() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>('capture')
  const [topicId, setTopicId] = useState<string | null>(null)
  const [reviewCount, setReviewCount] = useState(0)
  const [inboxWorkingCount, setInboxWorkingCount] = useState(0)
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
    if (!loggedIn) return
    api.review().then((items) => setReviewCount(items.length)).catch(() => {})
  }, [loggedIn])

  // 收件箱在途作业红点:排队/转写/归类/合并中的任务数
  const refreshInboxWorkingCount = useCallback(() => {
    if (!loggedIn) return
    api.workingCount().then((res) => setInboxWorkingCount(res.count)).catch(() => {})
  }, [loggedIn])

  // Check login status on mount
  useEffect(() => {
    api.me()
      .then((res) => setLoggedIn(res.logged_in))
      .catch(() => setLoggedIn(false))
  }, [])

  // Setup EventSource subscription only when logged in
  useEffect(() => {
    if (!loggedIn) return

    refreshReviewCount()
    refreshInboxWorkingCount()
    const unsubscribe = subscribeEvents((ev) => {
      setTick((t) => t + 1)
      // 任何 capture 离开 awaiting_review(改派/批准 → merging → done,拒绝 → rejected)都刷新待确认计数,
      // 否则点确认进入 merging 后红点不消失。
      if (ev.kind === 'capture') {
        refreshReviewCount()
        // 在途作业数随 capture 状态变化而增减(收录→pending,各阶段→..., done/awaiting_review→移出)
        refreshInboxWorkingCount()
      }
    })

    return () => {
      unsubscribe()
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current)
      }
    }
  }, [loggedIn, refreshReviewCount, refreshInboxWorkingCount])

  const openTopic = useCallback((id: string) => {
    setTopicId(id)
    setTab('topics')
  }, [])

  // 1. Loading state
  if (loggedIn === null) {
    return <div className="empty">加载中...</div>
  }

  // 2. Not logged in state
  if (loggedIn === false) {
    return (
      <>
        <LoginPage onLoginSuccess={() => setLoggedIn(true)} />
        {toast && <div className="toast">{toast}</div>}
      </>
    )
  }

  // 3. Logged in state
  return (
    <>
      <header className="masthead">
        <h1>乱写</h1>
        <span className="seal">收录</span>
        <span className="sub">丢进来,慢慢长</span>
      </header>
      <main>
        <ErrorBoundary key={tab}>
          {tab === 'capture' && <CapturePage onDone={() => { showToast('已收录,后台整理中'); }} showToast={showToast} />}
          {tab === 'inbox' && <InboxPage tick={tick} openTopic={openTopic} showToast={showToast} />}
          {tab === 'review' && (
            <ReviewPage tick={tick} onDecided={() => { refreshReviewCount(); showToast('已处理') }} showToast={showToast} />
          )}
          {tab === 'topics' && !topicId && <TopicsPage tick={tick} openTopic={setTopicId} />}
          {tab === 'topics' && topicId && (
            <TopicDetail id={topicId} back={() => setTopicId(null)} openByTitle={async (title) => {
              const hit = await api.topics(undefined, title).then((res) => res[0]).catch(() => null)
              if (hit) setTopicId(hit.id)
            }} showToast={showToast} />
          )}
          {tab === 'settings' && <SettingsPage showToast={showToast} onLogout={() => setLoggedIn(false)} />}
        </ErrorBoundary>
      </main>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''}
            onClick={() => { setTab(t.key); if (t.key !== 'topics') setTopicId(null) }}>
            <span className="glyph">{t.glyph}</span>
            {t.label}
            {t.key === 'review' && reviewCount > 0 && <span className="badge">{reviewCount}</span>}
            {t.key === 'inbox' && inboxWorkingCount > 0 && <span className="badge">{inboxWorkingCount}</span>}
          </button>
        ))}
      </nav>
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
