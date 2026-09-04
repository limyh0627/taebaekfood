import { describe, it, expect } from 'vitest';
import {
  rowKind, rowCodes, rowName, rowDate, rowSearchText,
  filterTimeline, sortTimeline, partnerNamesOf,
  type TimelineRow,
} from './timelineRows';

const 이름 = new Map([['901', '이자수익'], ['931', '이자비용'], ['801', '급여']]);

const 전표 = (o: any = {}): TimelineRow => ({
  kind: 'stmt', dateKey: '2026-09-01', ts: '2026-09-01T10:00:00',
  ...o,
  data: {
    id: 's1', docNo: '260901-01', type: '매출', partnerName: '희성실업',
    tradeDate: '2026-09-01', items: [], ...(o.data ?? {}),
  },
} as any);

const 수금 = (o: any = {}): TimelineRow => ({
  kind: 'pay', partnerId: 'A', partnerName: '희성실업', stmtType: '매출',
  date: '2026-09-01', amount: 1000, paymentId: 'p1', cumul: 0,
  dateKey: '2026-09-01', ts: '2026-09-01T10:00:00', src: {} as any, ...o,
} as any);

const 자금 = (o: any = {}): TimelineRow => ({
  kind: 'cash', dir: '출금', amount: 5000, date: '2026-09-01',
  ts: '2026-09-01T10:00:00', dateKey: '2026-09-01',
  ...o,
  entry: { id: 'c1', dir: '출금', lines: [], ...(o.entry ?? {}) },
} as any);

describe('rowKind — 갈래', () => {
  it('전표는 갈래 그대로, 비용은 대체다', () => {
    expect(rowKind(전표({ data: { type: '매출' } }))).toBe('매출');
    expect(rowKind(전표({ data: { type: '매입' } }))).toBe('매입');
    expect(rowKind(전표({ data: { type: '비용' } }))).toBe('대체');
  });
  it('수금은 입금, 지불은 출금이다', () => {
    expect(rowKind(수금({ stmtType: '매출' }))).toBe('입금');
    expect(rowKind(수금({ stmtType: '매입' }))).toBe('출금');
  });
  it('자금전표의 대체는 대체다', () => {
    expect(rowKind(자금({ entry: { id: 'c1', dir: '대체' } }))).toBe('대체');
    expect(rowKind(자금({ dir: '입금', entry: { id: 'c1', dir: '입금' } }))).toBe('입금');
  });
});

describe('rowCodes — 계정은 줄로 본다', () => {
  it('매출전표는 품목 계정 + 외상매출금(108)', () => {
    const r = 전표({ data: { type: '매출', items: [{ accountCode: '401' }] } });
    expect(rowCodes(r)).toEqual(['401', '108']);
  });

  it('매입전표는 품목 계정 + 외상매입금(251)', () => {
    const r = 전표({ data: { type: '매입', items: [{ accountCode: '500' }] } });
    expect(rowCodes(r)).toEqual(['500', '251']);
  });

  it('대체전표(비용)는 줄에 차·대가 다 있어 상대계정을 안 붙인다', () => {
    const r = 전표({ data: { type: '비용', items: [{ accountCode: '801' }, { accountCode: '263' }] } });
    expect(rowCodes(r)).toEqual(['801', '263']);
  });

  it('복합 자금전표는 줄의 계정을 다 낸다 — 하나만 걸려도 잡혀야 한다', () => {
    const r = 자금({ entry: { id: 'c1', dir: '출금', lines: [{ accountCode: '260', amount: 1 }, { accountCode: '931', amount: 1 }] } });
    expect(rowCodes(r)).toEqual(['260', '931']);
  });

  it('줄이 없는 자금전표는 머리의 계정을 쓴다', () => {
    expect(rowCodes(자금({ accountCode: '815', entry: { id: 'c1', dir: '출금', lines: [] } }))).toEqual(['815']);
  });
});

