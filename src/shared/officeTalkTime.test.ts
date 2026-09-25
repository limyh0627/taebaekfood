import { describe, expect, it } from 'vitest';
import { officeTalkSortTime, officeTalkStamp } from './officeTalkTime';

describe('오피스톡 메시지 시각', () => {
  it('UTC 날짜가 넘어가는 한국 자정에 메시지를 올바른 날짜로 구분한다', () => {
    expect(officeTalkStamp('2026-09-24T14:59:00Z')).toEqual({
      day: '2026-09-24', label: '2026.09.24 23:59 KST',
    });
    expect(officeTalkStamp('2026-09-24T15:01:00Z')).toEqual({
      day: '2026-09-25', label: '2026.09.25 00:01 KST',
    });
  });

  it('옛 Firestore Timestamp와 ISO 문자열의 날짜·정렬을 같게 읽는다', () => {
    const iso = '2026-09-24T15:01:00Z';
    const seconds = Date.parse(iso) / 1000;
    const old = { toDate: () => new Date(iso) };
    expect(officeTalkStamp(old)).toEqual(officeTalkStamp(iso));
    expect(officeTalkStamp({ seconds })).toEqual(officeTalkStamp(iso));
    expect(officeTalkSortTime(old)).toBe(Date.parse(iso));
  });

  it('시각 없는 옛 기록을 임의의 시각으로 표시하지 않는다', () => {
    expect(officeTalkStamp('2026-09-24')).toEqual({ day: '2026-09-24', label: '2026.09.24 · 시각 미상' });
    expect(officeTalkStamp(undefined)).toEqual({ day: '', label: '날짜·시각 미상' });
  });
});
