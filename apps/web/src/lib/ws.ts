type Handler = (data: unknown) => void

class WsClient {
  private ws: WebSocket | null = null
  private handlers = new Map<string, Set<Handler>>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private url = ''
  private active = false

  connect(url: string) {
    this.active = true
    this.url = url
    this._open()
  }

  private _open() {
    if (typeof window === 'undefined' || !this.active) return
    try {
      this.ws = new WebSocket(this.url)
      this.ws.onmessage = (e) => {
        try {
          const { event, data } = JSON.parse(e.data as string)
          this.handlers.get(event)?.forEach(h => h(data))
        } catch {}
      }
      this.ws.onclose = () => {
        if (this.active) this.reconnectTimer = setTimeout(() => this._open(), 4000)
      }
      this.ws.onerror = () => this.ws?.close()
    } catch {}
  }

  on(event: string, handler: Handler): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(handler)
    return () => this.handlers.get(event)?.delete(handler)
  }

  disconnect() {
    this.active = false
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
  }
}

export const wsClient = new WsClient()
