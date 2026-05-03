import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        maximumFileSizeToCacheInBytes: 5000000,
        skipWaiting: true,
        clientsClaim: true
      },
manifest: {
  name: 'Flow-It ERP',
  short_name: '플로우잇',
  description: '스마트 업무 관리 플랫폼',
  start_url: '/',
  display: 'standalone',
  background_color: '#ffffff',
  theme_color: '#0891B2',
  icons: [
    {
      src: '/icon-192x192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any maskable'
    },
    {
      src: '/icon-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any maskable'
    }
  ]
}  
  }
)
  ],
  server: {
    port: 3000,
    open: true
  }
});

