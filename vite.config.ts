import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon-v3.png', 'apple-touch-icon-v3.png', 'pwa-maskable-512x512-v3.png', 'shirt_baked.glb'],
      manifest: {
        name: 'T Shirt Creativos — Gift Shop',
        short_name: 'T Shirt Creativos',
        description: 'Ventas, taller, catálogo 3D e inventario de camisas · Creativos Gift Shop',
        lang: 'es-HN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: 'pwa-192x192-v3.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512-v3.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512x512-v3.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,glb}'],
        navigateFallback: '/index.html',
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/firestore'],
          supabase: ['@supabase/supabase-js'],
          motion: ['motion/react'],
          dexie: ['dexie']
        }
      }
    }
  }
});
