'use client'
import toast from 'react-hot-toast'

interface ConfirmOptions {
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export function confirmToast(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  const { confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false } = options

  return new Promise((resolve) => {
    toast(
      (t) => (
        <div className="flex flex-col gap-3 min-w-[220px]">
          <p className="text-sm text-white">{message}</p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                toast.dismiss(t.id)
                resolve(false)
              }}
              className="flex-1 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-accent transition"
            >
              {cancelLabel}
            </button>
            <button
              onClick={() => {
                toast.dismiss(t.id)
                resolve(true)
              }}
              className="flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition"
              style={
                danger
                  ? { background: '#EF4444' }
                  : { background: 'linear-gradient(135deg, #00AEEF, #0A84FF)' }
              }
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      ),
      { duration: Infinity }
    )
  })
}
