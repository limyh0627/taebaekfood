import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

/**
 * **화면을 연 브라우저가 업무 이력을 지우면 안 된다.**
 *
 * 2026-09-10 까지 [AdminApp](../features/admin/AdminApp.tsx) 에 그런 effect 가 둘 있었다 —
 * 완료·반려된 확인사항과 전표가 끊긴 선입고 이력을 **하루 뒤에 영구 삭제**했다.
 *
 * 목적은 "목록 누적 방지" 였다. **안 보이게 하는 것**이지 없애는 게 아니었는데 지워 버렸다.
 *   · 감사 근거가 사라진다 — "그 발주 언제 들어왔지" 를 되짚을 수가 없다.
 *   · **화면을 연 사람의 브라우저**가 지운다. 직원 앱도 결국 같은 화면을 그리므로
 *     관리자만의 일이 아니고, 여러 기기가 같은 삭제를 되풀이한다.
 *   · 삭제 실패는 아무도 안 본다.
 *
 * 이제 읽는 쪽에서 거른다(`보이는확인사항`·`보이는입고이력`). 데이터는 남고 화면은 깨끗하다.
 *
 * ---
 * **지우는 것 자체를 막는 시험이 아니다.** 사람이 단추를 눌러 지우는 건 그대로 둔다.
 * 막는 건 **때가 되면 저절로 지우는 것** — `useEffect` 안에서 시각을 견줘 지우는 자리다.
 */

const 파일들 = globSync('{components,src}/**/*.{ts,tsx}')
  .map(f => f.replace(/\\/g, '/'))
  .filter(f => !f.includes('.test.'));

/** 주석을 걷어낸다 — "예전엔 deleteItem 을 불렀다" 같은 설명이 코드인 척하면 안 된다. */
const 코드만 = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/.*/g, ' ');

/**
 * **봐주는 것 — 왜 봐주는지 여기 적는다.**
 *
 * 업무 이력이 아니라 **읽고 나면 버리는 통지**만 해당한다. 통지는 되짚을 일이 없고,
 * 안 지우면 모든 기기가 그걸 계속 구독해 앱이 무거워진다.
 * 새로 추가하려면 "이건 이력이 아니라 통지다" 를 말할 수 있어야 한다.
 */
const 봐주는것: { 자국: string; 왜: string }[] = [
  { 자국: "deleteItem('notifications'", 왜: '알림은 업무 이력이 아니라 읽고 버리는 통지다. 2주 지난 것을 지운다.' },
];

describe('때가 되면 저절로 지우는 코드가 없다', () => {
  it('effect 안에서 시각을 견줘 지우지 않는다', () => {
    const 걸림: string[] = [];
    for (const f of 파일들) {
      const src = 코드만(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(/useEffect\s*\(/g)) {
        //  effect 본문을 중괄호 짝으로 잘라 낸다.
        const 시작 = src.indexOf('{', m.index);
        if (시작 < 0) continue;
        let 깊이 = 0, 끝 = -1;
        for (let i = 시작; i < src.length; i++) {
          if (src[i] === '{') 깊이++;
          else if (src[i] === '}' && --깊이 === 0) { 끝 = i; break; }
        }
        if (끝 < 0) continue;
        const 본문 = src.slice(시작, 끝 + 1);

        const 지운다 = /\b(deleteItem|deleteDoc)\s*\(/.test(본문);
        //  "하루 전" 같은 시각 계산 — Date.now() 에서 빼거나, 지난 시각과 견주는 자리
        const 시각견줌 = /Date\.now\(\)\s*-|new Date\(Date\.now\(\)\s*-/.test(본문);
        if (지운다 && 시각견줌 && !봐주는것.some(x => 본문.includes(x.자국))) {
          빠진곳(걸림, f, 본문);
        }
      }
    }
    expect(걸림, `때가 되면 저절로 지우는 자리:\n${걸림.join('\n')}\n\n`
      + `지우지 말고 **읽는 쪽에서 걸러라.** 목록이 길어지는 걸 막으려는 것이지 없애려는 게 아니다.\n`
      + `정말 지워야 하면 서버 예약 작업 한 곳에서 하고 대상·성공·실패를 기록한다.`)
      .toEqual([]);
  });
});

function 빠진곳(모음: string[], 파일: string, 본문: string) {
  모음.push(`  ${파일} — ${본문.slice(0, 100).replace(/\s+/g, ' ')}…`);
}
