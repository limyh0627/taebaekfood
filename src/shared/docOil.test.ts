import { describe, it, expect } from 'vitest';
import { docPumok, docOilKg, addOilByRaw, docSaleLine, docDateOf, reconcileSaleVsRaw, findDocDrops, DOC_RECALC_RAWS, DOC_DENSITY } from './docOil';

describe('docOilKg — 판매 1줄 → 서류상 기름 kg', () => {
  it('ml·L은 부피 × 밀도', () => {
    expect(docOilKg('1800ml', 10)).toBeCloseTo(1.8 * 10 * DOC_DENSITY, 6);
    expect(docOilKg('350ml', 20)).toBeCloseTo(0.35 * 20 * DOC_DENSITY, 6);
    expect(docOilKg('1.8L', 1)).toBeCloseTo(1.8 * DOC_DENSITY, 6);
  });

  it('kg 규격(캔)은 그 자체가 기름 무게 — 밀도를 곱하지 않는다', () => {
    expect(docOilKg('16.5kg', 1)).toBe(16.5);
    expect(docOilKg('16.5kg', 4)).toBe(66);
    // 예전 생산작업기록부는 여기에도 0.92를 곱해 15.18로 잡았다
    expect(docOilKg('16.5kg', 1)).not.toBeCloseTo(16.5 * DOC_DENSITY, 3);
  });

  it('규격을 못 읽으면 0', () => {
    expect(docOilKg('', 5)).toBe(0);
    expect(docOilKg(undefined, 5)).toBe(0);
    expect(docOilKg('한 박스', 5)).toBe(0);
  });
});

describe('docPumok — 서류 집계용 품목', () => {
  it('새싹은 하남댁 라인으로 묶는다', () => {
    expect(docPumok('새싹참기름')).toBe('하남댁참기름');
    expect(docPumok('새싹들기름')).toBe('하남댁들기름');
  });
  it('그 외는 그대로', () => {
    expect(docPumok('시골향참기름2')).toBe('시골향참기름2');
    expect(docPumok(undefined)).toBe('');
  });
});

describe('addOilByRaw — 품목 kg → 원료별 kg', () => {
  it('단일 원료', () => {
    expect(addOilByRaw({}, '시골향참기름1', 100)).toEqual({ 통깨참기름: 100 });
    expect(addOilByRaw({}, '시골향참기름3', 100)).toEqual({ 깨분참기름: 100 });
  });

  it('확정 비율대로 나눈다', () => {
    expect(addOilByRaw({}, '시골향참기름2', 100)).toEqual({ 통깨참기름: 50, 깨분참기름: 50 });
    expect(addOilByRaw({}, '시골향참기름4', 100)).toEqual({ 통깨참기름: 10, 깨분참기름: 90 });
    expect(addOilByRaw({}, '시골향들기름2', 100)).toEqual({ 수입들기름: 100 });   // 수입산 100% (2026-08-12)
    expect(addOilByRaw({}, '하남댁들기름', 100)).toEqual({ 통들깨들기름: 25, 수입들기름: 75 });
  });

  it('하남댁·해달 참기름은 통깨 100%', () => {
    expect(addOilByRaw({}, '하남댁참기름', 100)).toEqual({ 통깨참기름: 100 });
    expect(addOilByRaw({}, '해달참기름', 100)).toEqual({ 통깨참기름: 100 });
  });

  it('새싹참기름도 하남댁으로 묶여 통깨 100%', () => {
    expect(addOilByRaw({}, '새싹참기름', 100)).toEqual({ 통깨참기름: 100 });
  });

  it('여러 품목을 같은 통에 누적', () => {
    const acc: Record<string, number> = {};
    addOilByRaw(acc, '시골향참기름1', 100);   // 통깨 100
    addOilByRaw(acc, '시골향참기름3', 50);    // 깨분 50
    addOilByRaw(acc, '시골향참기름2', 100);   // 통깨 50 / 깨분 50
    expect(acc).toEqual({ 통깨참기름: 150, 깨분참기름: 100 });
  });

  it('배합표에 없는 품목은 조용히 빠진다(서류에 안 잡힘)', () => {
    expect(addOilByRaw({}, '없는품목', 100)).toEqual({});
  });
});

