import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * **테스트 설정 — 개발용 vite 설정과 일부러 갈라 둔다.**
 *
 * 앱 vite 설정(`vite.admin.config.ts`)에는 PWA 플러그인과 번들 쪼개기가 들어 있는데 테스트에는 필요 없고,
 * 서비스워커를 만들려다 느려지기만 한다. 여기 두면 테스트가 **왜 이렇게 도는지**가
 * 한 파일에 다 있다.
 *
 * `environment`는 기본이 node다. 화면을 띄우는 테스트만 파일 맨 위에
 *   /** @vitest-environment jsdom *\/
 * 를 달아 jsdom으로 돈다. 순수 계산 테스트 700여 개까지 브라우저를 흉내낼 이유가 없다.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    //  한 번 켠 화면이 다음 테스트로 새면 원인을 못 찾는다
    restoreMocks: true,
  },
});
