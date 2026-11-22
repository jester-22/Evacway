
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = dirname(fileURLToPath(import.meta.url))

function collectShellFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    const fullPath = join(directory, entry.name)
    return entry.isDirectory()
      ? collectShellFiles(fullPath, relativePath)
      : [relativePath.split(sep).join('/')]
  })
}

function offlinePrecachePlugin() {
  return {
    name: 'evacway-offline-precache',
    apply: 'build',
    writeBundle(options) {
      const outputDirectory = resolve(frontendRoot, options.dir || 'dist')
      const shellFiles = collectShellFiles(outputDirectory).filter((file) => (
        file === 'index.html'
        || file === 'manifest.webmanifest'
        || file === 'evacway-app.png'
        || file === 'evacway-logo-text.png'
        || file === 'lgu-logo.png'
        || file === 'sogod_boundary.geojson'
        || file.startsWith('assets/')
      ))
      const urls = shellFiles.map((file) => `/${file}`)
      const worker = readFileSync(join(frontendRoot, 'public', 'sw.js'), 'utf8')
        .replace('const PRECACHE_URLS = [];', `const PRECACHE_URLS = ${JSON.stringify(urls)};`)
      writeFileSync(join(outputDirectory, 'sw.js'), worker, 'utf8')
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), offlinePrecachePlugin()],

  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: [
      '.trycloudflare.com',
      '.ngrok-free.dev',
      'evacway.me',
      'www.evacway.me'
    ],
    proxy: {
      '/api': 'http://127.0.0.1:5000',
      '/static/uploads': 'http://127.0.0.1:5000',
      '/static/upload': 'http://127.0.0.1:5000',
    },
  },

  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: [
      '.trycloudflare.com',
      '.ngrok-free.dev',
    ],
    proxy: {
      '/api': 'http://127.0.0.1:5000',
      '/static/uploads': 'http://127.0.0.1:5000',
      '/static/upload': 'http://127.0.0.1:5000',
    },
  },
})
