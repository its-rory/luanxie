/* MediaRecorder 封装:开始/结束录音,返回音频 Blob。需要 HTTPS secure context。 */

export interface RecorderHandle {
  stop: () => Promise<{ blob: Blob; ext: string }>
  cancel: () => void
}

export async function startRecording(): Promise<RecorderHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('当前环境无法录音:需要 HTTPS(Tailscale 地址)访问')
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  // Safari 产出 audio/mp4,Chrome 产出 audio/webm;后端 ffmpeg 都能解
  const mime = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : 'audio/webm'
  const rec = new MediaRecorder(stream, { mimeType: mime })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
  rec.start()

  const cleanup = () => stream.getTracks().forEach((t) => t.stop())

  return {
    stop: () =>
      new Promise((resolve) => {
        rec.onstop = () => {
          cleanup()
          resolve({ blob: new Blob(chunks, { type: mime }), ext: mime === 'audio/mp4' ? 'm4a' : 'webm' })
        }
        rec.stop()
      }),
    cancel: () => { rec.onstop = null; try { rec.stop() } catch { /* noop */ } cleanup() },
  }
}

/* 图片压缩:长边压到 maxEdge,省 token 且识别足够 */
export async function compressImage(file: File, maxEdge = 1568): Promise<{ blob: Blob; ext: string }> {
  const bitmap = await createImageBitmap(file).catch(() => null)
  const origExt = file.name.split('.').pop() || 'jpg'
  if (!bitmap) return { blob: file, ext: origExt }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.type === 'image/jpeg') return { blob: file, ext: 'jpg' }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  
  const ctx = canvas.getContext('2d')
  if (!ctx) return { blob: file, ext: origExt }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

  if (!canvas.toBlob) return { blob: file, ext: origExt }
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.85))
  if (!blob) return { blob: file, ext: origExt }
  return { blob, ext: 'jpg' }
}
