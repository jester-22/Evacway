import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App.jsx'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    if (import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.error('Service worker registration failed:', error)
      })
      return
    }

    const registrations = await navigator.serviceWorker.getRegistrations()
    const evacWayRegistrations = registrations.filter((registration) =>
      [registration.active, registration.waiting, registration.installing].some(
        (worker) => worker && new URL(worker.scriptURL).pathname === '/sw.js'
      )
    )
    await Promise.all(evacWayRegistrations.map((registration) => registration.unregister()))

    const cacheNames = await caches.keys()
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith('evacway-shell-'))
        .map((name) => caches.delete(name))
    )
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
