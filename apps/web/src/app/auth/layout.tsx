export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4" style={{ background: 'hsl(var(--surface-0))' }}>
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <img src="/logo.png" alt="ZapShark" className="w-14 h-14 object-contain" style={{ filter: 'drop-shadow(0 0 20px #00AEEF50)' }} />
          <div>
            <span className="text-2xl font-bold text-white tracking-tight">ZapShark</span>
            <p className="text-[10px] font-medium tracking-widest" style={{ color: '#00AEEF' }}>MULTI-ATENDIMENTO</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
