export interface Capture {
  id: string
  type: 'text' | 'audio' | 'image'
  status: string
  raw_text: string | null
  media_path: string | null
  transcript: string | null
  clean_text: string | null
  topic_id: string | null
  topic_title?: string | null
  confidence: 'high' | 'medium' | 'low' | null
  suggestion: Suggestion | string | null
  error: string | null
  created_at: string
  logs?: LogEntry[]
}

export interface Suggestion {
  clean_text: string
  action: 'existing' | 'new'
  topic_id: string | null
  new_topic_title: string | null
  confidence: 'high' | 'medium' | 'low'
  reason: string
  topic_title?: string | null
}

export interface Topic {
  id: string
  title: string
  summary: string
  body_md?: string
  tags: string[]
  version: number
  exported_version: number
  updated_at: string
  created_at: string
}

export interface TopicVersion {
  id: number
  topic_id: string
  version: number
  body_md: string
  capture_id: string | null
  created_at: string
}

export interface LogEntry {
  stage: string
  status: string
  detail: string | null
  created_at: string
}

export interface Health {
  queue_depth: number
  whisper_installed: boolean
  api_key_set: boolean
  auto_merge_confidence: string
}
