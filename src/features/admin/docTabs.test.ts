import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * **화면이 있는데 들어갈 문이 없으면 안 된다.**
 *
 * 2026-09-01 에 생산판매기록부를 문서함으로 옮기면서(b14e808) 직원뷰 탭 단추를 지웠는데,
 * **직원뷰 화면(`docTab === '생산판매기록부' && !isAdmin`)은 그대로 남았다.**
 * 문서함은 관리자 전용이라 직원은 그 서류에 닿을 길이 아예 없어졌다.
 * 켤 때 기본값이라 잠깐 보이다가 다른 탭을 한 번 누르면 영영 못 돌아왔고,
 * 관리자뷰 문서함을 다녀와야 `docTab`이 바뀌어 다시 보였다.
 *
 * AdminApp 은 한 덩어리라 띄워서 볼 수가 없다. 그래서 **글자로 짚는다** —
 * 직원뷰가 그리는 탭마다 직원뷰 탭줄에 단추가 있는지만 본다.
 * 무르지만, 실제로 조용히 깨진 게 이 짝이다.
 */
const SRC = readFileSync(resolve(__dirname, 'AdminApp.tsx'), 'utf8');

/** 직원뷰 탭줄 — `{!isAdmin && (<>` 부터 그 조각이 닫히는 `</>)}` 까지 */
const staffStrip = (() => {
  const at = SRC.indexOf('{!isAdmin && (<>');
  expect(at, '직원뷰 탭줄을 못 찾았다 — 표시가 바뀌었으면 이 테스트도 고쳐야 한다').toBeGreaterThan(0);
  const end = SRC.indexOf('</>)}', at);
  return SRC.slice(at, end);
})();

const buttons = new Set([...staffStrip.matchAll(/setDocTab\('([^']+)'\)/g)].map(m => m[1]));
const staffOnlyScreens = [...SRC.matchAll(/docTab === '([^']+)' && !isAdmin/g)].map(m => m[1]);

describe('직원뷰 서류 탭', () => {
  it('탭줄을 실제로 읽어 냈다', () => {
    expect(buttons.size).toBeGreaterThan(3);
    expect(staffOnlyScreens.length).toBeGreaterThan(0);
  });

  it('**직원뷰가 그리는 서류는 전부 직원뷰 탭줄에서 열린다**', () => {
    const 못여는것 = staffOnlyScreens.filter(t => !buttons.has(t));
    expect(못여는것, `직원뷰에 화면은 있는데 단추가 없다: ${못여는것.join(', ')}`).toEqual([]);
  });

  it('생산판매기록부는 직원뷰에서 열린다 — 문서함은 관리자 전용이다', () => {
    expect(buttons.has('생산판매기록부')).toBe(true);
    expect(SRC).toContain("'file-cabinet'");
  });
});