describe('docSaleLine — 박스는 낱개로 풀어서 집계', () => {
  const loose = { id: 'p-loose', name: '참기름/350ml', category: 'product', spec: '350ml', 품목: '시골향참기름1' } as any;
  const box = {
    id: 'p-box', name: '참기름/350ml (20개입)', category: 'product', spec: '', 품목: '',
    submaterials: [{ id: 'p-loose', category: 'product', stock: 20 }],   // bomQty는 stock을 읽는다
  } as any;
  const find = (id: string) => (id === 'p-loose' ? loose : undefined);

  it('박스 1개 → 낱개 20개, 품목·규격은 낱개 것', () => {
    expect(docSaleLine(box, 1, find)).toEqual({ 품목: '시골향참기름1', spec: '350ml', qty: 20 });
  });

  it('박스 3개 → 낱개 60개', () => {
    expect(docSaleLine(box, 3, find)?.qty).toBe(60);
  });

  it('낱개는 그대로', () => {
    expect(docSaleLine(loose, 5, find)).toEqual({ 품목: '시골향참기름1', spec: '350ml', qty: 5 });
  });

  it('품목이 없으면 null — 서류에 잡을 근거가 없다', () => {
    expect(docSaleLine({ ...loose, 품목: '' }, 5, find)).toBeNull();
    expect(docSaleLine(undefined, 5, find)).toBeNull();
  });

  it('박스 판매가 서류에서 통째로 누락되지 않는다 (회귀 방지)', () => {
    const line = docSaleLine(box, 2, find)!;
    const kg = docOilKg(line.spec, line.qty);           // 40병 × 0.35L × 0.92
    expect(kg).toBeCloseTo(40 * 0.35 * DOC_DENSITY, 6);
    expect(addOilByRaw({}, line.품목, Math.round(kg))).toEqual({ 통깨참기름: 13 });
  });
});

describe('docDateOf — 네 서류의 공통 기준일 = 배송완료일', () => {
  it('배송완료일만 본다', () => {
    expect(docDateOf({ deliveredAt: '2026-08-10T05:00:00Z' })).toBe('2026-08-10');
  });
  it('전표일자·배송예정일은 안 쓴다 — 실제 나간 날 하나로 못 박는다', () => {
    expect(docDateOf({ deliveredAt: '2026-08-10T05:00:00Z', documentDate: '2026-08-07', deliveryDate: '2026-08-13' } as any))
      .toBe('2026-08-10');
    expect(docDateOf({ documentDate: '2026-08-07', deliveryDate: '2026-08-13' } as any)).toBe('');
  });
  it('배송완료일이 없으면 빈 값 — 서류에서 빠진다', () => {
    expect(docDateOf({})).toBe('');
  });
  it('ISO 시각이 붙어 있어도 날짜만 자른다', () => {
    expect(docDateOf({ deliveredAt: '2026-08-07T00:00:00.000Z' })).toBe('2026-08-07');
  });
});

describe('DOC_RECALC_RAWS — 판매에서 되계산하는 원료', () => {
  it('기름뿐 아니라 깨·가루도 포함된다(판매기록부와 같은 근거로 맞추려면)', () => {
    for (const r of ['통깨참기름', '깨분참기름', '수입들기름', '통들깨들기름', '생들기름',
                     '볶음참깨', '볶음들깨', '탈피들깨가루', '볶음검정참깨'])
      expect(DOC_RECALC_RAWS.has(r), r).toBe(true);
  });
  it('배합표에 없는 원료는 원장을 그대로 쓴다', () => {
    expect(DOC_RECALC_RAWS.has('참깨')).toBe(false);   // 참깨는 압착 투입 — 판매에서 안 나온다
  });
});

