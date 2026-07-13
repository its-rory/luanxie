import type { Capture, Health, Topic, TopicVersion } from './types'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `请求失败 (${res.status})`)
  }
  return res.json()
}

export const api = {
  captureText: (text: string) => {
    const form = new FormData()
    form.set('type', 'text')
    form.set('text', text)
    return req<Capture>('/api/captures', { method: 'POST', body: form })
  },
  captureFile: (type: 'audio' | 'image', file: File | Blob, filename: string) => {
    const form = new FormData()
    form.set('type', type)
    form.set('file', file, filename)
    return req<Capture>('/api/captures', { method: 'POST', body: form })
  },
  captures: (status?: string) =>
    req<Capture[]>(`/api/captures${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  capture: (id: string) => req<Capture>(`/api/captures/${id}`),
  retry: (id: string) => req<Capture>(`/api/captures/${id}/retry`, { method: 'POST' }),
  deleteCapture: (id: string) => req<{ ok: boolean }>(`/api/captures/${id}`, { method: 'DELETE' }),

  review: () => req<Capture[]>('/api/review'),
  decide: (id: string, body: { action: string; topic_id?: string; new_topic_title?: string }) =>
    req<Capture>(`/api/review/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  topics: (q?: string) => req<Topic[]>(`/api/topics${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  topic: (id: string) => req<Topic>(`/api/topics/${id}`),
  deleteTopic: (id: string) => req<{ ok: boolean }>(`/api/topics/${id}`, { method: 'DELETE' }),
  versions: (id: string) => req<TopicVersion[]>(`/api/topics/${id}/versions`),
  rollback: (id: string, version: number) =>
    req<Topic>(`/api/topics/${id}/rollback/${version}`, { method: 'POST' }),

  exportNow: () => req<{ exported: unknown[]; count: number }>('/api/export', { method: 'POST' }),
  health: () => req<Health>('/api/health'),
}

export function subscribeEvents(onEvent: (data: Record<string, unknown>) => void): () => void {
  let es: EventSource | null = null
  let closed = false
  let timer: any = null

  function connect() {
    if (closed) return
    es = new EventSource('/api/events')
    es.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data))
      } catch {
        /* keepalive */
      }
    }
    es.onerror = () => {
      if (es) {
        es.close()
      }
      if (!closed) {
        timer = window.setTimeout(connect, 10000)
      }
    }
  }

  connect()

  return () => {
    closed = true
    if (timer) window.clearTimeout(timer)
    if (es) es.close()
  }
}
