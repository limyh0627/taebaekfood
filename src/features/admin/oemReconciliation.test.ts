import {buildOemBatchCostPreview,finalizeOemBatchCost,type OemBatchCost,type OemCostEvidence} from '../../shared/oemBatchCost';
import { afterEach, describe, expect, it } from 'vitest';
import {buildBomIndex,getBomIndex,setBomIndex} from '../../shared/bomIndex';
import {buildPackIndex} from '../../shared/packIndex';
import type { Item, PurchaseOrder } from '../../shared/types';
import { inspectStoredOemCostDisplay, reconcileOemBatch } from './oemReconciliation';

const po = (patch: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 'po', companyId: 'taebaek', itemId: '', itemName: '', quantity: 0, createdAt: '',
  poType: 'oem', status: 'received', oemSent: [{ material: '참깨', kg: 100 }], ...patch,
});
const product = { id: 'item', companyId: 'taebaek', name: '볶음참깨', spec: '1kg', unit: '개' } as Item;
const originalBom=getBomIndex();
afterEach(()=>setBomIndex(originalBom));
it('명시 회사 입력은 다른 전역 BOM과 독립적이고 생략하면 기존 전역 동작을 유지한다',()=>{
 const products=[{...product,spec:'1kg * 20',type:'product'}, {...product,id:'loose',type:'product'}] as Item[];
 const inputs={bom:buildBomIndex(products,[{parent_id:'item',child_id:'loose',quantity:20}]),pack:buildPackIndex()};
 const other=buildBomIndex(products,[]);setBomIndex(other);
 const batch=po({items:[{itemId:'item',name:'볶음참깨',quantity:1,unit:'개'}],oemReceiptOperationId:'receipt',oemReceivedKg:20});
 expect(reconcileOemBatch(batch,products,'taebaek',inputs)?.products[0].kg).toBe(20);
 expect(reconcileOemBatch(batch,products,'taebaek')?.products[0].kg).toBe(1);
 expect(reconcileOemBatch(batch,products,'punghoe',inputs)).toBeUndefined();
 expect(getBomIndex()).toBe(other);
});

