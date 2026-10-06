import { spawn } from 'node:child_process';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8082'
  || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('Local demo emulators required');
await import('../../scripts/seed-local-emulator.mts');
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.admin.config.ts', '--mode', 'localtest', '--port', '8099', '--strictPort'], { stdio: 'inherit', windowsHide: true });
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await fetch('http://localhost:8099').then(r => r.ok).catch(() => false)) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  if (!ready) throw new Error('Local test app did not start');
  await import('./shareTarget.browser.mjs');
  await import('./shareTarget.app.browser.mjs');
  await import('./bundleReview.browser.mjs');
} finally { vite.kill(); }
