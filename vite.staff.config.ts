import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        maximumFileSizeToCacheInBytes: 5000000,
        skipWaiting: true,
        clientsClaim: true,
      },
      manifest: {
        name: '태백현장',
        short_name: '태백현장',
        description: '태백식품 현장 업무 시스템',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#4F46E5',
        icons: [
          { src: '/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist/staff',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'apps/staff/index.html'),
    },
  },
  server: { port: 3002, open: true },
});
