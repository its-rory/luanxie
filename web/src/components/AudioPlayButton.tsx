import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api'

export default function AudioPlayButton({
  capId,
  initialLabel,
  initialType
}: {
  capId: string
  initialLabel?: React.ReactNode
  initialType?: 'audio' | 'image' | 'text' | null
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [type, setType] = useState<'audio' | 'image' | 'text' | null>(initialType ?? null)
  const [noOriginal, setNoOriginal] = useState(initialType === 'text')
  const [showLightbox, setShowLightbox] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const getAudio = () => {
    if (!audioRef.current) {
      const audio = new Audio()
      audio.onplay = () => setPlaying(true)
      audio.onpause = () => setPlaying(false)
      audio.onended = () => setPlaying(false)
      audioRef.current = audio
    }
    return audioRef.current
  }

  const handlePlay = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (type === 'image' && audioUrl) {
      setShowLightbox(true)
      return
    }

    if (audioUrl && type === 'audio') {
      const audio = getAudio()
      if (playing) {
        audio.pause()
      } else {
        audio.play().catch(() => {})
      }
      return
    }

    setLoading(true)
    try {
      const cap = await api.capture(capId)
      if (cap && cap.media_path) {
        const url = `/${cap.media_path}`
        setType(cap.type)
        setAudioUrl(url)
        if (cap.type === 'audio') {
          const audio = getAudio()
          audio.src = url
          audio.play().catch(() => {})
        } else if (cap.type === 'image') {
          setShowLightbox(true)
        } else {
          setNoOriginal(true)
        }
      } else {
        setNoOriginal(true)
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        const audio = audioRef.current
        audio.pause()
        audio.onplay = null
        audio.onpause = null
        audio.onended = null
        audio.removeAttribute('src')
        audio.load()
        audioRef.current = null
      }
    }
  }, [])

  if (error) return <span style={{ color: 'var(--ink-faint)', fontSize: '11px', marginLeft: '6px' }}>(无原件)</span>
  if (noOriginal) return null
  if (loading) return <span style={{ color: 'var(--ink-soft)', fontSize: '11px', marginLeft: '6px' }}>加载中…</span>

  return (
    <>
      <button
        onClick={handlePlay}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          background: 'none',
          border: 'none',
          padding: '0 4px',
          color: playing ? 'var(--primary)' : 'var(--primary-soft)',
          cursor: 'pointer',
          fontSize: '11px',
          fontFamily: 'inherit',
          textDecoration: 'underline'
        }}
      >
        {playing ? '⏸ 暂停' : type === 'image' ? '🖼️ 看原图' : type === 'text' ? '📝 看原文' : initialLabel || '🔊 听原音'}
      </button>

      {showLightbox && audioUrl && (
        <div
          onClick={() => setShowLightbox(false)}
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
            src={audioUrl}
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
    </>
  )
}
