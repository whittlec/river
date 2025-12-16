import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.svg'],
      manifest: {
        name: 'River Levels',
        short_name: 'River',
        start_url: './',
        display: 'standalone',
        theme_color: '#242424',
        background_color: '#ffffff',
        icons: [
          { src: 'icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: 'icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
          { src: 'icons/maskable-icon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable any' }
        ]
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/check-for-flooding\.service\.gov\.uk\/station-csv\/.*$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'station-csv',
              expiration: { maxEntries: 50, maxAgeSeconds: 24 * 60 * 60 },
              networkTimeoutSeconds: 10,
            }
          },
        ]
      }
    })
  ],
})
