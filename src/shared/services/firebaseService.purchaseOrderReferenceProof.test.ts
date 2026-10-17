import { expect, it } from 'vitest';
import { needsCatalogPurchaseOrderReferenceProof, purchaseOrderReferenceProjection } from '../../../functions/src/shared/catalogOrderReferenceProof';
it('진행 발주의 신규·현재 참조 변경·재개만 검사하고 메모·종결 이력은 차단하지 않는다',()=>{
 const current={status:'pending',itemId:'a',items:[{itemId:'a',quantity:1}]};
 expect(needsCatalogPurchaseOrderReferenceProof(undefined,current)).toBe(true);
 expect(needsCatalogPurchaseOrderReferenceProof(current,{...current,memo:'메모'})).toBe(false);
 expect(needsCatalogPurchaseOrderReferenceProof(current,{...current,items:[{itemId:'b',quantity:1}]})).toBe(true);
 expect(needsCatalogPurchaseOrderReferenceProof({...current,status:'received'},current)).toBe(true);
 expect(needsCatalogPurchaseOrderReferenceProof(current,{...current,status:'received'})).toBe(false);
 expect(needsCatalogPurchaseOrderReferenceProof(undefined,{status:'cancelled',oemIssueStatus:'failed',itemId:'a'})).toBe(false);
 expect(needsCatalogPurchaseOrderReferenceProof(undefined,{status:'received',oemIssueStatus:'processing',itemId:'a'})).toBe(true);
});
it('참조 projection은 업무값과 누락을 보존하고 memo 및 검증메타를 포함하지 않는다',()=>{
 expect(purchaseOrderReferenceProjection({status:'pending',itemId:null,memo:'x',catalogReferenceProofId:'p'})).toEqual({status:'pending',itemId:null});
 expect(purchaseOrderReferenceProjection({status:'pending'})).not.toHaveProperty('itemId');
});
