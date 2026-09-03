import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      //  **새 버전을 알아서 받는다**(2026-09-03 사장님).
      //  'prompt' 였을 때는 배포해도 폰이 옛것을 붙들고 있어서, 앱을 완전히 닫았다
      //  다시 열어야 바뀌었다. 자주 배포하는 동안엔 그게 더 번거롭다.
      //  대신 쓰던 중에 새 버전이 오면 화면이 한 번 새로고침될 수 있다.
      registerType: 'autoUpdate',
      workbox: {
        maximumFileSizeToCacheInBytes: 5000000,
        clientsClaim: true,
        //  기다리지 않고 바로 새 일꾼으로 — autoUpdate 와 짝이다
        skipWaiting: true
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