describe('reconcileOemBatch', () => {
  it('제품·벌크 회수와 미해결 차이를 분리하고 손실을 확정하지 않는다', () => {
    const result = reconcileOemBatch(po({ items: [{ itemId: 'item', name: '볶음참깨', quantity: 70, unit: '개' }],
      oemReceivedBulk: [{ material: '참깨', kg: 20 }], oemReceivedKg: 90 }), [product], 'taebaek')!;
    expect(result.materials[0]).toMatchObject({ kg: 100, returnedBulkKg: 20, unresolvedKg: 80 });
    expect(result.unallocatedProductKg).toBe(70);
    expect(result.unresolvedBatchKg).toBe(10);
    expect(result.materials[0].confirmedLossKg).toBeUndefined();
    expect(result.feeStatus).toBe('unissued');
  });
  it('다종 원료의 제품 중량을 원료별로 배분하지 않는다', () => {
    const result = reconcileOemBatch(po({ oemSent: [{ material: '참깨', kg: 80 }, { material: '들깨', kg: 20 }],
      items: [{ itemId: 'item', name: '볶음참깨', quantity: 90, unit: '개' }] }), [product], 'taebaek')!;
    expect(result.unresolvedBatchKg).toBeUndefined();
    expect(result.issues).toContain('다중 원료 제품 귀속 불명');
  });
  it('단위 불명·회사 경계·가공비 연결을 구별한다', () => {
    expect(reconcileOemBatch(po(), [product], 'punghoe')).toBeUndefined();
    const result = reconcileOemBatch(po({ items: [{ itemId: 'missing', name: '', quantity: 1, unit: '개' }],
      linkedStatementId: 'fee' }), [product], 'taebaek')!;
    expect(result.issues).toContain('제품 단위 환산 불명: missing (missing)');
    expect(result.unresolvedBatchKg).toBeUndefined();
    expect(result.feeStatus).toBe('linked');
  });
  it('회수 전과 구형 회수 세부 누락은 차이를 계산하지 않는다', () => {
    expect(reconcileOemBatch(po({ status: 'invoiced' }), [product], 'taebaek')!.unresolvedBatchKg).toBeUndefined();
    const old = reconcileOemBatch(po({ oemReceivedKg: 90 }), [product], 'taebaek')!;
    expect(old.unresolvedBatchKg).toBeUndefined();
    expect(old.issues).toContain('회수 세부 기록 없음');
  });
  it('같은 원료 송출 여러 줄에 벌크 회수를 한 번만 차감한다', () => {
    const result = reconcileOemBatch(po({ oemSent: [{ material: '참깨', kg: 60 }, { material: '참깨', kg: 40 }],
      oemReceivedBulk: [{ material: '참깨', kg: 20 }] }), [product], 'taebaek')!;
    expect(result.materials).toMatchObject([{ material: '참깨', kg: 100, returnedBulkKg: 20, unresolvedKg: 80 }]);
  });
  it('구형 무벌크 자료와 새 입고의 무벌크 0을 구별한다', () => {
    const old = reconcileOemBatch(po({ items: [{ itemId: 'item', name: '', quantity: 90, unit: '개' }], oemReceivedKg: 90 }), [product], 'taebaek')!;
    expect(old.materials[0].returnedBulkKg).toBeUndefined();
    expect(old.unresolvedBatchKg).toBeUndefined();
    const current = reconcileOemBatch(po({ items: [{ itemId: 'item', name: '', quantity: 90, unit: '개' }], oemReceivedKg: 90,
      oemReceiptOperationId: 'oem-receive:po' }), [product], 'taebaek')!;
    expect(current.materials[0].returnedBulkKg).toBe(0);
    expect(current.unresolvedBatchKg).toBe(10);
  });
  it('구형 총회수 90kg과 제품 70kg 차이는 벌크 미상으로 두고 새 무벌크는 불일치로 표시한다', () => {
    const lines = [{ itemId: 'item', name: '', quantity: 70, unit: '개' }];
    const old = reconcileOemBatch(po({ items: lines, oemReceivedKg: 90 }), [product], 'taebaek')!;
    expect(old.issues).toContain('벌크 회수 자료 없음');
    expect(old.issues).not.toContain('저장된 회수 중량과 제품·벌크 단위 불일치');
    const current = reconcileOemBatch(po({ items: lines, oemReceivedKg: 90, oemReceiptOperationId: 'oem-receive:po' }), [product], 'taebaek')!;
    expect(current.issues).toContain('저장된 회수 중량과 제품·벌크 단위 불일치');
  });
  it('입고 기록명을 우선하고 현재 품목·ID를 안전한 대체값으로 쓴다', () => {
    const result = reconcileOemBatch(po({ items: [
      { itemId: 'item', name: '입고 당시 이름', quantity: 1, unit: '개' },
      { itemId: 'missing', name: '', quantity: 1, unit: '개' },
    ] }), [product], 'taebaek')!;
    expect(result.products.map(row => [row.name, row.itemId])).toEqual([['입고 당시 이름', 'item'], ['missing', 'missing']]);
  });
});

const confirmedEvidence:OemCostEvidence={version:1,ownerCompanyId:'taebaek',rawMaterials:[{rawItemId:'raw',kg:100,supplyAmount:100000}],packaging:{confirmed:true,supplyAmount:0},capturedAt:'2026-10-12T00:00:00Z'};
function confirmedBatch(){return po({oemCostEvidence:confirmedEvidence,oemBatchCost:buildOemBatchCostPreview(confirmedEvidence,{companyId:'taebaek',sent:[{rawItemId:'raw',kg:100}]},[{itemId:'item',kg:20}]),oemReceivedKg:20,oemReceiptOperationId:'receipt',items:[{itemId:'item',name:'입고 당시 제품',quantity:2,unit:'개'}]});}
it('확인 배치는 현재 규격/BOM/품목 존재와 무관하게 저장 원입고 kg를 유지한다',()=>{
 const batch=confirmedBatch(),changed={...product,spec:'25kg'};const before=JSON.stringify(batch);
 const result=reconcileOemBatch(batch,[changed],'taebaek')!;expect(result.productWeightBasis).toBe('saved-receipt');expect(result.products[0].kg).toBe(20);expect(result.unresolvedBatchKg).toBe(80);expect(result.issues).not.toContain('저장된 회수 중량과 제품·벌크 단위 불일치');
 expect(reconcileOemBatch(batch,[],'taebaek')?.products[0].kg).toBe(20);expect(reconcileOemBatch(batch,[changed],'punghoe')).toBeUndefined();expect(JSON.stringify(batch)).toBe(before);
});
it.each(['missing','sum','duplicate','quantity'])('확인 원입고 %s 손상은 현재 환산으로 대체하지 않는다',kind=>{
 const batch=confirmedBatch();if(kind==='missing')batch.oemBatchCost=undefined;if(kind==='sum')batch.oemReceivedKg=21;if(kind==='duplicate')batch.items=[...batch.items!,...batch.items!];if(kind==='quantity')batch.items![0].quantity=0;
 const result=reconcileOemBatch(batch,[{...product,spec:'25kg'}],'taebaek')!;expect(result.productWeightBasis).toBe('unconfirmed');expect(result.issues).toContain('저장된 원입고 중량 근거 미확인');expect(result.products.every(row=>row.kg===undefined)).toBe(true);expect(result.unresolvedBatchKg).toBeUndefined();
});
it('다른 회사 원가 근거를 현재 회사 저장 중량으로 표시하지 않는다',()=>{
 const batch=confirmedBatch();batch.oemCostEvidence={...confirmedEvidence,ownerCompanyId:'punghoe'};const result=reconcileOemBatch(batch,[product],'taebaek')!;expect(result.productWeightBasis).toBe('unconfirmed');expect(result.unallocatedProductKg).toBeUndefined();expect(result.issues).toContain('저장된 원입고 중량 근거 미확인');
});

