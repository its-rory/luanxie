import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import Sortable from 'sortablejs'
import { api } from '../api'
import type { Capture, CaptureVersion, Topic, TopicVersion } from '../types'
import DiffView from '../components/DiffView'
import AudioPlayButton from '../components/AudioPlayButton'

/* 把 [[双链]] 和 ^cap-xxxx 预处理成可点击的占位链接 */
function preprocessWikiLinks(md: string): string {
  let res = md.replace(/\[\[([^\]]+)\]\]/g, (_, title) => `[${title}](#wiki:${encodeURIComponent(title)})`)
  // 按行分割处理，检测是否为图片收录，提供不同的占位文案
  const lines = res.split('\n')
  const processed = lines.map(line => {
    if (line.includes('^cap-')) {
      const isImage = line.includes('[图片提取]')
      const label = isImage ? '🖼️ 看原图' : '🔊 听原音'
      return line.replace(/\^cap-([a-f0-9]+)/gi, (_, capId) => `[${label}](#audio-play:${capId})`)
    }
    return line
  })
  return processed.join('\n')
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

export default function TopicDetail({ id, back, openTopic, openByTitle, showToast, highlightCaptureId }: {
  id: string
  back: () => void
  openTopic?: (id: string, captureId?: string) => void
  openByTitle: (title: string) => void
  showToast: (m: string) => void
  highlightCaptureId?: string | null
}) {
  const [topic, setTopic] = useState<Topic | null>(null)
  const [versions, setVersions] = useState<TopicVersion[]>([])
  const [showVersions, setShowVersions] = useState(false)
  const [diffFor, setDiffFor] = useState<number | null>(null)

  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editAiParse, setEditAiParse] = useState('')
  const [editTrajectory, setEditTrajectory] = useState('')
  const [saving, setSaving] = useState(false)

  const [isEditingTags, setIsEditingTags] = useState(false)
  const [tagInput, setTagInput] = useState('')

  // Sub-cards captures state
  const [captures, setCaptures] = useState<Capture[]>([])
  const [loadingCaptures, setLoadingCaptures] = useState(false)
  const [editingCaptureId, setEditingCaptureId] = useState<string | null>(null)
  const [editCapClean, setEditCapClean] = useState('')
  const [editCapRaw, setEditCapRaw] = useState('')
  const [savingCapture, setSavingCapture] = useState(false)
  const [activeCapVersions, setActiveCapVersions] = useState<Record<string, { versions: CaptureVersion[]; show: boolean }>>({})
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [editCapTitle, setEditCapTitle] = useState('')
  const [activeMenuCapId, setActiveMenuCapId] = useState<string | null>(null)
  const [showTopicMenu, setShowTopicMenu] = useState(false)

  // Auto-scroll to target sub-card when navigated from Inbox
  const hasScrolledTargetRef = useRef<string | null>(null)
  useEffect(() => {
    if (!highlightCaptureId) {
      hasScrolledTargetRef.current = null
      return
    }
    if (loadingCaptures || captures.length === 0) return
    if (hasScrolledTargetRef.current === highlightCaptureId) return

    const timer = setTimeout(() => {
      const el = document.getElementById(`sub-card-${highlightCaptureId}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        hasScrolledTargetRef.current = highlightCaptureId
      }
    }, 150)

    return () => clearTimeout(timer)
  }, [highlightCaptureId, loadingCaptures, captures])

  // Sub-card reordering state
  const [isReorderingCaps, setIsReorderingCaps] = useState(false)
  const [reorderList, setReorderList] = useState<Capture[]>([])
  const [savingReorder, setSavingReorder] = useState(false)
  const reorderContainerRef = useRef<HTMLDivElement>(null)
  const subCardSortableRef = useRef<Sortable | null>(null)
  const isDraggingCapRef = useRef(false)
  const reorderListRef = useRef<Capture[]>([])
  reorderListRef.current = reorderList

  // Topic merge modal state
  const [showMergeModal, setShowMergeModal] = useState(false)
  const [mergeStep, setMergeStep] = useState<1 | 2>(1)
  const [candidateTopics, setCandidateTopics] = useState<Topic[]>([])
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [selectedTargetTopic, setSelectedTargetTopic] = useState<Topic | null>(null)
  const [merging, setMerging] = useState(false)

  useEffect(() => {
    const handleClickOutside = () => {
      setActiveMenuCapId(null)
      setShowTopicMenu(false)
    }
    if (activeMenuCapId || showTopicMenu) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [activeMenuCapId, showTopicMenu])

  const load = useCallback((active = { current: true }) => {
    api.topic(id).then(res => { if (active.current) setTopic(res); }).catch(() => {})
    api.versions(id).then(res => { if (active.current) setVersions(res); }).catch(() => {})
    
    setLoadingCaptures(true)
    api.topicCaptures(id)
      .then(res => { if (active.current) setCaptures(res); })
      .catch(() => {})
      .finally(() => { if (active.current) setLoadingCaptures(false); })
  }, [id])

  useEffect(() => {
    const active = { current: true }
    load(active)
    return () => {
      active.current = false
    }
  }, [load])

  const md = useMemo(() => preprocessWikiLinks(topic?.body_md || ''), [topic?.body_md])

  const rollback = async (v: number) => {
    if (!confirm(`回滚到 v${v}?当前内容会存为新版本,可再滚回来。`)) return
    try {
      await api.rollback(id, v)
      showToast(`已回滚到 v${v}`)
      setDiffFor(null)
      setIsEditing(false)
      load()
    } catch (e) { showToast((e as Error).message) }
  }

  const handleStartEdit = () => {
    if (!topic) return
    const { aiParse, trajectory } = parseTopicBody(topic.body_md || '')
    setEditTitle(topic.title)
    setEditAiParse(aiParse)
    setEditTrajectory(trajectory)
    setIsEditing(true)
  }

  const handleCancel = () => {
    setIsEditing(false)
  }

  const handleSave = async () => {
    if (!topic) return
    if (!editTitle.trim()) {
      showToast('标题不能为空')
      return
    }
    setSaving(true)
    try {
      const payload: { title: string; body_md?: string } = {
        title: editTitle.trim()
      }
      if (topic.body_md && topic.body_md.trim()) {
        payload.body_md = `## AI解析\n${editAiParse.trim()}\n\n## 记录轨迹\n${editTrajectory.trim()}`
      }
      const updated = await api.patchTopic(id, payload)
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

  const handleSaveTags = async () => {
    if (!topic) return
    const parsedTags = tagInput
      .split(/[,，\s]+/)
      .map(t => t.trim())
      .filter(t => t.length > 0)
    try {
      const updated = await api.patchTopic(id, { tags: parsedTags })
      setTopic(updated)
      setIsEditingTags(false)
      showToast('标签更新成功')
    } catch (e) {
      showToast('保存标签失败: ' + (e as Error).message)
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

  const handleStartEditCapture = (cap: Capture) => {
    setEditingCaptureId(cap.id)
    setEditCapTitle(cap.title || '')
    setEditCapClean(cap.clean_text || '')
    setEditCapRaw(cap.raw_text || cap.transcript || '')
  }

  const handleCancelEditCapture = () => {
    setEditingCaptureId(null)
  }

  const handleSaveCapture = async (cap: Capture) => {
    setSavingCapture(true)
    try {
      const payload: { clean_text: string; raw_text?: string; transcript?: string; title: string } = {
        clean_text: editCapClean.trim(),
        title: editCapTitle.trim()
      }
      if (cap.type === 'audio') {
        payload.transcript = editCapRaw.trim()
      } else {
        payload.raw_text = editCapRaw.trim()
      }
      await api.patchCapture(cap.id, payload)
      showToast('保存成功')
      setEditingCaptureId(null)
      const caps = await api.topicCaptures(id)
      setCaptures(caps)

      if (activeCapVersions[cap.id]?.show) {
        const vers = await api.captureVersions(cap.id)
        setActiveCapVersions(prev => ({
          ...prev,
          [cap.id]: { ...prev[cap.id], versions: vers }
        }))
      }
    } catch (e) {
      showToast('保存子卡片失败: ' + (e as Error).message)
    } finally {
      setSavingCapture(false)
    }
  }

  const handleDeleteCapture = async (capId: string) => {
    if (!confirm('确定要删除此条记录及关联的音频/图片文件吗？此操作不可逆！')) return
    try {
      const res = await api.deleteTopicCapture(capId)
      if (res.topic_deleted) {
        // 该子卡片是主题下最后一条,删除后主题已同步删除
        showToast('删除成功,主题同步删除')
        back()
      } else {
        showToast('记录已成功删除')
        const caps = await api.topicCaptures(id)
        setCaptures(caps)
      }
    } catch (e) {
      showToast('删除子卡片失败: ' + (e as Error).message)
    }
  }

  const toggleCapVersions = async (capId: string) => {
    const isShowing = activeCapVersions[capId]?.show
    if (isShowing) {
      setActiveCapVersions(prev => ({
        ...prev,
        [capId]: { ...prev[capId], show: false }
      }))
    } else {
      try {
        const vers = await api.captureVersions(capId)
        setActiveCapVersions(prev => ({
          ...prev,
          [capId]: { versions: vers, show: true }
        }))
      } catch (e) {
        showToast('读取版本历史失败: ' + (e as Error).message)
      }
    }
  }

  const handleRollbackCapture = async (capId: string, version: number) => {
    if (!confirm(`确定回滚此卡片到版本 v${version} 吗？`)) return
    try {
      await api.rollbackCapture(capId, version)
      showToast('已成功回滚')
      const caps = await api.topicCaptures(id)
      setCaptures(caps)
      const vers = await api.captureVersions(capId)
      setActiveCapVersions(prev => ({
        ...prev,
        [capId]: { versions: vers, show: true }
      }))
    } catch (e) {
      showToast('回滚失败: ' + (e as Error).message)
    }
  }

  const handleTogglePin = async (capId: string) => {
    setActiveMenuCapId(null)
    try {
      const updated = await api.togglePinCapture(capId)
      setCaptures((prev) => {
        const next = prev.map((c) => (c.id === capId ? { ...c, is_pinned: updated.is_pinned, pinned_at: updated.pinned_at } : c))
        return next.sort((a, b) => {
          const aPinned = a.is_pinned ? 1 : 0
          const bPinned = b.is_pinned ? 1 : 0
          if (aPinned !== bPinned) return bPinned - aPinned
          if (aPinned && bPinned) {
            return (b.pinned_at || '').localeCompare(a.pinned_at || '')
          }
          return (a.created_at || '').localeCompare(b.created_at || '')
        })
      })
      showToast(updated.is_pinned ? '已置顶该子卡片' : '已取消置顶')
    } catch (err: any) {
      showToast(err.message || '操作失败')
    }
  }

  const copySubCardMarkdown = (cap: Capture, idx: number) => {
    const title = cap.title ? cap.title : `子卡片 #${idx + 1}`
    const typeLabel = cap.type === 'audio' ? '语音' : cap.type === 'image' ? '图片' : '文本'
    const timeStr = new Date(cap.created_at).toLocaleString('zh-CN', { hour12: false })
    const clean = (cap.clean_text || '').trim()
    const raw = (cap.transcript || cap.raw_text || '').trim()

    let md = `### ${title}\n`
    md += `> 类型: ${typeLabel} | 时间: ${timeStr}\n\n`
    if (clean) {
      md += `#### AI解析\n${clean}\n\n`
    }
    if (raw) {
      md += `#### 记录轨迹\n${raw}\n`
    }
    navigator.clipboard.writeText(md.trim()).then(() => {
      showToast('已复制子卡片 Markdown 内容')
    }).catch(() => {
      showToast('复制失败，请检查剪贴板权限')
    })
  }

  const getWordCount = (cap: Capture) => {
    const text = [cap.title, cap.clean_text, cap.transcript, cap.raw_text]
      .filter(Boolean)
      .join('')
      .replace(/\s+/g, '')
    return text.length
  }

  const handleStartReorder = () => {
    setActiveMenuCapId(null)
    setReorderList([...captures])
    setIsReorderingCaps(true)
  }

  const handleCancelReorder = () => {
    setIsReorderingCaps(false)
    setReorderList([])
  }

  const handleSaveReorder = async () => {
    setSavingReorder(true)
    try {
      const ids = reorderList.map((c) => c.id)
      await api.reorderCaptures(id, ids)
      setCaptures(reorderList)
      setIsReorderingCaps(false)
      showToast('子卡片排序已保存')
    } catch (e: any) {
      showToast('保存排序失败: ' + (e.message || String(e)))
    } finally {
      setSavingReorder(false)
    }
  }

  useEffect(() => {
    if (!isReorderingCaps || !reorderContainerRef.current) {
      if (subCardSortableRef.current) {
        subCardSortableRef.current.destroy()
        subCardSortableRef.current = null
      }
      return
    }

    subCardSortableRef.current = Sortable.create(reorderContainerRef.current, {
      animation: 260,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      delay: 350,
      delayOnTouchOnly: false,
      touchStartThreshold: 5,
      handle: '.drag-handle',
      chosenClass: 'sortable-chosen',
      ghostClass: 'sortable-ghost',
      dragClass: 'sortable-drag',
      draggable: '.sub-card-collapsed',
      forceFallback: false,
      onStart: () => {
        isDraggingCapRef.current = true
        if ('vibrate' in navigator) {
          try { navigator.vibrate(40) } catch {}
        }
      },
      onEnd: (evt) => {
        setTimeout(() => { isDraggingCapRef.current = false }, 80)
        const { oldIndex, newIndex } = evt
        if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return
        const current = [...reorderListRef.current]
        const [moved] = current.splice(oldIndex, 1)
        current.splice(newIndex, 0, moved)
        setReorderList(current)
      },
    })

    return () => {
      if (subCardSortableRef.current) {
        subCardSortableRef.current.destroy()
        subCardSortableRef.current = null
      }
    }
  }, [isReorderingCaps])

  const handleOpenMerge = async () => {
    setShowMergeModal(true)
    setMergeStep(1)
    setSelectedTargetTopic(null)
    setLoadingCandidates(true)
    try {
      const list = await api.topics()
      setCandidateTopics(list.filter((t) => t.id !== id))
    } catch {
      showToast('获取主题列表失败')
    } finally {
      setLoadingCandidates(false)
    }
  }

  const handleExecuteMerge = async (position: 'time' | 'end' | 'start') => {
    if (!selectedTargetTopic) return
    setMerging(true)
    try {
      const merged = await api.mergeTopic(id, selectedTargetTopic.id, position)
      showToast(`已成功合并到「${merged.title}」`)
      setShowMergeModal(false)
      if (openTopic) {
        openTopic(merged.id)
      } else {
        back()
      }
    } catch (e: any) {
      showToast('合并失败: ' + (e.message || String(e)))
    } finally {
      setMerging(false)
    }
  }

  if (!topic) return <div className="empty">加载中...</div>

  const diffTarget = versions.find((v) => v.version === diffFor)

  return (
    <div className="fade-in">
      <div className="detail-head">
        <button className="back" onClick={back}>← 知识库</button>
        {isEditing ? (
          <div style={{ marginTop: '8px', marginBottom: '8px' }}>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              style={{
                background: 'var(--paper-deep)',
                color: 'var(--ink)',
                border: '1px solid var(--line)',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '20px',
                fontFamily: 'var(--serif)',
                fontWeight: 'bold',
                width: '100%',
                marginBottom: '8px'
              }}
              placeholder="输入主题标题..."
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn small primary" onClick={handleSave} disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </button>
              <button className="btn small ghost" onClick={handleCancel} disabled={saving}>
                取消
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', position: 'relative' }}>
            <h2 style={{ margin: 0, flex: 1, wordBreak: 'break-word' }}>{topic.title}</h2>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <button
                className="card-menu-trigger"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowTopicMenu(!showTopicMenu)
                }}
                title="主题操作"
                aria-label="主题操作"
              >
                ···
              </button>
              {showTopicMenu && (
                <div className="card-menu-popover" onClick={(e) => e.stopPropagation()} style={{ width: '150px' }}>
                  <button
                    className="card-menu-item"
                    onClick={() => {
                      setShowTopicMenu(false)
                      handleOpenMerge()
                    }}
                  >
                    <span className="menu-icon">🔀</span>
                    <span>合并主题</span>
                  </button>
                  <button
                    className="card-menu-item"
                    onClick={() => {
                      setShowTopicMenu(false)
                      handleStartEdit()
                    }}
                  >
                    <span className="menu-icon">✏️</span>
                    <span>编辑主题标题</span>
                  </button>
                  <div className="card-menu-divider" />
                  <button
                    className="card-menu-item danger"
                    onClick={() => {
                      setShowTopicMenu(false)
                      handleDelete()
                    }}
                  >
                    <span className="menu-icon">🗑️</span>
                    <span>删除此主题</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        <div className="v" style={{ marginTop: '6px' }}>子卡片共 {captures.length} 个 · {new Date(topic.updated_at).toLocaleDateString('zh-CN')}</div>
        <div className="tags" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
          {isEditingTags ? (
            <>
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="标签以逗号或空格分隔"
                style={{
                  background: 'var(--paper-deep)',
                  color: 'var(--ink)',
                  border: '1px solid var(--line)',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '12px',
                  width: '200px'
                }}
              />
              <button
                className="btn small primary"
                style={{ height: '26px', padding: '0 8px', fontSize: '12px' }}
                onClick={handleSaveTags}
              >
                ✓
              </button>
              <button
                className="btn small ghost"
                style={{ height: '26px', padding: '0 8px', fontSize: '12px', marginLeft: '4px' }}
                onClick={() => setIsEditingTags(false)}
              >
                ✗
              </button>
            </>
          ) : (
            <>
              {topic.tags.map((t) => <span className="tag" key={t}>{t}</span>)}
              <button
                onClick={() => {
                  setTagInput(topic.tags.join(', '))
                  setIsEditingTags(true)
                }}
                className="action-btn"
                style={{ height: '24px', padding: '0 6px', fontSize: '12px', marginLeft: '6px' }}
                title="修改标签"
              >
                ✏️
              </button>
            </>
          )}
        </div>
      </div>

      {isEditing && topic.body_md && topic.body_md.trim() && (
        <div className="note-body" style={{ display: 'flex', flexDirection: 'column', gap: '18px', marginBottom: '20px' }}>
          <div>
            <div style={{ fontFamily: 'var(--serif)', fontWeight: 'bold', fontSize: '16px', color: 'var(--ink)', marginBottom: '8px' }}>
              ## 历史大网志 AI解析 (编辑)
            </div>
            <textarea
              value={editAiParse}
              onChange={(e) => setEditAiParse(e.target.value)}
              style={{
                width: '100%',
                minHeight: '200px',
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
              placeholder="输入旧版AI解析..."
            />
          </div>
          <div>
            <div style={{ fontFamily: 'var(--serif)', fontWeight: 'bold', fontSize: '16px', color: 'var(--ink)', marginBottom: '8px' }}>
              ## 历史大网志 记录轨迹 (编辑)
            </div>
            <textarea
              value={editTrajectory}
              onChange={(e) => setEditTrajectory(e.target.value)}
              style={{
                width: '100%',
                minHeight: '140px',
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
              placeholder="输入旧版轨迹..."
            />
          </div>
        </div>
      )}

      {/* Backward Compatibility: Display old body_md text if exists */}
      {!isEditing && topic.body_md && topic.body_md.trim().replace(/## AI解析|## 记录轨迹/g, '').trim() && (
        <div style={{ background: 'var(--paper-deep)', border: '1px solid var(--line)', borderRadius: '12px', padding: '16px', marginBottom: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--ochre)', marginBottom: '10px', borderBottom: '1px solid var(--line)', paddingBottom: '4px' }}>
            ⚠️ 历史合并版正文 (旧版存档数据)
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
                  if (href?.startsWith('#audio-play:')) {
                    const capId = href.slice(12)
                    const capType = captures.find((c) => c.id === capId)?.type as 'audio' | 'image' | 'text' | undefined
                    return <AudioPlayButton capId={capId} initialLabel={children} initialType={capType ?? null} />
                  }
                  return <a href={href} target="_blank" rel="noreferrer">{children}</a>
                },
              }}
            >
              {md}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Render captures as separate sub-cards */}
      <div className="sub-cards-feed" style={{ display: 'flex', flexDirection: 'column', gap: isReorderingCaps ? '10px' : '20px', marginTop: '24px', marginBottom: '24px' }}>
        {isReorderingCaps ? (
          <>
            <div className="reorder-control-bar">
              <div className="reorder-hint">
                <span>↕️ 调整子卡片顺序</span>
                <span style={{ fontSize: '11px', color: 'var(--ink-faint)', fontWeight: 'normal' }}>(长按或拖拽右侧手柄)</span>
              </div>
              <div className="reorder-actions">
                <button className="btn small ghost" onClick={handleCancelReorder} disabled={savingReorder}>
                  取消
                </button>
                <button className="btn small primary" onClick={handleSaveReorder} disabled={savingReorder}>
                  {savingReorder ? '保存中…' : '完成'}
                </button>
              </div>
            </div>

            <div ref={reorderContainerRef} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {reorderList.map((cap, idx) => (
                <div 
                  key={cap.id} 
                  className={`sub-card-collapsed ${Boolean(cap.is_pinned) ? 'pinned' : ''}`}
                >
                  <div className="collapsed-title">
                    {Boolean(cap.is_pinned) && (
                      <span className="pinned-badge" style={{ padding: '0 4px', fontSize: '10px' }}>📌 置顶</span>
                    )}
                    <span>子卡片 #{idx + 1}{cap.title ? ` : ${cap.title}` : ''}</span>
                  </div>
                  <div className="drag-handle" title="长按或拖拽排序">
                    ☰
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <h3 style={{ fontFamily: 'var(--serif)', fontSize: '18px', fontWeight: 'bold', borderBottom: '2px solid var(--line)', paddingBottom: '8px', color: 'var(--ink)', margin: 0 }}>
              子记录卡片清单 ({captures.length})
            </h3>

            {loadingCaptures && captures.length === 0 ? (
              <div style={{ color: 'var(--ink-soft)', fontSize: '14px', textAlign: 'center', padding: '24px' }}>数据加载中…</div>
            ) : captures.length === 0 ? (
              <div style={{ color: 'var(--ink-soft)', fontSize: '14px', textAlign: 'center', padding: '24px', background: 'var(--paper-deep)', borderRadius: '12px' }}>
                暂无子记录 (该主题为空或未分配捕获)
              </div>
            ) : (
          captures.map((cap, idx) => {
            const isEditingCap = editingCaptureId === cap.id
            const capVerState = activeCapVersions[cap.id] || { versions: [], show: false }
            
            const timeStr = new Date(cap.created_at).toLocaleString('zh-CN', {
              hour12: false,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            })
            const typeLabel = cap.type === 'audio' ? '🔊 语音' : cap.type === 'image' ? '🖼️ 图片' : '📝 文本'

            const isPinned = Boolean(cap.is_pinned)
            const wordCount = getWordCount(cap)

            const isHighlighted = highlightCaptureId === cap.id

            return (
              <div 
                key={cap.id} 
                id={`sub-card-${cap.id}`}
                className={`sub-card ${isPinned ? 'pinned' : ''} ${isHighlighted ? 'highlight-target' : ''}`}
              >
                {/* Sub-card header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '14.5px', color: 'var(--ink)' }}>子卡片 #{idx + 1}{cap.title ? ` : ${cap.title}` : ''}</span>
                    <span className="tag" style={{ fontSize: '11px' }}>
                      {typeLabel}
                    </span>
                    {isPinned && (
                      <span className="pinned-badge">
                        📌 置顶
                      </span>
                    )}
                    {isHighlighted && (
                      <span className="target-card-badge">
                        🎯 来自收件箱
                      </span>
                    )}
                  </div>
                  
                  <div style={{ position: 'relative' }}>
                    {!isEditingCap && (
                      <>
                        <button 
                          className="card-menu-trigger" 
                          onClick={(e) => {
                            e.stopPropagation()
                            setActiveMenuCapId(activeMenuCapId === cap.id ? null : cap.id)
                          }}
                          title="更多操作"
                          aria-label="更多操作"
                        >
                          ···
                        </button>
                        {activeMenuCapId === cap.id && (
                          <div className="card-menu-popover" onClick={(e) => e.stopPropagation()}>
                            <button 
                              className="card-menu-item" 
                              onClick={() => {
                                setActiveMenuCapId(null)
                                handleStartEditCapture(cap)
                              }}
                            >
                              <span className="menu-icon">✏️</span>
                              <span>编辑</span>
                            </button>
                            <button 
                              className="card-menu-item" 
                              onClick={() => {
                                setActiveMenuCapId(null)
                                copySubCardMarkdown(cap, idx)
                              }}
                            >
                              <span className="menu-icon">📋</span>
                              <span>复制</span>
                            </button>
                            <button 
                              className="card-menu-item" 
                              onClick={() => handleTogglePin(cap.id)}
                            >
                              <span className="menu-icon">📌</span>
                              <span>{isPinned ? '取消置顶' : '置顶'}</span>
                            </button>
                            <button 
                              className="card-menu-item" 
                              onClick={() => handleStartReorder()}
                            >
                              <span className="menu-icon">↕️</span>
                              <span>排序</span>
                            </button>
                            <div className="card-menu-divider" />
                            <button 
                              className="card-menu-item danger" 
                              onClick={() => {
                                setActiveMenuCapId(null)
                                handleDeleteCapture(cap.id)
                              }}
                            >
                              <span className="menu-icon">🗑️</span>
                              <span>删除</span>
                            </button>
                            <div className="card-menu-divider" />
                            <div className="card-menu-footer">
                              字数统计: {wordCount}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Sub-card body */}
                {isEditingCap ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--ink-soft)', display: 'block', marginBottom: '3px' }}>子卡片标题 (Title)</label>
                      <input
                        type="text"
                        value={editCapTitle}
                        onChange={(e) => setEditCapTitle(e.target.value)}
                        style={{
                          width: '100%',
                          background: 'var(--paper-deep)',
                          color: 'var(--ink)',
                          border: '1px solid var(--line)',
                          borderRadius: '8px',
                          padding: '6px 8px',
                          fontFamily: 'inherit',
                          fontSize: '13px',
                          marginBottom: '8px'
                        }}
                        placeholder="输入子卡片标题..."
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--ink-soft)', display: 'block', marginBottom: '3px' }}>AI解析 (Clean Text)</label>
                      <textarea
                        value={editCapClean}
                        onChange={(e) => setEditCapClean(e.target.value)}
                        style={{
                          width: '100%',
                          minHeight: '120px',
                          background: 'var(--paper-deep)',
                          color: 'var(--ink)',
                          border: '1px solid var(--line)',
                          borderRadius: '8px',
                          padding: '8px',
                          fontFamily: 'inherit',
                          fontSize: '13px',
                          lineHeight: '1.5'
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--ink-soft)', display: 'block', marginBottom: '3px' }}>
                        {cap.type === 'audio' ? '语音转写原文 (Transcript)' : '原始输入 (Raw Text)'}
                      </label>
                      <textarea
                        value={editCapRaw}
                        onChange={(e) => setEditCapRaw(e.target.value)}
                        style={{
                          width: '100%',
                          minHeight: '80px',
                          background: 'var(--paper-deep)',
                          color: 'var(--ink)',
                          border: '1px solid var(--line)',
                          borderRadius: '8px',
                          padding: '8px',
                          fontFamily: 'inherit',
                          fontSize: '13px',
                          lineHeight: '1.5'
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
                      <button className="btn small ghost" onClick={handleCancelEditCapture} disabled={savingCapture}>取消</button>
                      <button className="btn small primary" onClick={() => handleSaveCapture(cap)} disabled={savingCapture}>
                        {savingCapture ? '保存中…' : '保存'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div>
                      <div style={{ fontFamily: 'var(--serif)', fontWeight: 'bold', fontSize: '18px', color: 'var(--ink)', marginBottom: '8px', borderBottom: '1px solid var(--line)', paddingBottom: '4px' }}>
                        AI解析
                      </div>
                      <div className="clean-content" style={{ fontSize: '15px', lineHeight: '1.85', color: 'var(--ink)' }}>
                        <ReactMarkdown>
                          {(() => {
                            const text = cap.clean_text || '(暂无解析)'
                            const lines = text.split('\n')
                            const listFormatted = lines.map(line => {
                              const trimmed = line.trim()
                              if (!trimmed) return ''
                              if (/^([-*+:]|\d+\.)\s/.test(trimmed)) {
                                return line
                              }
                              return `- ${trimmed}`
                            }).filter(l => l !== '').join('\n')
                            return listFormatted
                          })()}
                        </ReactMarkdown>
                      </div>
                    </div>

                    <div>
                      <div style={{ fontFamily: 'var(--serif)', fontWeight: 'bold', fontSize: '18px', color: 'var(--ink)', marginBottom: '8px', borderBottom: '1px solid var(--line)', paddingBottom: '4px' }}>
                        记录轨迹
                      </div>
                      <div className="trajectory-content" style={{ fontSize: '15px', lineHeight: '1.85', color: 'var(--ink)' }}>
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
                                return <AudioPlayButton capId={capId} initialLabel={children} initialType={cap.type} />
                              }
                              return <a href={href} target="_blank" rel="noreferrer">{children}</a>
                            },
                          }}
                        >
                          {(() => {
                            const dateStr = new Date(cap.created_at).toLocaleDateString('sv-SE')
                            const line = cap.type === 'image'
                              ? `- ${dateStr} 收录: [图片提取] “${cap.raw_text || ''}” ^cap-${cap.id}`
                              : `- ${dateStr} 收录: “${cap.transcript || cap.raw_text || ''}” ^cap-${cap.id}`
                            return preprocessWikiLinks(line)
                          })()}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                )}

                {/* Sub-card footer */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', borderTop: '1px solid var(--line)', paddingTop: '8px', fontSize: '11px', color: 'var(--ink-faint)' }}>
                  <span>生成时间: {timeStr}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button 
                      className="action-btn" 
                      onClick={() => toggleCapVersions(cap.id)}
                      style={{ height: '22px', padding: '0 8px', fontSize: '11px', borderRadius: '4px' }}
                    >
                      {capVerState.show ? '收起历史' : `历史(${cap.version || 0})`}
                    </button>
                  </div>
                </div>

                {/* Sub-card Version History */}
                {capVerState.show && (
                  <div style={{ marginTop: '8px', background: 'var(--paper-deep)', padding: '10px 12px', borderRadius: '8px', border: '1px dashed var(--line)' }}>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--ink)', marginBottom: '8px' }}>子卡片版本历史 ({capVerState.versions.length})</div>
                    {capVerState.versions.length === 0 ? (
                      <div style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>暂无历史编辑记录</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {capVerState.versions.map((cv) => (
                          <div 
                            key={cv.id} 
                            style={{ 
                              display: 'flex', 
                              justifyContent: 'space-between', 
                              alignItems: 'center', 
                              fontSize: '12px',
                              background: 'var(--paper-card)',
                              padding: '6px 8px',
                              borderRadius: '6px',
                              border: '1px solid var(--line)'
                            }}
                          >
                            <div>
                              <span style={{ fontWeight: 'bold', marginRight: '8px' }}>v{cv.version}</span>
                              <span style={{ color: 'var(--ink-faint)', fontSize: '11px' }}>{new Date(cv.created_at).toLocaleString()}</span>
                            </div>
                            <button 
                              className="action-btn"
                              onClick={() => handleRollbackCapture(cap.id, cv.version)}
                            >
                              回滚
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
          </>
        )}
      </div>

      {topic.body_md && topic.body_md.trim() && (
        <div className="versions" style={{ marginTop: '24px', marginBottom: '36px', paddingTop: '16px', borderTop: '1px solid var(--line)', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn small ghost" onClick={() => setShowVersions(!showVersions)}>
            {showVersions ? '收起版本历史' : `主题历史(${versions.length})`}
          </button>
          {showVersions && versions.map((v) => (
            <div key={v.id} style={{ width: '100%' }}>
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
      )}

      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            cursor: 'zoom-out',
            animation: 'fadeIn 0.15s ease-out'
          }}
        >
          <img
            src={lightboxUrl}
            alt="收录原图"
            style={{
              maxWidth: '92%',
              maxHeight: '92%',
              borderRadius: '8px',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.4)',
              objectFit: 'contain',
              cursor: 'default'
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {showMergeModal && (
        <div className="modal-backdrop" onClick={() => !merging && setShowMergeModal(false)}>
          <div className="merge-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="merge-dialog-header">
              <h3>{mergeStep === 1 ? '选择要合并到的目标主题' : `合并到:「${selectedTargetTopic?.title}」`}</h3>
              <button className="merge-dialog-close" onClick={() => !merging && setShowMergeModal(false)} disabled={merging}>
                ✕
              </button>
            </div>

            <div className="merge-dialog-body">
              {mergeStep === 1 ? (
                <>
                  {loadingCandidates ? (
                    <div style={{ textAlign: 'center', padding: '24px', color: 'var(--ink-soft)', fontSize: '13px' }}>
                      正在加载主题列表…
                    </div>
                  ) : candidateTopics.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px', color: 'var(--ink-soft)', fontSize: '13px' }}>
                      暂无其他主题可合并
                    </div>
                  ) : (
                    candidateTopics.map((t) => (
                      <div
                        key={t.id}
                        className="merge-topic-btn"
                        onClick={() => {
                          setSelectedTargetTopic(t)
                          setMergeStep(2)
                        }}
                      >
                        <div className="merge-topic-title">{t.title}</div>
                        <div className="merge-topic-summary">{t.summary || '(暂无摘要)'}</div>
                      </div>
                    ))
                  )}
                </>
              ) : (
                <>
                  <div style={{ fontSize: '13px', color: 'var(--ink-soft)', marginBottom: '4px' }}>
                    请选择当前主题子卡片合并后的排序方式：
                  </div>

                  <div className="merge-opt-card" onClick={() => !merging && handleExecuteMerge('time')}>
                    <div className="merge-opt-icon">🕒</div>
                    <div>
                      <div className="merge-opt-title">按时间排序</div>
                      <div className="merge-opt-desc">卡片按生成时间交叉自然排列</div>
                    </div>
                  </div>

                  <div className="merge-opt-card" onClick={() => !merging && handleExecuteMerge('end')}>
                    <div className="merge-opt-icon">⬇️</div>
                    <div>
                      <div className="merge-opt-title">移至最后</div>
                      <div className="merge-opt-desc">当前主题的所有卡片追加到目标主题末尾</div>
                    </div>
                  </div>

                  <div className="merge-opt-card" onClick={() => !merging && handleExecuteMerge('start')}>
                    <div className="merge-opt-icon">⬆️</div>
                    <div>
                      <div className="merge-opt-title">移至最前</div>
                      <div className="merge-opt-desc">当前主题的所有卡片整体置于目标卡片最前面</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '6px' }}>
                    <button 
                      className="btn small ghost" 
                      onClick={() => setMergeStep(1)}
                      disabled={merging}
                      style={{ fontSize: '12px' }}
                    >
                      ← 返回重选主题
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
