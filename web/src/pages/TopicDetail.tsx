import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { api } from '../api'
import type { Topic, TopicVersion } from '../types'
import DiffView from '../components/DiffView'

/* 把 [[双链]] 预处理成可点击的占位链接 */
function preprocessWikiLinks(md: string): string {
  return md.replace(/\[\[([^\]]+)\]\]/g, (_, title) => `[${title}](#wiki:${encodeURIComponent(title)})`)
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
      load()
    } catch (e) { showToast((e as Error).message) }
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
        <div className="v">v{topic.version} · 已导出到 v{topic.exported_version} · {new Date(topic.updated_at).toLocaleDateString('zh-CN')}</div>
        <div className="tags">{topic.tags.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
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
              return <a href={href} target="_blank" rel="noreferrer">{children}</a>
            },
          }}
        >
          {md}
        </ReactMarkdown>
      </div>

      <div className="versions">
        <button className="btn small ghost" onClick={() => setShowVersions(!showVersions)}>
          {showVersions ? '收起版本历史' : `版本历史(${versions.length})`}
        </button>
        <button className="btn small danger" style={{ marginLeft: '10px' }} onClick={handleDelete}>
          删除
        </button>
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
