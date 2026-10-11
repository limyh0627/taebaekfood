import { expect, it } from 'vitest';
import { commandHash } from '../../shared/rawInventoryCore';
import { type PurchaseOrder } from '../../shared/types';
import { projectOemExternalEvidence, type OemExternalEvidence } from './oemExternalStock';
function fixture() {
 const po={id:'po',companyId:'taebaek',poType:'oem',partnerName:'외주',status:'pending',itemId:'',itemName:'',quantity:0,createdAt:'',oemIssueStatus:'failed',oemIssueDate:'2026-10-12',oemSent:[{rawItemId:'a',material:'참깨',kg:100},{rawItemId:'b',material:'들깨',kg:50}]} as PurchaseOrder;
 const evidence:OemExternalEvidence={po,job:{id:'oem-issue:po',companyId:'taebaek',source:{type:'oem',id:'po'},expectedOperationIds:['oem-issue:po:a','oem-issue:po:b'],status:'failed'},receipts:{},reversals:{},guards:{}};
 for(const row of po.oemSent!){const operationId=`oem-issue:po:${row.rawItemId}`;const command={operationId,companyId:'taebaek' as const,rawItemId:row.rawItemId!,materialSnapshot:row.material,effectiveAt:'2026-10-12T12:00:00+09:00',source:{type:'oem' as const,id:'po'},kind:'consume' as const,kg:row.kg};evidence.receipts[operationId]={...command,commandHash:commandHash(command),reportedDeltaKg:-row.kg,appliedDeltaKg:-row.kg};}
 return {po,evidence};
}
it('실패 상태도 두 원료 영수증을 확인한 만큼만 장부 송출로 표시하고 쓰지 않는다',()=>{
 const {po,evidence}=fixture();const before=JSON.stringify({po,evidence});const result=projectOemExternalEvidence(po,'taebaek',evidence);
 expect(result.state).toBe('confirmed');expect(result.rows.map(r=>r.reportedKg)).toEqual([100,50]);expect(JSON.stringify({po,evidence})).toBe(before);
});
it('부분 성공과 소급 원장만 반영된 줄을 구분한다',()=>{
 const {po,evidence}=fixture();evidence.receipts['oem-issue:po:a']!.appliedDeltaKg=0;delete evidence.receipts['oem-issue:po:b'];
 const result=projectOemExternalEvidence(po,'taebaek',evidence);expect(result.state).toBe('partial');expect(result.rows[0]).toMatchObject({reportedKg:100,appliedKg:0});expect(result.rows[1].reportedKg).toBeUndefined();
});
it.each(['missing-job','foreign-job','source-job','ids','missing-po','changed-po','foreign-receipt','source','hash','reported','applied','raw','operation','kind','unmarked-reversal'])('%s 손상은 전량 확인으로 표시하지 않는다',kind=>{
 const {po,evidence}=fixture();const receipt=evidence.receipts['oem-issue:po:a']!;
 if(kind==='missing-job')evidence.job=null;if(kind==='foreign-job')evidence.job!.companyId='punghoe';if(kind==='source-job')evidence.job!.source.id='other';if(kind==='ids')evidence.job!.expectedOperationIds=[];
 if(kind==='missing-po')evidence.po=null;if(kind==='changed-po')evidence.po={...po,status:'invoiced'};
 if(kind==='foreign-receipt')receipt.companyId='punghoe';if(kind==='source')receipt.source={type:'oem',id:'other'};if(kind==='hash')receipt.commandHash='bad';if(kind==='reported')receipt.reportedDeltaKg=-99;if(kind==='applied')receipt.appliedDeltaKg=NaN;if(kind==='raw')receipt.rawItemId='other';if(kind==='operation')receipt.operationId='other';if(kind==='kind')receipt.kind='ledger-consume';if(kind==='unmarked-reversal')evidence.guards['oem-issue:po:a']={};
 expect(projectOemExternalEvidence(po,'taebaek',evidence).state).not.toBe('confirmed');
});
it.each(['legacy','foreign','normal-purchase','invalid-date','duplicate-raw'])('%s 원문은 추정하지 않는다',kind=>{
 const {po,evidence}=fixture();if(kind==='legacy')po.oemSent![0].rawItemId=undefined;if(kind==='foreign')po.companyId='punghoe';if(kind==='normal-purchase')po.poType=undefined;if(kind==='invalid-date')po.oemIssueDate='2026-02-30';if(kind==='duplicate-raw')po.oemSent![1].rawItemId='a';
 expect(projectOemExternalEvidence(po,'taebaek',evidence).state).toBe('unknown');
});
it('입고완료도 창고 잔량을 계산하지 않고 원송출 확인으로만 분류한다',()=>{
 const {po,evidence}=fixture();po.status='received';const result=projectOemExternalEvidence(po,'taebaek',evidence);expect(result.state).toBe('received');expect(result).not.toHaveProperty('stockKg');
});
it('취소는 원송출·복원 영수증·guard가 모두 일치할 때만 확인한다',()=>{
 const {po,evidence}=fixture();po.oemCancelledAt='2026-10-12T15:00:00Z';po.oemCancelOperationId='oem-cancel:po';
 for(const row of po.oemSent!){const originalOperationId=`oem-issue:po:${row.rawItemId}`,operationId=`oem-cancel:po:${row.rawItemId}`;const command={operationId,companyId:'taebaek' as const,rawItemId:row.rawItemId!,materialSnapshot:row.material,effectiveAt:po.oemCancelledAt,source:{type:'oem' as const,id:'po'},kind:'reverse' as const,originalOperationId};evidence.guards[originalOperationId]={companyId:'taebaek',rawItemId:row.rawItemId,originalOperationId,reverseOperationId:operationId};evidence.reversals[originalOperationId]={...command,commandHash:commandHash(command),reversalOf:originalOperationId,reportedDeltaKg:row.kg,appliedDeltaKg:row.kg};}
 expect(projectOemExternalEvidence(po,'taebaek',evidence).state).toBe('cancelled');evidence.reversals['oem-issue:po:a']!.commandHash='changed';expect(projectOemExternalEvidence(po,'taebaek',evidence).state).toBe('partial');
});
it('취소 반영량은 원송출 반영량의 정확한 반전이어야 한다',()=>{
 const {po,evidence}=fixture();po.oemCancelledAt='2026-10-12T15:00:00Z';po.oemCancelOperationId='oem-cancel:po';
 for(const row of po.oemSent!){const originalOperationId=`oem-issue:po:${row.rawItemId}`,operationId=`oem-cancel:po:${row.rawItemId}`;const command={operationId,companyId:'taebaek' as const,rawItemId:row.rawItemId!,materialSnapshot:row.material,effectiveAt:po.oemCancelledAt,source:{type:'oem' as const,id:'po'},kind:'reverse' as const,originalOperationId};evidence.guards[originalOperationId]={companyId:'taebaek',rawItemId:row.rawItemId,originalOperationId,reverseOperationId:operationId};evidence.reversals[originalOperationId]={...command,commandHash:commandHash(command),reversalOf:originalOperationId,reportedDeltaKg:row.kg,appliedDeltaKg:row.kg};}
 evidence.reversals['oem-issue:po:a']!.appliedDeltaKg=1;expect(projectOemExternalEvidence(po,'taebaek',evidence).state).toBe('partial');
});
