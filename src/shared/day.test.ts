import { describe, it, expect } from 'vitest';
import { addDays, addMonths, endOfMonth, today } from './day';

/**
 * 이 셈이 틀리면 조용히 하루씩 밀린다 — 견적서 유효기한, 배송일, 앵커 시작일이
 * 다 여기를 지난다. 한국(UTC+9)에서 `toISOString()`이 전날을 주던 함정을 잠가 둔다.
 */
describe('달력 날짜 셈', () => {
  it('연말을 넘는다 — toISOString 함정이 났던 자리', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('월말을 넘는다', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');   // 2026은 평년
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');   // 2028은 윤년
  });
  it('30일 뒤는 정확히 30일 뒤다', () => {
    expect(addDays('2026-09-01', 30)).toBe('2026-10-01');
  });
  it('음수면 뺀다', () => {
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('0이면 그대로', () => {
    expect(addDays('2026-09-01', 0)).toBe('2026-09-01');
  });
  it('형식이 아니면 그대로 돌려준다 — 빈 값에 날짜를 지어내지 않는다', () => {
    expect(addDays('', 1)).toBe('');
    expect(addDays('그날', 1)).toBe('그날');
  });

  it('달 더하기 — 연말을 넘는다', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-08', 6)).toBe('2027-02');
  });

  it('말일 — 윤년도 맞는다', () => {
    expect(endOfMonth('2026-02')).toBe('2026-02-28');
    expect(endOfMonth('2028-02')).toBe('2028-02-29');
    expect(endOfMonth('2026-04')).toBe('2026-04-30');
    expect(endOfMonth('2026-12')).toBe('2026-12-31');
  });

  it('**한국 아침 9시 전에 어제가 나오면 안 된다** — 49군데가 그렇게 쓰고 있었다', () => {
    //  UTC+9 에서 아침 8시는 UTC 로 전날 23시다. toISOString().slice(0,10) 이 어제를 준다.
    const 아침 = new Date('2026-09-02T08:00:00+09:00');
    expect(아침.toISOString().slice(0, 10)).toBe('2026-09-01');        // 옛 방식 — 어제
    const p = (n: number) => String(n).padStart(2, '0');
    const 그자리 = `${아침.getFullYear()}-${p(아침.getMonth() + 1)}-${p(아침.getDate())}`;
    //  이 테스트가 도는 기계가 한국 시간대일 때만 뜻이 있다 — 아니면 건너뛴다
    if (-아침.getTimezoneOffset() === 540) expect(그자리).toBe('2026-09-02');
  });

  it('오늘은 그 자리 시간 기준 — UTC로 찍으면 한국 아침에 어제가 나온다', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const d = new Date();
    expect(today()).toBe(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  });
});
