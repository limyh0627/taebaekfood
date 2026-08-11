import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      workbox: {
        maximumFileSizeToCacheInBytes: 5000000,
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
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
          'vendor-pdf': ['jspdf', 'html2canvas'],
          'vendor-excel': ['exceljs'],
          'vendor-ai': ['@google/generative-ai'],
          'vendor-qr': ['jsqr', 'qrcode'],
        },
      },
    },
  },
});

