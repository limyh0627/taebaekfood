import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        maximumFileSizeToCacheInBytes: 5000000 // 5MB로 증가
      },
manifest: {
  name: '태백푸드',
  short_name: '태백푸드',
  start_url: '/',
  display: 'standalone',
  background_color: '#ffffff',
  theme_color: '#000000',
  icons: [
    {
      src: '/icon-192x192.svg',
      sizes: '192x192',
      type: 'image/svg+xml'
    },
    {
      src: '/icon-512x512.svg',
      sizes: '512x512',
      type: 'image/svg+xml'
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

