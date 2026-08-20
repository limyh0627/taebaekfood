import { describe, it, expect } from 'vitest';
import { stampFor, localToday } from './voucherStamp';

/** 로컬 시각으로 읽었을 때의 시:분:초 — 타임라인(timeOf)과 같은 방식 */
const hms = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

describe('전표 시각 — 그날 어디에 서나', () => {
  const now = new Date('2026-08-20T14:30:00');   // 오늘 오후 2시 반에 끊는다

  it('지난 날짜로 끊으면 그날 맨 뒤 — 나중에 알게 된 것이니까', () => {
    expect(hms(stampFor('2026-08-06', now))).toBe('23:59:59');
  });

  it('앞선 날짜로 미리 끊으면 그날 맨 앞 — 그날이 오면 처음부터 서 있어야', () => {
    expect(hms(stampFor('2026-09-01', now))).toBe('00:00:00');
  });

  it('오늘이면 지금 시각 그대로', () => {
    expect(stampFor('2026-08-20', now)).toBe(now.toISOString());
  });

  it('날짜가 그날에 그대로 남는다 — 시각만 잡지 날짜를 밀지 않는다', () => {
    expect(new Date(stampFor('2026-08-06', now)).getDate()).toBe(6);
    expect(new Date(stampFor('2026-09-01', now)).getDate()).toBe(1);
  });

  it('소급 전표가 그날 기존 기록보다 뒤에 선다', () => {
    const 기존 = '2026-08-06T07:47:34';              // 그날 있던 입고
    const 소급 = stampFor('2026-08-06', now);
    expect(hms(소급) > hms(new Date(기존).toISOString())).toBe(true);
  });

  it('날짜가 이상하면 지금 시각으로 둔다', () => {
    expect(stampFor('', now)).toBe(now.toISOString());
    expect(stampFor('2026-8-6', now)).toBe(now.toISOString());
  });

  it('localToday는 로컬 기준이다 — UTC로 밀리면 날짜가 하루 어긋난다', () => {
    expect(localToday(new Date('2026-08-20T23:30:00'))).toBe('2026-08-20');
    expect(localToday(new Date('2026-01-01T00:10:00'))).toBe('2026-01-01');
  });
});
