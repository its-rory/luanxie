import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { compressImage, startRecording, type RecorderHandle } from '../components/Recorder'

export default function CapturePage({ onDone, showToast }: {
  onDone: () => void
  showToast: (m: string) => void
}) {
  const [mode, setMode] = useState<'idle' | 'text'>('idle')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const recRef = useRef<RecorderHandle | null>(null)
  const timerRef = useRef<number>(0)
  const imageInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current)
      }
      if (recRef.current) {
        recRef.current.cancel()
        recRef.current = null
      }
    }
  }, [])

  const submitText = async () => {
    if (!text.trim()) return
    setBusy(true)
    try {
      await api.captureText(text)
      setText('')
      setMode('idle')
      onDone()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const toggleRecord = async () => {
    if (recording) {
      window.clearInterval(timerRef.current)
      setRecording(false)
      const handle = recRef.current
      recRef.current = null
      if (!handle) return
      setBusy(true)
      try {
        const { blob, ext } = await handle.stop()
        if (blob.size < 1000) { showToast('录音太短,未提交'); return }
        await api.captureFile('audio', blob, `rec.${ext}`)
        onDone()
      } catch (e) {
        showToast((e as Error).message)
      } finally {
        setBusy(false)
      }
    } else {
      try {
        recRef.current = await startRecording()
        setRecording(true)
        setElapsed(0)
        timerRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000)
      } catch (e) {
        showToast((e as Error).message)
      }
    }
  }

  const onImagePicked = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const { blob, ext } = await compressImage(file)
      await api.captureFile('image', blob, `photo.${ext}`)
      onDone()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusy(false)
      if (imageInput.current) imageInput.current.value = ''
    }
  }

  return (
    <div className="fade-in">
      <div className="capture-hero">
        <div className="big">随手丢</div>
        <div className="hint">语音、文字、照片,想到什么丢什么</div>
      </div>

      {mode === 'text' ? (
        <div className="text-entry">
          <textarea autoFocus value={text} placeholder="乱写点什么……"
            onChange={(e) => setText(e.target.value)} />
          <div className="row">
            <button className="btn ghost" onClick={() => { setMode('idle'); setText('') }}>取消</button>
            <button className="btn primary" disabled={busy || !text.trim()} onClick={submitText}>丢进去</button>
          </div>
        </div>
      ) : (
        <div className="capture-grid">
          <button className={`capture-card ${recording ? 'rec-active' : ''}`} disabled={busy} onClick={toggleRecord}>
            <span className="ideo">言</span>
            <span>
              <div className="label">{recording ? `录音中 ${elapsed}s · 点击结束` : '说一段'}</div>
              <div className="desc">{recording ? '再点一下就收进去' : '本地 Whisper 转写,不改你的原话'}</div>
            </span>
          </button>
          <button className="capture-card" disabled={busy} onClick={() => setMode('text')}>
            <span className="ideo">字</span>
            <span>
              <div className="label">写几句</div>
              <div className="desc">碎念、链接、待办,不用整理</div>
            </span>
          </button>
          <button className="capture-card" disabled={busy} onClick={() => imageInput.current?.click()}>
            <span className="ideo">影</span>
            <span>
              <div className="label">拍一张</div>
              <div className="desc">书页、白板、屏幕,AI 提取内容</div>
            </span>
          </button>
          <input ref={imageInput} type="file" accept="image/*" capture="environment" hidden
            onChange={(e) => onImagePicked(e.target.files?.[0])} />
        </div>
      )}
    </div>
  )
}
