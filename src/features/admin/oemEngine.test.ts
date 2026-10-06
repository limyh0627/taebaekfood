import { describe, it, expect } from 'vitest';
import { createOemEngine, itemKg } from './oemEngine';
import type { Item, PurchaseOrder } from '../../shared/types';

const item = (over: Partial<Item>): Item =>
  ({ id: 'x', name: 'x', type: 'product', unit: '개', stock: 0, minStock: 0, image: '', ...over });

// 참깨(raw 홀더) + 볶음참깨 완제품/벌크
const items: Item[] = [
  item({ id: 'raw-참깨', name: '참깨', type: 'raw', unit: 'kg', subtype: '벌크', stock: 5000 }),
  item({ id: 'raw-볶음참깨', name: '볶음참깨', type: 'wip', unit: 'kg', subtype: '벌크', stock: 0 }),
  item({ id: 'box10', name: '볶음참깨/10kg박스', spec: '10kg', procureType: '임가공', stock: 0 }),
  item({ id: 'box20', name: '볶음참깨/20kg박스', spec: '20kg', procureType: '임가공', stock: 0 }),
  item({ id: 'nakgae', name: '볶음참깨-낱개/1kg', spec: '1kg', procureType: '임가공', stock: 0 }),
];

/** mock deps — 쓰기 호출을 기록만 한다 */
function makeDeps() {
  const rawCalls: any[] = [];
  const updates: any[] = [];
  const adds: any[] = [];
  const deps = {
    companyId: 'taebaek',
    items,
    partners: [{ id: 'oem1', name: '푸미푸드', companyId: 'taebaek' }],
    issueOemBatchJob: async (input: any) => {
      input.sent.forEach((row: any) => rawCalls.push({ companyId: input.companyId, material: row.material, rawItemId: row.rawItemId, deltaKg: -row.kg }));
      adds.push({ c: 'purchaseOrders', d: { id: input.jobId, poType: 'oem', status: 'invoiced', oemPartnerId: input.partnerId, oemSent: input.sent } });
      return { poId: input.jobId };
    },
    adjustRawLots: async (o: any) => { rawCalls.push(o); },
    updateItem: async (c: string, id: string, d: any) => { updates.push({ c, id, d }); },
    addItem: async (c: string, d: any) => { adds.push({ c, d }); return d.id; },
    applyOemFeeStatement: async (input: any) => {
      adds.push({ c: 'issuedStatements', d: input.statement });
      updates.push({ c: 'purchaseOrders', id: input.poId, d: { linkedStatementId: input.statement.id, oemFeePerKg: input.perKg } });
      return input.statement.id;
    },
    applyOemReceiptInventory: async (input: any) => {
      for (const row of input.items) {
        const current = items.find(item => item.id === row.itemId)?.stock ?? 0;
        updates.push({ c: 'items', id: row.itemId, d: { stock: current + row.qty, ...(row.lot ? { lots: [row.lot] } : {}) } });
      }
      updates.push({ c: 'purchaseOrders', id: input.poId, d: input.poPatch });
      return { status: 'applied', receivedKg: input.poPatch.oemReceivedKg,
        loss: 1000 - input.poPatch.oemReceivedKg, lotNos: {} };
    },
    // 원료식 — 볶음참깨 완제품은 전량 '볶음참깨' 원료로 잡힌다
    buildFormula: (key: string) => (/볶음참깨/.test(key) ? [{ raw: '볶음참깨', ratio: 1 }] : []),
  };
  return { deps, rawCalls, updates, adds };
}

describe('itemKg', () => {
  it('spec에서 kg 파싱', () => {
    expect(itemKg(item({ spec: '10kg' }))).toBe(10);
    expect(itemKg(item({ spec: '1kg' }))).toBe(1);
    expect(itemKg(item({ packageKg: 20, spec: '' }))).toBe(20);
    expect(itemKg(item({ spec: '' }))).toBe(0);
  });
});

