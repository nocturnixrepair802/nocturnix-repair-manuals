import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

const basePath = process.env.VITE_BASE_PATH || '/'

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['pwa-icon-192.png', 'pwa-icon-512.png'],
      manifest: {
        name: 'Nocturnix Manuals',
        short_name: 'Nocturnix Manuals',
        description: 'Your personal offline repair manual library.',
        theme_color: '#081630',
        background_color: '#081630',
        display: 'standalone',
        start_url: basePath,
        scope: basePath,
        icons: [
          {
            src: `${basePath}pwa-icon-192.png`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: `${basePath}pwa-icon-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
})
