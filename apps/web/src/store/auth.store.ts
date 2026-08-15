import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '@/lib/api'

interface User {
  id: string; name: string; email: string; role: string; avatar?: string
  isSuperAdmin?: boolean
  organizationId: string; organization: { id: string; name: string; plan: string }
}

interface AuthState {
  user: User | null; token: string | null; isLoading: boolean
  hydrated: boolean
  setHydrated: () => void
  login: (email: string, password: string) => Promise<void>
  register: (data: { name: string; email: string; password: string; orgName: string }) => Promise<void>
  logout: () => void
  fetchMe: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null, token: null, isLoading: false,
      hydrated: false,
      setHydrated: () => set({ hydrated: true }),
      login: async (email, password) => {
        set({ isLoading: true })
        try {
          const { data } = await api.post('/auth/login', { email, password })
          localStorage.setItem('crm_token', data.token)
          set({ user: data.user, token: data.token, isLoading: false })
        } catch (err) { set({ isLoading: false }); throw err }
      },
      register: async (payload) => {
        set({ isLoading: true })
        try {
          await api.post('/auth/register', payload)
          set({ isLoading: false })
        } catch (err) { set({ isLoading: false }); throw err }
      },
      logout: () => {
        localStorage.removeItem('crm_token')
        set({ user: null, token: null })
        window.location.href = '/auth/login'
      },
      fetchMe: async () => {
        try {
          const { data } = await api.get('/auth/me')
          set({ user: data })
        } catch { get().logout() }
      },
    }),
    {
      name: 'zapshark_auth',
      partialize: (s) => ({ token: s.token, user: s.user }),
      // Marca o store como hidratado após reidratar do localStorage. O layout
      // espera essa flag antes de decidir redirecionar para o login (senão o
      // primeiro render — com token ainda null — derruba o usuário no F5).
      onRehydrateStorage: () => (state) => {
        // Reconcilia o token usado pelo interceptor do axios (crm_token).
        if (typeof window !== 'undefined') {
          if (state?.token) localStorage.setItem('crm_token', state.token)
          else localStorage.removeItem('crm_token')
        }
        state?.setHydrated()
      },
    }
  )
)
