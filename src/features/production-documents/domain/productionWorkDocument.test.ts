import { describe, expect, it } from 'vitest';
import {
  editProductionWorkLine, emptyProductionWorkFields, mergeProductionWorkEvidence,
  newProductionWorkDocument, productionWorkLineIssues, productionWorkPrintPages,
  type ProductionWorkEvidence,
} from './productionWorkDocument';

const now = '2026-09-27T09:00:00.000Z';
const doc = newProductionWorkDocument('taebaek', '2026-09-22', 'employee', now);
const evidence = (key = 'usage/lot-1'): ProductionWorkEvidence => ({
  key, batchKey: 'production-1', companyId: 'taebaek', reversed: false,
  fields: {
    ...emptyProductionWorkFields(), manufacturedDate: '2026-09-22', itemId: 'p1',
    itemNameSnapshot: '맑음들기름', specSnapshot: '300ml', manufacturingLotNo: 'P-001',
    expiryDate: '2027-09-21', productionQty: 1000, productionUnit: '병',
    rawItemId: 'r1', rawNameSnapshot: '생들기름', rawUsedKg: 276,
    rawLotId: key, rawLotNoSnapshot: 'R-001', workerNameSnapshot: '작업자',
  },
  source: { kind: 'production', sourceId: 'order-line-attempt-1', operationId: 'usage',
    ledgerId: 'ledger-1', lotId: key, recordedAt: '2026-09-22T00:30:00.000Z' },
});

describe('생산작업일지 근거와 수동 보완', () => {
  it('회사와 날짜로 고정 ID를 만들며 잘못된 날짜는 거절한다', () => {
    expect(doc.id).toBe('taebaek__production-work__2026-09-22');
    expect(() => newProductionWorkDocument('taebaek', '2026-02-30', 'x', now)).toThrow();
    expect(newProductionWorkDocument('punghoe', doc.documentDate, 'x', now).id).not.toBe(doc.id);
  });
  it('재생성해도 행·수량·원본 시각이 중복되지 않는다', () => {
    const rows = mergeProductionWorkEvidence(doc, [], [evidence()], now);
    const next = mergeProductionWorkEvidence(doc, rows, [evidence()], '2026-09-28T00:00:00Z');
    expect(next).toEqual(rows);
    expect(next[0].source.recordedAt).toBe('2026-09-22T00:30:00.000Z');
    expect(next[0].productionQty).toBe(1000);
  });
  it('빈칸으로 고친 값도 수동 보완으로 보존하고 원본 스냅샷은 갱신한다', () => {
    const [row] = mergeProductionWorkEvidence(doc, [], [evidence()], now);
    const edited = editProductionWorkLine(editProductionWorkLine(row, 'productionQty', 990), 'note', '');
    const changed = evidence();
    changed.fields.productionQty = 1100;
    changed.fields.note = '원본 비고';
    const [next] = mergeProductionWorkEvidence(doc, [edited], [changed], now);
    expect(next.productionQty).toBe(990);
    expect(next.note).toBe('');
    expect(next.sourceSnapshot.productionQty).toBe(1100);
  });
  it('원본 누락·취소에도 삭제하지 않으며 미확인 표시를 남긴다', () => {
    const rows = mergeProductionWorkEvidence(doc, [], [evidence()], now);
    const missing = mergeProductionWorkEvidence(doc, rows, [], now);
    expect(missing).toHaveLength(1);
    expect(productionWorkLineIssues(missing[0])).toContain('원본 재확인 필요');
    const reversed = mergeProductionWorkEvidence(doc, rows, [{ ...evidence(), reversed: true }], now);
    expect(productionWorkLineIssues(reversed[0])).toContain('원본 취소됨');
  });
  it('회사·문서 혼입과 중복 원천을 거절한다', () => {
    expect(() => mergeProductionWorkEvidence(doc, [], [{ ...evidence(), companyId: 'punghoe' }], now)).toThrow();
    expect(() => mergeProductionWorkEvidence(doc, [], [evidence(), evidence()], now)).toThrow();
    const rows = mergeProductionWorkEvidence(doc, [], [evidence()], now);
    expect(() => mergeProductionWorkEvidence(doc, [{ ...rows[0], documentId: 'other' }], [], now)).toThrow();
  });
  it('생산 묶음에 원료 로트가 여러 개여도 생산량은 한 번만 인쇄한다', () => {
    const rows = mergeProductionWorkEvidence(doc, [], [evidence('lot-1'), evidence('lot-2')], now);
    expect(productionWorkPrintPages(rows)[0].map(row => row.showProduction)).toEqual([true, false]);
  });
  it('20행씩 나누되 다음 장에서 같은 생산량을 다시 합산하지 않는다', () => {
    const rows = mergeProductionWorkEvidence(doc, [], Array.from({ length: 21 }, (_, i) => evidence(String(i))), now);
    const pages = productionWorkPrintPages(rows);
    expect(pages.map(page => page.length)).toEqual([20, 1]);
    expect(pages.flat().filter(row => row.showProduction)).toHaveLength(1);
  });
  it('생산 묶음의 상충값·결측·음수·무한값을 확인 대상으로 남긴다', () => {
    const rows = mergeProductionWorkEvidence(doc, [], [evidence('a'), evidence('b')], now);
    rows[1].productionQty = 900;
    expect(productionWorkPrintPages(rows)[0][0].issues).toContain('같은 생산 묶음의 정보 불일치');
    expect(productionWorkLineIssues({ ...rows[0], productionQty: NaN, rawUsedKg: -1, manufacturingLotNo: '' }))
      .toEqual(expect.arrayContaining(['생산량 미확인', '원료 사용량 미확인', '제조 LOT 미확인']));
  });
});
