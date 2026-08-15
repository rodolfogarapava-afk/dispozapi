import type { Metadata } from 'next'
import { ThemeProvider } from '@/components/layout/theme-provider'
import { QueryProvider } from '@/components/layout/query-provider'
import { Toaster } from 'react-hot-toast'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'DisparoX', template: '%s | DisparoX' },
  description: 'Disparos e atendimento WhatsApp com CRM completo',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
          <QueryProvider>
            {children}
            <Toaster position="top-right" toastOptions={{
              style: { background: 'hsl(220 28% 10%)', border: '1px solid hsl(214 25% 14%)', color: '#fff' },
              success: { iconTheme: { primary: '#00AEEF', secondary: '#fff' } },
            }} />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
