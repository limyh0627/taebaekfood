import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

/**
 * **아무도 안 쓰는 화면 파일을 남기지 않는다.**
 *
 * 2026-09-07 에 훑어보니 네 개가 죽어 있었다 —
 * `ReloadPrompt`(PWA 를 autoUpdate 로 바꾸며 쓸 일이 없어짐),
 * `CalendarView`, 그리고 **빈 파일** `hooks/AdminApp.tsx`, 안 쓰는 재수출 하나.
 *
 * 죽은 화면을 남겨 두면 읽는 사람이 **살아 있는 줄 알고 고친다** —
 * 같은 날 `{false && ...}` 로 꺼둔 364줄에서 실제로 그랬다.
 *
 * ---
 * **다만 "안 쓰는 것"이 다 죽은 건 아니다.** 같은 훑기에서 나온 둘은
 * **만들어 놓고 안 붙인 것**이었다 —
 *   `blockNumberWheel`  숫자 칸 위에서 휠을 굴리면 값이 바뀌는 걸 막는다
 *   `unregisterPush`    로그아웃할 때 이 폰의 알림 표를 뺀다
 * 둘 다 지울 게 아니라 **붙여야** 했다. 지우기 전에 왜 안 쓰이는지 먼저 본다.
 */
const 앱파일 = globSync('{components,apps,src}/**/*.{ts,tsx}')
  .map(f => f.replace(/\\/g, '/'))
  .filter(f => !f.includes('.test.') && !f.endsWith('.d.ts'))
  //  vitest 설정이 부르는 자리 — 코드에서 import 하지 않는 게 정상이다
  .filter(f => !f.startsWith('src/test/'));

//  **파일은 한 번만 읽는다.** 파일마다 전부를 다시 읽으면 (파일 수)² 이라 시간이 넘친다.
const 내용 = new Map(앱파일.map(f => [f, readFileSync(f, 'utf8')]));

/** 어딘가의 import 경로에 나온 이름들 */
const 불린이름 = (() => {
  const s = new Set<string>();
  for (const src of 내용.values()) {
    for (const m of src.matchAll(/['"`]([^'"`]*\/[\w.-]+)['"`]/g)) {
      s.add(m[1].split('/').pop()!.replace(/\.(tsx?|jsx?)$/, ''));
    }
  }
  return s;
})();

/** 이 파일을 누군가 import 하나 */
const 쓰이나 = (file: string): boolean => {
  //  진입점과 설정은 아무도 import 하지 않는 게 정상이다
  if (/^(apps\/|src\/(firebase|index|vite-env)|src\/config\/)/.test(file)) return true;
  if (file.endsWith('main.tsx') || file.endsWith('index.ts')) return true;
  return 불린이름.has(file.split('/').pop()!.replace(/\.(tsx?)$/, ''));
};

describe('아무도 안 쓰는 화면 파일이 없다', () => {
  it('모든 파일이 어딘가에서 import 된다', () => {
    const 죽음 = 앱파일.filter(f => {
      if (!(내용.get(f) ?? '').trim()) return true;   // 빈 파일
      return !쓰이나(f);
    });
    expect(죽음, `아무도 안 쓰는 파일:\n${죽음.map(f => `  ${f}`).join('\n')}\n\n` +
      `지우기 전에 **왜 안 쓰이는지** 먼저 봐라 — 만들어 놓고 안 붙인 것일 수 있다.`)
      .toEqual([]);
  });
});
