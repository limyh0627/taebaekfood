import { describe, it, expect } from 'vitest';
import { docPumok, docOilKg, addOilByRaw, docSaleLine, docDateOf, DOC_RECALC_RAWS, DOC_DENSITY } from './docOil';

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
    expect(addOilByRaw({}, '시골향들기름2', 100)).toEqual({ 통들깨들기름: 10, 수입들기름: 90 });
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

describe('docDateOf — 네 서류의 공통 기준일', () => {
  it('판매기록부가 박은 documentDate가 최우선', () => {
    expect(docDateOf({ documentDate: '2026-08-07', deliveredAt: '2026-08-10T05:00:00Z', deliveryDate: '2026-08-13' }))
      .toBe('2026-08-07');
  });
  it('없으면 실제 납품일 → 배송예정일 순', () => {
    expect(docDateOf({ deliveredAt: '2026-08-10T05:00:00Z', deliveryDate: '2026-08-13' })).toBe('2026-08-10');
    expect(docDateOf({ deliveryDate: '2026-08-13' })).toBe('2026-08-13');
    expect(docDateOf({})).toBe('');
  });
  it('ISO 시각이 붙어 있어도 날짜만 자른다', () => {
    expect(docDateOf({ documentDate: '2026-08-07T00:00:00.000Z' })).toBe('2026-08-07');
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
