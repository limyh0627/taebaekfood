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
      registerType: 'prompt',
      manifest: false,
      workbox: {
        maximumFileSizeToCacheInBytes: 5000000,
        clientsClaim: true,
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
