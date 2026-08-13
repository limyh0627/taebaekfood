import { describe, it, expect } from 'vitest';
import { buildRawDocMonth, buildRawDocSheetFor } from './docOil';
import type { RawDocEntry } from './docOil';

const MAT = '통깨참기름';
const receipts = (...rows: [string, number][]) =>
  rows.map(([date, received]) => ({ date, received, note: '참깨 압착' }));
const outflow = (rows: Record<string, number>) =>
  Object.fromEntries(Object.entries(rows).map(([d, kg]) => [d, { [MAT]: kg }]));

describe('buildRawDocMonth — 서류 한 장', () => {
  it('이월 + 입고 − 사용 = 기말', () => {
    const s = buildRawDocMonth({
      material: MAT, yearMonth: '2026-08', opening: 100,
      ledgerReceipts: receipts(['2026-08-02', 50]),
      docEntries: [], oilOutflow: outflow({ '2026-08-03': 30 }),
    });
    expect(s.opening).toBe(100);
    expect(s.totalIn).toBe(50);
    expect(s.totalOut).toBe(30);
    expect(s.closing).toBe(120);
  });

  it('원장 실사는 안 본다 — 서류 전용 실사만 잔량을 맞춘다', () => {
    const stocktake: RawDocEntry[] = [{ material: MAT, date: '2026-08-05', targetKg: 500, type: 'stocktake', note: '서류 실사' }];
    const s = buildRawDocMonth({
      material: MAT, yearMonth: '2026-08', opening: 100,
      ledgerReceipts: receipts(['2026-08-02', 50]),
      docEntries: stocktake, oilOutflow: outflow({ '2026-08-03': 30 }),
    });
    expect(s.closing).toBe(500);
    const adj = s.rows.find(r => r.kind === '실사')!;
    expect(adj.adj).toBe(380);          // 120 → 500
    expect(adj.prevBalance).toBe(120);
  });

  it('다른 원료의 사용량은 안 섞인다', () => {
    const s = buildRawDocMonth({
      material: MAT, yearMonth: '2026-08', opening: 0, ledgerReceipts: [], docEntries: [],
      oilOutflow: { '2026-08-03': { 깨분참기름: 999 } },
    });
    expect(s.totalOut).toBe(0);
  });

  it('그 달 밖의 기록은 안 들어온다', () => {
    const s = buildRawDocMonth({
      material: MAT, yearMonth: '2026-08', opening: 10,
      ledgerReceipts: receipts(['2026-07-31', 100], ['2026-09-01', 100]),
      docEntries: [], oilOutflow: outflow({ '2026-07-31': 5, '2026-09-01': 5 }),
    });
    expect(s.rows).toHaveLength(0);
    expect(s.closing).toBe(10);
  });

  it('같은 날이면 기록 시각 순 — 아침에 찍은 실사 뒤로 사용이 빠진다', () => {
    const s = buildRawDocMonth({
      material: MAT, yearMonth: '2026-08', opening: 0,
      ledgerReceipts: [], oilOutflow: outflow({ '2026-08-03': 30 }),
      docEntries: [{ material: MAT, date: '2026-08-03', targetKg: 200, type: 'stocktake', createdAt: '2026-08-03T00:00:00Z' }],
    });
    // 사용은 그날 낮(12:00)으로 보므로 아침에 찍은 실사가 먼저다
    expect(s.closing).toBe(170);
  });
});

describe('buildRawDocSheetFor — 전월이월은 전달 서류의 기말', () => {
  const base = {
    material: MAT,
    ledgerReceipts: receipts(['2026-08-02', 300], ['2026-09-02', 100]),
    oilOutflow: outflow({ '2026-08-03': 100, '2026-09-03': 50 }),
  };
  const opening: RawDocEntry[] = [{ material: MAT, date: '2026-08-01', targetKg: 500, type: 'opening', note: '7월말 이월' }];

  it('첫 달은 서류 이월에서 출발', () => {
    const s = buildRawDocSheetFor({ ...base, yearMonth: '2026-08', docEntries: opening });
    expect(s.opening).toBe(500);
    expect(s.closing).toBe(700);        // 500 + 300 − 100
  });

  it('다음 달 이월 = 전달 기말 (원장 누적 아님)', () => {
    const s = buildRawDocSheetFor({ ...base, yearMonth: '2026-09', docEntries: opening });
    expect(s.opening).toBe(700);
    expect(s.closing).toBe(750);        // 700 + 100 − 50
  });

  it('서류 이월이 없으면 0에서 출발한다', () => {
    const s = buildRawDocSheetFor({ ...base, yearMonth: '2026-08', docEntries: [] });
    expect(s.opening).toBe(0);
    expect(s.closing).toBe(200);
  });

  it('중간 달에 이월을 새로 박으면 그 값이 이긴다', () => {
    const s = buildRawDocSheetFor({
      ...base, yearMonth: '2026-09',
      docEntries: [...opening, { material: MAT, date: '2026-09-01', targetKg: 1000, type: 'opening' }],
    });
    expect(s.opening).toBe(1000);
    expect(s.closing).toBe(1050);
  });

  it('전달 실사가 기말을 바꾸면 다음 달 이월도 따라간다', () => {
    const s = buildRawDocSheetFor({
      ...base, yearMonth: '2026-09',
      docEntries: [...opening, { material: MAT, date: '2026-08-31', targetKg: 40, type: 'stocktake' }],
    });
    expect(s.opening).toBe(40);
    expect(s.closing).toBe(90);         // 40 + 100 − 50
  });
});

describe('같은 날 실사 시각에 따라 순서가 갈린다', () => {
  it('저녁에 찍은 실사는 사용 뒤 — 실사값이 그대로 기말', () => {
    const s = buildRawDocMonth({
      material: MAT, yearMonth: '2026-08', opening: 0,
      ledgerReceipts: [], oilOutflow: outflow({ '2026-08-03': 30 }),
      docEntries: [{ material: MAT, date: '2026-08-03', targetKg: 200, type: 'stocktake', createdAt: '2026-08-03T23:00:00Z' }],
    });
    expect(s.closing).toBe(200);
  });
});
