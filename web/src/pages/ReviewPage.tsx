import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Capture, Suggestion, Topic } from '../types'

export default function ReviewPage({ tick, onDecided, showToast }: {
  tick: number
  onDecided: () => void
  showToast: (m: string) => void
}) {
  const [items, setItems] = useState<Capture[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([
      api.review(),
      api.topics()
    ]).then(([reviewRes, topicsRes]) => {
      if (active) {
        setItems(reviewRes)
        setTopics(topicsRes)
      }
    }).catch(() => {})
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [tick])

  const act = async (id: string, body: { action: string; topic_id?: string; new_topic_title?: string }) => {
    setBusy(id)
    try {
      await api.decide(id, body)
      setItems((xs) => xs.filter((x) => x.id !== id))
      onDecided()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (loading)
    return <div className="empty">加载中...</div>

  if (!items.length)
    return <div className="empty"><span className="mark">审</span>没有等待确认的归类<br />AI 拿得准的都自动入库了</div>

  return (
    <div className="fade-in">
      <div className="section-title">待确认 <span className="count">AI 拿不准,请你定夺</span></div>
      {items.map((c) => (
        <ReviewCard key={c.id} c={c} topics={topics} busy={busy} act={act} />
      ))}
    </div>
  )
}

function ReviewCard({
  c,
  topics,
  busy,
  act
}: {
  c: Capture
  topics: Topic[]
  busy: string | null
  act: (id: string, body: { action: string; topic_id?: string; new_topic_title?: string }) => Promise<void>
}) {
  const s = (typeof c.suggestion === 'object' ? c.suggestion : null) as Suggestion | null
  const [isReassigning, setIsReassigning] = useState(false)
  const [pickedTopic, setPickedTopic] = useState('')
  const [newTitle, setNewTitle] = useState('')

  return (
    <div className="card review-card">
      <div className="quote">{s?.clean_text || c.raw_text}</div>
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
      <div className="verdict">
        AI 建议:{s?.action === 'new'
          ? <>开新主题 <b>「{s.new_topic_title}」</b></>
          : <>归入 <b>「{s?.topic_title || '?'}」</b></>}
        <div className="reason">{s?.reason}(置信度:{s?.confidence === 'medium' ? '中' : '低'})</div>
      </div>
      {isReassigning ? (
        <>
          <select value={pickedTopic} onChange={(e) => { setPickedTopic(e.target.value); setNewTitle('') }}>
            <option value="">— 改派到已有主题 —</option>
            {topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
          <input type="text" placeholder="或输入新主题标题" value={newTitle}
            onChange={(e) => { setNewTitle(e.target.value); setPickedTopic('') }} />
          <div className="row">
            <button className="btn small ghost" onClick={() => setIsReassigning(false)}>返回</button>
            <button className="btn small primary" disabled={busy === c.id || (!pickedTopic && !newTitle.trim())}
              onClick={() => act(c.id, pickedTopic
                ? { action: 'reassign', topic_id: pickedTopic }
                : { action: 'reassign', new_topic_title: newTitle.trim() })}>
              确认改派
            </button>
          </div>
        </>
      ) : (
        <div className="row">
          <button className="btn small primary" disabled={busy === c.id}
            onClick={() => act(c.id, { action: 'approve' })}>批准</button>
          <button className="btn small" disabled={busy === c.id}
            onClick={() => setIsReassigning(true)}>改派</button>
          <button className="btn small danger" disabled={busy === c.id}
            onClick={() => act(c.id, { action: 'reject' })}>不归档</button>
        </div>
      )}
    </div>
  )
}
