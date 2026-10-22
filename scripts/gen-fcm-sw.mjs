// 명시적인 수동 생성만 public 원본을 쓴다. 앱 빌드는 Vite 플러그인이 산출물에 직접 넣는다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFirebaseBuildEnvironment, renderFirebaseMessagingWorker } from './firebase-build-env.ts';

async function main() {
  const projectDir = fileURLToPath(new URL('../', import.meta.url));
  const options = { mode: 'production', config: 'vite.admin.config.ts', out: 'public/firebase-messaging-sw.js' };
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index];
    if (!['--mode', '--config', '--out'].includes(name) || !process.argv[index + 1]) throw new Error('사용 가능한 생성 인자: --mode, --config, --out');
    options[name.slice(2)] = process.argv[index + 1];
  }
  // dotenv를 따로 해석하면 실제 앱과 다른 값이 들어가므로 Vite 정본을 그대로 쓴다.
  const { resolveConfig } = await import('vite');
  const config = await resolveConfig({ configFile: resolve(projectDir, options.config), mode: options.mode }, 'build');
  const firebase = validateFirebaseBuildEnvironment(config.env, config.mode);
  const source = renderFirebaseMessagingWorker(firebase, readFileSync(resolve(projectDir, 'scripts/firebase-messaging-sw.template.js'), 'utf8'));
  const output = resolve(projectDir, options.out);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, source, 'utf8');
  console.log('FCM 서비스워커 생성 완료 (mode: ' + config.mode + '): ' + output);

}
void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'FCM 서비스워커 생성 환경을 확인해 주세요.');
  process.exitCode = 1;
});