describe('filterTimeline', () => {
  const deps = { codeName: 이름 };
  const 목록 = [
    전표({ data: { id: 's1', partnerName: '희성실업', tradeDate: '2026-08-15', type: '매출' } }),
    전표({ data: { id: 's2', docNo: '260903-01', partnerName: '푸드원', tradeDate: '2026-09-03', type: '매입' } }),
    수금({ paymentId: 'p1', partnerName: '희성실업', date: '2026-09-05' }),
  ];

  it('기간으로 거른다', () => {
    const r = filterTimeline(목록, { from: '2026-09-01' }, deps);
    expect(r).toHaveLength(2);
    expect(filterTimeline(목록, { to: '2026-08-31' }, deps)).toHaveLength(1);
  });

  it('갈래로 거른다 — 전체는 안 거른다', () => {
    expect(filterTimeline(목록, { kind: '매출' }, deps)).toHaveLength(1);
    expect(filterTimeline(목록, { kind: '입금' }, deps)).toHaveLength(1);
    expect(filterTimeline(목록, { kind: '전체' }, deps)).toHaveLength(3);
  });

  it('거래처는 이름이 정확히 같아야 한다', () => {
    expect(filterTimeline(목록, { partner: '희성실업' }, deps)).toHaveLength(2);
    expect(filterTimeline(목록, { partner: '희성' }, deps)).toHaveLength(0);
  });

  it('문서번호로 찾는다', () => {
    expect(filterTimeline(목록, { search: '260901-01' }, deps)).toHaveLength(1);
  });

  it('계정과목 **이름**으로 찾는다 — 자금 행은 적요에 계정명이 없다', () => {
    const 이자 = 자금({ entry: { id: 'c9', dir: '출금', lines: [{ accountCode: '931', amount: 100 }] } });
    expect(filterTimeline([이자], { search: '이자' }, deps)).toHaveLength(1);
  });

  it('품목명으로도 찾는다', () => {
    const r = 전표({ data: { id: 's9', items: [{ accountCode: '401', name: '참기름' }] } });
    expect(filterTimeline([r], { search: '참기름' }, deps)).toHaveLength(1);
  });

  it('계정 필터는 **줄**로 본다 — 복합 전표가 통째로 빠지면 안 된다', () => {
    const 상환 = 자금({ entry: { id: 'c8', dir: '출금', lines: [{ accountCode: '260', amount: 1 }, { accountCode: '931', amount: 1 }] } });
    const 이자만 = (codes: string[]) => codes.includes('931');
    expect(filterTimeline([상환], {}, { ...deps, matchAccount: 이자만 })).toHaveLength(1);
  });

  it('매출전표가 108(외상매출금)로도 걸린다 — 상대변은 분개 때 생긴다', () => {
    const 재무만 = (codes: string[]) => codes.includes('108');
    expect(filterTimeline([목록[0]], {}, { ...deps, matchAccount: 재무만 })).toHaveLength(1);
  });

  it('아무 조건도 없으면 다 나온다', () => {
    expect(filterTimeline(목록, {}, deps)).toHaveLength(3);
  });
});

describe('sortTimeline', () => {
  it('오래된 것이 먼저', () => {
    const r = sortTimeline([
      전표({ ts: '2026-09-05T10:00:00', data: { id: '나중' } }),
      전표({ ts: '2026-09-01T10:00:00', data: { id: '먼저' } }),
    ]);
    expect((r[0] as any).data.id).toBe('먼저');
  });

  it('같은 시각이면 전표가 수금보다 위 — 매출 가산 후 수금 차감이다', () => {
    const r = sortTimeline([
      수금({ ts: '2026-09-01T10:00:00' }),
      전표({ ts: '2026-09-01T10:00:00' }),
    ]);
    expect(r[0].kind).toBe('stmt');
  });

  it('시각까지 같으면 끊은 순서 — 소급 전표는 시각이 전부 23:59:59다', () => {
    const r = sortTimeline([
      전표({ ts: '2026-08-01T23:59:59', data: { id: 'stmt-1786000000002' } }),
      전표({ ts: '2026-08-01T23:59:59', data: { id: 'stmt-1786000000001' } }),
    ]);
    expect((r[0] as any).data.id).toBe('stmt-1786000000001');
  });
});

describe('partnerNamesOf', () => {
  it('있는 이름만, 가나다순으로, 겹치지 않게', () => {
    expect(partnerNamesOf([
      전표({ data: { partnerName: '푸드원' } }),
      전표({ data: { partnerName: '희성실업' } }),
      전표({ data: { partnerName: '희성실업' } }),
      전표({ data: { partnerName: '' } }),
    ])).toEqual(['푸드원', '희성실업']);
  });
});

describe('rowName · rowDate', () => {
  it('전표는 거래일, 나머지는 date', () => {
    expect(rowDate(전표({ data: { tradeDate: '2026-09-01' } }))).toBe('2026-09-01');
    expect(rowDate(수금({ date: '2026-09-05' }))).toBe('2026-09-05');
  });
  it('거래처가 없는 자금 행은 빈 이름', () => {
    expect(rowName(자금())).toBe('');
  });
});

describe('rowSearchText', () => {
  it('수금 행은 검색할 글이 없다 — 이름·문서번호로 찾는다', () => {
    expect(rowSearchText(수금(), 이름)).toBe('');
  });
});