describe('issueOemBatch (발주)', () => {
  it('본재고 FIFO 차감 + 열린 OEM 배치 생성', async () => {
    const { deps, rawCalls, adds } = makeDeps();
    const eng = createOemEngine(deps as any);
    const { poId } = await eng.issueOemBatch({
      jobId: 'oem-test-1',
      oemPartnerId: 'oem1', partnerName: 'OO상회',
      sent: [{ material: '참깨', kg: 1000 }], date: '2026-07-17',
    });

    // 참깨 1000kg 차감
    expect(rawCalls).toHaveLength(1);
    expect(rawCalls[0]).toMatchObject({ material: '참깨', rawItemId: 'raw-참깨', deltaKg: -1000 });
    // OEM 배치 카드 (열림)
    const po = adds.find(a => a.c === 'purchaseOrders')!.d;
    expect(po).toMatchObject({ poType: 'oem', status: 'invoiced', oemPartnerId: 'oem1' });
    expect(po.oemSent).toEqual([{ material: '참깨', rawItemId: 'raw-참깨', kg: 1000 }]);
    expect(poId).toBe(po.id);
  });

  it('원료 홀더가 없으면 던진다', async () => {
    const { deps } = makeDeps();
    const eng = createOemEngine(deps as any);
    await expect(eng.issueOemBatch({
      jobId: 'oem-test-2',
      oemPartnerId: 'oem1', partnerName: 'OO', sent: [{ material: '없는원료', kg: 100 }], date: '2026-07-17',
    })).rejects.toThrow('원료 홀더');
  });

  it('다른 회사 거래처나 원료를 선택하면 차감 전에 거절한다', async () => {
    const { deps, rawCalls, adds } = makeDeps();
    deps.partners[0].companyId = 'punghoe';
    const eng = createOemEngine(deps as any);
    await expect(eng.issueOemBatch({
      jobId: 'oem-test-3',
      oemPartnerId: 'oem1', partnerName: 'OO', sent: [{ material: '참깨', kg: 100 }], date: '2026-07-17',
    })).rejects.toThrow('다른 회사');
    expect(rawCalls).toHaveLength(0);
    expect(adds).toHaveLength(0);

    deps.partners[0].companyId = 'taebaek';
    deps.items = [item({ id: 'raw-풍회참깨', name: '풍회참깨', type: 'raw', subtype: '벌크', unit: 'kg', companyId: 'punghoe' })];
    await expect(createOemEngine(deps as any).issueOemBatch({
      jobId: 'oem-test-4',
      oemPartnerId: 'oem1', partnerName: 'OO', sent: [{ material: '풍회참깨', kg: 100 }], date: '2026-07-17',
    })).rejects.toThrow('현재 회사');
    expect(rawCalls).toHaveLength(0);
  });

  it('원료 2줄 중 두 번째 홀더가 잘못되어도 첫 번째 원료를 차감하지 않는다', async () => {
    const { deps, rawCalls, adds } = makeDeps();
    deps.items = [...items, item({ id: 'raw-풍회참깨', name: '풍회참깨', type: 'raw', subtype: '벌크', unit: 'kg', companyId: 'punghoe' })];
    await expect(createOemEngine(deps as any).issueOemBatch({
      jobId: 'oem-test-5',
      oemPartnerId: 'oem1', partnerName: '푸미푸드',
      sent: [{ material: '참깨', kg: 100 }, { material: '풍회참깨', kg: 50 }], date: '2026-07-17',
    })).rejects.toThrow('현재 회사');
    expect(rawCalls).toHaveLength(0);
    expect(adds).toHaveLength(0);
  });
});

