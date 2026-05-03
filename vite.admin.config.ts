import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'apps/admin'),
  publicDir: resolve(__dirname, 'public'),
  envDir: resolve(__dirname, '.'),
  base: '/',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist/admin'),
    emptyOutDir: true,
  },
  server: { port: 3001, open: true },
});
