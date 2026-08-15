'use client'
import { useRef, useState, useCallback } from 'react'

/**
 * Gravação de áudio por microfone via MediaRecorder. Devolve estado e controles.
 * O blob resultante é convertido em File (ogg/webm) para envio como nota de voz.
 */
export function useAudioRecorder() {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const resolveRef = useRef<((f: File | null) => void) | null>(null)

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setRecording(false)
    setSeconds(0)
  }, [])

  const start = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : ''
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        const type = mr.mimeType || 'audio/ogg'
        const blob = new Blob(chunksRef.current, { type })
        const ext = type.includes('webm') ? 'webm' : 'ogg'
        const file = new File([blob], `audio_${Date.now()}.${ext}`, { type })
        cleanup()
        resolveRef.current?.(file.size > 0 ? file : null)
        resolveRef.current = null
      }
      mediaRef.current = mr
      mr.start()
      setRecording(true)
      setSeconds(0)
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
      return true
    } catch {
      cleanup()
      return false
    }
  }, [cleanup])

  /** Para a gravação e resolve com o File gravado (ou null). */
  const stop = useCallback((): Promise<File | null> => {
    return new Promise((resolve) => {
      const mr = mediaRef.current
      if (!mr || mr.state === 'inactive') { resolve(null); return }
      resolveRef.current = resolve
      mr.stop()
    })
  }, [])

  /** Cancela e descarta o áudio. */
  const cancel = useCallback(() => {
    const mr = mediaRef.current
    resolveRef.current = null
    if (mr && mr.state !== 'inactive') {
      mr.onstop = () => cleanup()
      mr.stop()
    } else {
      cleanup()
    }
  }, [cleanup])

  return { recording, seconds, start, stop, cancel }
}