describe('receiveOemBatch (가공입고)', () => {
  const openPo: PurchaseOrder = {
    id: 'oem-1', poType: 'oem', partnerName: 'OO상회', oemPartnerId: 'oem1',
    oemSent: [{ material: '참깨', kg: 1000 }], status: 'invoiced',
    itemId: '', itemName: '', quantity: 0, createdAt: '',
  };

  it('완제품 재고 +N, 배치 닫힘, 로스 자동 — 전표는 안 끊는다', async () => {
    const { deps, updates, adds } = makeDeps();
    const eng = createOemEngine(deps as any);
    // 10kg박스 20 + 20kg박스 10 + 낱개 5 = 200+200+5 = 405kg
    const res = await eng.receiveOemBatch({
      po: openPo,
      returns: [{ itemId: 'box10', qty: 20 }, { itemId: 'box20', qty: 10 }, { itemId: 'nakgae', qty: 5 }],
      unitPricePerKg: 2000, date: '2026-07-17',
    });

    expect(res.receivedKg).toBe(405);
    expect(res.loss).toBe(595);            // 1000 − 405

    expect(updates.filter(u => u.c === 'items').map(u => [u.id, u.d.stock])).toEqual([
      ['box10', 20], ['box20', 10], ['nakgae', 5],
    ]);
    // 전표 없음 — 사용자가 확인 후 발행
    expect(adds.filter(a => a.c === 'issuedStatements')).toHaveLength(0);
    const poUpd = updates.find(u => u.c === 'purchaseOrders')!;
    expect(poUpd.d).toMatchObject({ status: 'received', oemReceivedKg: 405, oemFeePerKg: 2000 });
    expect(poUpd.d.linkedStatementId).toBeUndefined();   // 전표 작성 대기
  });

  it('가공단가 생략 시 기본 500원/kg가 배치에 저장된다', async () => {
    const { deps, updates } = makeDeps();
    const eng = createOemEngine(deps as any);
    await eng.receiveOemBatch({ po: openPo, returns: [{ itemId: 'box10', qty: 10 }], date: '2026-07-17' });
    expect(updates.find(u => u.c === 'purchaseOrders')!.d.oemFeePerKg).toBe(500);
  });

  it('이미 받은 배치는 던진다', async () => {
    const { deps } = makeDeps();
    const eng = createOemEngine(deps as any);
    await expect(eng.receiveOemBatch({
      po: { ...openPo, status: 'received' }, returns: [{ itemId: 'nakgae', qty: 1 }], date: '2026-07-17',
    })).rejects.toThrow('이미 가공입고');
  });

  it('다른 회사 배치 또는 돌아온 품목이면 벌크·완제품 모두 쓰지 않는다', async () => {
    const { deps, rawCalls, updates } = makeDeps();
    const eng = createOemEngine(deps as any);
    await expect(eng.receiveOemBatch({
      po: { ...openPo, companyId: 'punghoe' }, returns: [{ itemId: 'box10', qty: 1 }],
      date: '2026-07-17',
    })).rejects.toThrow('다른 회사');
    deps.items = items.map(row => row.id === 'box10' ? { ...row, companyId: 'punghoe' as const } : row);
    await expect(createOemEngine(deps as any).receiveOemBatch({
      po: openPo, returns: [{ itemId: 'box10', qty: 1 }],
      date: '2026-07-17',
    })).rejects.toThrow('현재 회사');
    expect(rawCalls).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});

describe('issueOemFeeStatement (가공비 전표 — 사용자 확인 후)', () => {
  const receivedPo: PurchaseOrder = {
    id: 'oem-1', poType: 'oem', partnerName: '푸미푸드', oemPartnerId: 'oem1',
    oemSent: [{ material: '참깨', kg: 1000 }], oemReceivedKg: 405, oemFeePerKg: 2000,
    status: 'received', itemId: '', itemName: '', quantity: 0, createdAt: '',
  };

  it('배치에 저장된 단가로 과세 전표 발행 + 연결', async () => {
    const { deps, updates, adds } = makeDeps();
    const eng = createOemEngine(deps as any);
    const r = await eng.issueOemFeeStatement({ po: receivedPo, date: '2026-07-17' });

    // 단가는 부가세 포함 — 405kg × 2000 = 합계 810,000에서 공급가 역산
    expect(r).toMatchObject({ supply: 736_364, tax: 73_636, total: 810_000 });
    const stmt = adds.find(a => a.c === 'issuedStatements')!.d;
    expect(stmt).toMatchObject({ type: '매입', partnerName: '푸미푸드', totalAmount: 810_000 });
    expect(stmt.items[0].accountCode).toBe('540');
    expect(updates.find(u => u.c === 'purchaseOrders')!.d.linkedStatementId).toBe(stmt.id);
  });

  it('단가를 바꿔 발행할 수 있다', async () => {
    const { deps, adds } = makeDeps();
    const eng = createOemEngine(deps as any);
    await eng.issueOemFeeStatement({ po: receivedPo, unitPricePerKg: 500, date: '2026-07-17' });
    expect(adds.find(a => a.c === 'issuedStatements')!.d.totalAmount).toBe(202_500); // 405 × 500 = 합계
  });

  it('면세면 세액 0', async () => {
    const { deps, adds } = makeDeps();
    const eng = createOemEngine(deps as any);
    await eng.issueOemFeeStatement({ po: receivedPo, date: '2026-07-17', taxable: false });
    expect(adds.find(a => a.c === 'issuedStatements')!.d.totalTax).toBe(0);
  });

  it('완제품과 벌크를 함께 받은 가공비를 모든 전표 줄에 반영한다', async () => {
    const { deps, adds } = makeDeps();
    const po: PurchaseOrder = {
      ...receivedPo, oemReceivedKg: 1400,
      items: [{ itemId: 'nakgae', name: '볶음참깨-낱개/1kg', quantity: 100, unit: '개' }],
      oemReceivedBulk: [{ material: '볶음참깨', kg: 1300 }],
    };
    const result = await createOemEngine(deps as any).issueOemFeeStatement({ po, date: '2026-07-17' });
    const stmt = adds.find(a => a.c === 'issuedStatements')!.d;
    expect(stmt.items).toHaveLength(2);
    expect(stmt.items[1]).toMatchObject({ name: expect.stringContaining('벌크'), qty: 1300, accountCode: '540' });
    expect(stmt.items.reduce((sum: number, line: { total: number }) => sum + line.total, 0)).toBe(2_800_000);
    expect(result.total).toBe(2_800_000);
  });

  it('전표는 연결됐지만 확인요청 완료 표시가 실패한 경우 같은 전표를 재확인한다', async () => {
    const { deps } = makeDeps();
    let attempted = 0;
    deps.applyOemFeeStatement = async (input: any) => { attempted++; return input.statement.id; };
    const result = await createOemEngine(deps as any).issueOemFeeStatement({
      po: { ...receivedPo, linkedStatementId: `OEMFEE-${receivedPo.id}` }, date: '2026-07-17',
    });
    expect(result.statementId).toBe(`OEMFEE-${receivedPo.id}`);
    expect(attempted).toBe(1);
  });

  it('가공입고 전이면 던진다', async () => {
    const { deps } = makeDeps();
    const eng = createOemEngine(deps as any);
    await expect(eng.issueOemFeeStatement({ po: { ...receivedPo, status: 'invoiced' }, date: '2026-07-17' }))
      .rejects.toThrow('가공입고 전');
  });

  it('이미 전표가 있으면 던진다 (중복 발행 방지)', async () => {
    const { deps } = makeDeps();
    const eng = createOemEngine(deps as any);
    await expect(eng.issueOemFeeStatement({ po: { ...receivedPo, linkedStatementId: 'stmt-x' }, date: '2026-07-17' }))
      .rejects.toThrow('이미 가공비 전표');
  });

  it('다른 회사 배치 또는 전표 품목이면 발행 전에 거절한다', async () => {
    const { deps, adds, updates } = makeDeps();
    await expect(createOemEngine(deps as any).issueOemFeeStatement({
      po: { ...receivedPo, companyId: 'punghoe' }, date: '2026-07-17',
    })).rejects.toThrow('다른 회사');
    deps.items = items.map(row => row.id === 'box10' ? { ...row, companyId: 'punghoe' as const } : row);
    await expect(createOemEngine(deps as any).issueOemFeeStatement({
      po: { ...receivedPo, items: [{ itemId: 'box10', name: '볶음참깨', quantity: 1, unit: '박스' }] },
      date: '2026-07-17',
    })).rejects.toThrow('현재 회사');
    expect(adds).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});

it('화면의 기존 로트 번호는 재발급하지 않고 물질·입고일을 저장 경계로 전달한다', async()=>{
  const {deps,updates}=makeDeps();
  deps.items = items.map(row=>({...row,lots:[{id:'old',lotNo:'260913-90',material:'볶음참깨'}]})) as Item[];
  await createOemEngine(deps as any).receiveOemBatch({
    po:{id:'number-boundary',poType:'oem',status:'invoiced',companyId:'taebaek',oemPartnerId:'oem1'} as PurchaseOrder,
    returns:[{itemId:'box20',qty:1}],date:'2026-09-13',
  });
  const lot=updates.find(row=>row.c==='items')!.d.lots[0];
  expect(lot).toMatchObject({material:'볶음참깨',receivedDate:'2026-09-13',qtyIn:1,unitKg:20});
  expect(lot.id).toBe('lot-oem-number-boundary-box20');
  expect(lot.lotNo).toBeUndefined();
});
