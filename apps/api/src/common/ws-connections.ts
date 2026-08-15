const connections = new Map<string, Set<any>>()

export { connections }

export function emitToOrg(orgId: string, event: string, data: unknown): void {
  const sockets = connections.get(orgId)
  if (!sockets) return
  const payload = JSON.stringify({ event, data })
  sockets.forEach(ws => {
    if (ws.readyState === 1) {
      try { ws.send(payload) } catch { /* o cliente pode ter desconectado entre a checagem e o envio */ }
    }
  })
}
