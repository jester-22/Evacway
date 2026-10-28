import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import 'leaflet/dist/leaflet.css'
import './index.css'
import './components_css/design-system.css'
import './components_css/evac-centers.css'
import App from './App.jsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    // Unregister any stale EvacWay service workers first (dev and prod)
    const registrations = await navigator.serviceWorker.getRegistrations()
    const evacWayRegistrations = registrations.filter((registration) =>
      [registration.active, registration.waiting, registration.installing].some(
        (worker) => worker && new URL(worker.scriptURL).pathname === '/sw.js'
      )
    )
    await Promise.all(evacWayRegistrations.map((registration) => registration.unregister()))

    // Clear dev caches only
    if (!import.meta.env.PROD) {
      const cacheNames = await caches.keys()
      await Promise.all(
        cacheNames
          .filter((name) => name.startsWith('evacway-shell-'))
          .map((name) => caches.delete(name))
      )
    }

    // Register the service worker in prod only; skip in dev to avoid Chrome
    // serving stale cached shell/assets (blank page / not updating on reload).
    if (import.meta.env.PROD) {
      await navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.error('Service worker registration failed:', error)
      })
    }
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
