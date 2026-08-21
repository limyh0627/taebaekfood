import { describe, it, expect } from 'vitest';

/**
 * 손익분석 기간 — **기본 화면이 비면 안 된다.**
 *
 * 실제로 이랬다: 기초일 2026-07-31, 데이터는 2026-08에만 있는데
 *   · 기본 기간이 1월 ~ `getMonth()` = 1~7월  (getMonth()는 0부터라 이번 달이 빠진다)
 *   · 기초 이전은 잘라내므로(7월 이하) → 남는 달 0개 → **모든 줄이 0**
 *   · 연간·3분기 버튼은 '아직 안 끝난 기간'이라 잠겨 있어 8월을 고를 길이 없었다
 * 그래서 이자비용이 계정도 멀쩡하고 전표도 멀쩡한데 화면에서 안 보였다.
 */
const YEAR = 2026;
const NOW = new Date('2026-08-21T12:00:00');
const currentMonth = NOW.getMonth() + 1;                    // 8
const todayYm = `${YEAR}-${String(currentMonth).padStart(2, '0')}`;
const openingYm = '2026-07';

const cut = (ms: string[]) => ms.filter(ym => ym > openingYm);
const ym = (m: number) => `${YEAR}-${String(m).padStart(2, '0')}`;
const custom = (start: number, end: number) => {
  const e = Math.min(end, currentMonth);
  const out: string[] = [];
  for (let m = start; m <= e; m++) out.push(ym(m));
  return out;
};

describe('기본 기간', () => {
  it('이번 달이 들어간다 — getMonth()는 0부터라 전달이 나왔다(고친 이유)', () => {
    expect(NOW.getMonth()).toBe(7);            // 옛 기본값 = 7월
    expect(NOW.getMonth() + 1).toBe(8);        // 지금 기본값 = 8월
  });

  it('옛 기본값(1~7월)은 기초에 통째로 잘려 화면이 빈다', () => {
    expect(cut(custom(1, Math.max(1, NOW.getMonth())))).toEqual([]);
  });

  it('지금 기본값(1~8월)은 8월이 남는다 — 데이터가 있는 유일한 달', () => {
    expect(cut(custom(1, NOW.getMonth() + 1))).toEqual(['2026-08']);
  });
});

describe('기간 버튼 잠금 — 시작한 기간은 연다', () => {
  const quarterOld = (q: number) => currentMonth > q * 3;
  const quarterNew = (q: number) => currentMonth >= (q - 1) * 3 + 1;

  it('옛 규칙은 3분기(7~9월)를 잠갔다 — 정작 장부에 있는 달이 거기다', () => {
    expect(quarterOld(3)).toBe(false);
  });

  it('지금은 시작한 분기를 연다', () => {
    expect(quarterNew(3)).toBe(true);
    expect(quarterNew(4)).toBe(false);          // 10월은 아직 시작 안 함
  });

  it('진행 중인 분기는 지난 달까지만 보인다 — 미래 달은 안 센다', () => {
    const q3 = [7, 8, 9].map(ym).filter(x => x <= todayYm);
    expect(q3).toEqual(['2026-07', '2026-08']);
    expect(cut(q3)).toEqual(['2026-08']);
  });

  it('연간도 연다 — 달 목록이 이번 달까지로 잘리므로 진행 중이어도 뜻이 있다', () => {
    const all = Array.from({ length: 12 }, (_, i) => ym(i + 1)).filter(x => x <= todayYm);
    expect(cut(all)).toEqual(['2026-08']);
  });
});