describe('reconcileSaleVsRaw — 판매기록부 ↔ 원료수불부 대조', () => {
  it('배합비가 있으면 두 문서의 총 kg이 같다 — 불일치 없음', () => {
    // 하남댁참기름 = 통깨참기름 100%
    expect(reconcileSaleVsRaw({ '2026-08-10': { '하남댁참기름': 100 } })).toEqual([]);
  });

  it('여러 원료로 쪼개져도 합은 같다', () => {
    // 시골향참기름4 = 통깨 10% + 깨분 90%
    expect(reconcileSaleVsRaw({ '2026-08-10': { '시골향참기름4': 1000 } })).toEqual([]);
  });

  it('배합비 없는 품목은 통째로 빠지고 잡아낸다', () => {
    const [m] = reconcileSaleVsRaw({ '2026-08-10': { '없는품목': 500 } });
    expect(m.date).toBe('2026-08-10');
    expect(m.saleKg).toBe(500);
    expect(m.rawKg).toBe(0);
    expect(m.diffKg).toBe(500);
    expect(m.unmapped).toEqual(['없는품목']);
  });

  it('섞여 있으면 빠진 만큼만 차이로 잡힌다', () => {
    const [m] = reconcileSaleVsRaw({ '2026-08-10': { '하남댁참기름': 100, '없는품목': 40 } });
    expect(m.saleKg).toBe(140);
    expect(m.rawKg).toBe(100);
    expect(m.diffKg).toBe(40);
    expect(m.unmapped).toEqual(['없는품목']);
  });

  it('반올림 오차는 허용치 안이면 넘어간다', () => {
    // 10%/90% 배분에서 원료별 반올림이 생겨도 몇 kg 이내면 정상으로 본다
    expect(reconcileSaleVsRaw({ '2026-08-10': { '시골향참기름4': 7 } })).toEqual([]);
  });

  it('날짜가 여럿이면 문제 있는 날만 돌려주고 날짜순으로 준다', () => {
    const out = reconcileSaleVsRaw({
      '2026-08-11': { '없는품목': 10 },
      '2026-08-09': { '하남댁참기름': 50 },
      '2026-08-10': { '또없는품목': 20 },
    });
    expect(out.map(m => m.date)).toEqual(['2026-08-10', '2026-08-11']);
  });
});

describe('findDocDrops — 판매기록부에 있는데 원료수불부에서 빠지는 줄', () => {
  const order = (over: any = {}) => ({
    status: 'DELIVERED', deliveredAt: '2026-08-10T00:00:00.000Z', partnerName: '테스트상회',
    items: [{ itemId: 'p1', name: '시골향참기름/350ml', quantity: 20 }], ...over,
  });

  it('배송완료일이 있으면 안 걸린다', () => {
    expect(findDocDrops([order()])).toEqual([]);
  });

  it('배송완료일이 없으면 그 주문의 모든 줄이 잡힌다', () => {
    const drops = findDocDrops([order({ deliveredAt: undefined, items: [
      { itemId: 'p1', name: '참기름/350ml', quantity: 20 },
      { itemId: 'p2', name: '볶음참깨/1kg', quantity: 5 },
    ] })]);
    expect(drops).toHaveLength(2);
    expect(drops.map(d => d.itemName)).toEqual(['참기름/350ml', '볶음참깨/1kg']);
    expect(drops.every(d => d.reason === '배송완료일 없음')).toBe(true);
    expect(drops[0].partnerName).toBe('테스트상회');
    expect(drops[1].qty).toBe(5);
  });

  it('기름이 아닌 품목도 똑같이 잡는다 — 전 품목 대상', () => {
    const drops = findDocDrops([order({ deliveredAt: '', items: [{ itemId: 'p9', name: '탈피들깨가루/1kg', quantity: 3 }] })]);
    expect(drops).toHaveLength(1);
    expect(drops[0].itemName).toBe('탈피들깨가루/1kg');
  });

  it('서류 대상이 아닌 상태는 안 본다', () => {
    expect(findDocDrops([order({ status: 'PENDING', deliveredAt: undefined })])).toEqual([]);
    expect(findDocDrops([order({ status: 'DISPATCHED', deliveredAt: undefined })])).toEqual([]);
  });

  it('출고(SHIPPED)는 안 잡는다 — 아직 배송완료 처리 전이라 날짜가 없는 게 정상', () => {
    expect(findDocDrops([order({ status: 'SHIPPED', deliveredAt: undefined })])).toEqual([]);
  });
});
