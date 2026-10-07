import { afterEach, describe, expect, it } from 'vitest';
import {buildBomIndex,getBomIndex,setBomIndex} from '../../shared/bomIndex';
import {buildPackIndex} from '../../shared/packIndex';
import type { Item, PurchaseOrder } from '../../shared/types';
import { reconcileOemBatch } from './oemReconciliation';

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
