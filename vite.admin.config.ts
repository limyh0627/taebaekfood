import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'apps/admin'),
  publicDir: resolve(__dirname, 'public'),
  envDir: resolve(__dirname, '.'),
  base: '/',
  plugins: [
    react(),
    VitePWA({
      //  **새 버전을 알아서 받는다**(2026-09-03 사장님).
      //  'prompt' 였을 때는 배포해도 폰이 옛것을 붙들고 있어서, 앱을 완전히 닫았다
      //  다시 열어야 바뀌었다. 자주 배포하는 동안엔 그게 더 번거롭다.
      //  대신 쓰던 중에 새 버전이 오면 화면이 한 번 새로고침될 수 있다.
      registerType: 'autoUpdate',
      manifest: false,
      workbox: {
        //  알림 누름 처리를 얹는다 — 안드로이드는 알림을 서비스워커가 띄우므로
        //  누른 뒤 앱을 여는 것도 서비스워커 몫이다(public/notif-sw.js).
        importScripts: ['notif-sw.js'],
        maximumFileSizeToCacheInBytes: 5000000,
        clientsClaim: true,
        //  기다리지 않고 바로 새 일꾼으로 넘어간다 — autoUpdate 와 짝이다
        skipWaiting: true,
      },
    }),
  ],
  build: {
    outDir: resolve(__dirname, 'dist/admin'),
    emptyOutDir: true,
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
  server: { port: 3001, open: true },
});
