import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // selfDestroying: the generated SW will unregister itself on first run.
      // This clears any stale SW cache from previous builds — including the
      // separate WKWebView cache used by "Add to Home Screen" apps on iOS.
      // Safe to remove once the app is stable and ready for offline use.
      selfDestroying: true,
      includeAssets: ['icons/*.svg'],
      manifest: {
        name: 'Contexta',
        short_name: 'Contexta',
        description: 'EPUB reader with AI translation',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
          }
        ]
      }
    })
  ],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          epubjs: ['epubjs'],
          react: ['react', 'react-dom'],
          idb: ['idb'],
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      // In dev mode, /api/* → agent server (localhost:8001).
      // The agent server handles orchestration and calls the remote backend.
      // In production the browser calls the agent server directly (set URL in Settings).
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  }
})