function storedCostBatch() {
  const sent = [{ rawItemId: 'raw', material: '참깨', kg: 100 }];
  const preview = buildOemBatchCostPreview(confirmedEvidence, { companyId: 'taebaek', sent }, [{ itemId: 'a', kg: 7 }, { itemId: 'b', kg: 13 }]);
  if (preview.status !== 'pending-fee') throw new Error('시험 원가 근거 오류');
  const cost = finalizeOemBatchCost(preview, { statementId: 'OEMFEE-po', feeSupplyAmount: 2001 });
  const order = po({ oemSent: sent, oemCostEvidence: confirmedEvidence, oemBatchCost: cost, linkedStatementId: cost.feeStatementId,
    oemReceivedKg: 20, oemReceiptOperationId: 'oem-receive:po', items: [
      { itemId: 'a', name: '입고 A', quantity: 1, unit: '개' }, { itemId: 'b', name: '입고 B', quantity: 2, unit: '개' },
    ] });
  return { order, cost, preview };
}
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, row]) => [key, reverseKeys(row)]));
}

describe('저장 OEM 원가의 조회용 내부 일치 판독', () => {
  it('공용 계산으로 확정된 정상 숫자를 보존하고 입력 객체는 바꾸지 않는다', () => {
    const { order, cost } = storedCostBatch();
    const before = JSON.stringify(order);
    expect(inspectStoredOemCostDisplay(order, 'taebaek')).toEqual({ status: 'confirmed', cost });
    expect(JSON.stringify(order)).toBe(before);
  });
  it('가공비 대기 근거도 공용 preview와 일치할 때만 표시한다', () => {
    const { order, preview } = storedCostBatch();
    order.oemBatchCost = preview; delete order.linkedStatementId;
    expect(inspectStoredOemCostDisplay(order, 'taebaek')).toEqual({ status: 'pending-fee', cost: preview });
    order.linkedStatementId = 'OEMFEE-po';
    expect(inspectStoredOemCostDisplay(order, 'taebaek').status).toBe('unconfirmed');
  });
  it('중첩 객체의 키 순서 차이는 Firestore 저장값으로 허용한다', () => {
    const { order } = storedCostBatch();
    const reordered = reverseKeys(order) as PurchaseOrder;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(order));
    expect(inspectStoredOemCostDisplay(reordered, 'taebaek').status).toBe('confirmed');
  });
  const invalid: Array<[string, (order: PurchaseOrder, cost: OemBatchCost) => void]> = [
    ['다른 PO 회사', order => { order.companyId = 'punghoe'; }],
    ['다른 원가 소유회사', (_, cost) => { cost.ownerCompanyId = 'punghoe'; }],
    ['다른 원가 snapshot 회사', (_, cost) => { cost.evidenceSnapshot = { ...cost.evidenceSnapshot, ownerCompanyId: 'punghoe' }; }],
    ['다른 현재 원가 근거 회사', order => { order.oemCostEvidence = { ...confirmedEvidence, ownerCompanyId: 'punghoe' }; }],
    ['현재 원가 근거 없음', order => { delete order.oemCostEvidence; }],
    ['발주 상태', order => { order.status = 'invoiced'; }],
    ['입고 취소 상태', order => { order.status = 'cancelled'; }],
    ['OEM 취소 기록', order => { order.oemCancelledAt = '2026-10-12T00:00:00Z'; }],
    ['OEM 취소 명령', order => { order.oemCancelOperationId = 'oem-cancel:po'; }],
    ['원료 kg 변경', order => { order.oemSent = [{ material: '참깨', rawItemId: 'raw', kg: 99 }]; }],
    ['원가 snapshot 금액 변경', (_, cost) => { cost.evidenceSnapshot = { ...cost.evidenceSnapshot, packaging: { confirmed: true, supplyAmount: 1 } }; }],
    ['입고 총 kg 변경', order => { order.oemReceivedKg = 21; }],
    ['원입고 중복 품목', order => { order.items = [order.items![0], order.items![0]]; }],
    ['원입고 0수량', order => { order.items![0].quantity = 0; }],
    ['원입고 음수 수량', order => { order.items![0].quantity = -1; }],
    ['원입고 무한 수량', order => { order.items![0].quantity = Infinity; }],
    ['가공비 연결 없음', order => { delete order.linkedStatementId; }],
    ['다른 가공비 연결', order => { order.linkedStatementId = 'other-fee'; }],
    ['가공비 ID 없음', (_, cost) => { cost.feeStatementId = ''; }],
    ['원료 합계 변경', (_, cost) => { cost.rawSupplyAmount += 1; }],
    ['부자재 합계 변경', (_, cost) => { cost.packagingSupplyAmount += 1; }],
    ['송출 합계 변경', (_, cost) => { cost.sentKg += 1; }],
    ['손실 변경', (_, cost) => { cost.lossKg -= 1; }],
    ['저장 회수 합계 변경', (_, cost) => { cost.receivedKg += 1; }],
    ['가공비 공급액 변경', (_, cost) => { cost.feeSupplyAmount += 1; }],
    ['총 공급원가 변경', (_, cost) => { cost.totalSupplyAmount += 1; }],
    ['원가 단가 변경', (_, cost) => { cost.costPerKg += 1; }],
    ['단가 NaN', (_, cost) => { cost.costPerKg = NaN; }],
    ['금액 Infinity', (_, cost) => { cost.totalSupplyAmount = Infinity; }],
    ['원가 배분 변경', (_, cost) => { cost.allocations[0].supplyAmount += 1; }],
    ['행 단가 변경', (_, cost) => { cost.allocations[0].costPerKg += 1; }],
    ['입고 행 kg 변경', (_, cost) => { cost.rows[0].kg += 1; }],
    ['배분 배열 순서 변경', (_, cost) => { cost.allocations.reverse(); }],
    ['원입고 배열 순서 변경', (_, cost) => { cost.rows.reverse(); }],
  ];
  it.each(invalid)('%s는 확정 숫자를 반환하지 않는다', (_, change) => {
    const { order, cost } = storedCostBatch();
    change(order, cost);
    expect(inspectStoredOemCostDisplay(order, 'taebaek')).toMatchObject({ status: 'unconfirmed' });
    expect(inspectStoredOemCostDisplay(order, 'taebaek')).not.toHaveProperty('cost');
  });
  it('현재 회사와 다른 PO는 동일 snapshot을 갖고 있어도 확정하지 않는다', () => {
    expect(inspectStoredOemCostDisplay(storedCostBatch().order, 'punghoe').status).toBe('unconfirmed');
  });
  it.each(['fee-changed', 'fee-deleted', 'yield-unconfirmed', 'missing-evidence'] as const)('blocked %s의 이전 확정 숫자를 재사용하지 않는다', reason => {
    const { order, cost } = storedCostBatch();
    order.oemBatchCost = { ...cost, status: 'blocked', reason, previousConfirmed: cost };
    const result = inspectStoredOemCostDisplay(order, 'taebaek');
    expect(result.status).toBe('unconfirmed');
    expect(result).not.toHaveProperty('cost');
  });
  it('양수 PO 수량 변경만으로 원래 수량이 실증되는 판독이라고 주장하지 않는다', () => {
    const { order } = storedCostBatch();
    order.items![0].quantity = 99;
    // 원 영수증·실제 로트를 읽지 않는 PO-only 판독의 의도된 한계다.
    expect(inspectStoredOemCostDisplay(order, 'taebaek').status).toBe('confirmed');
  });
});
