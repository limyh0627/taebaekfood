import { expect, it } from 'vitest';
import { planAdvanceApplication, planAdvanceCancellation } from './shared/partnerAdvance';
import { semanticHash, statementBusiness } from './shared/partnerAdvanceReceipt';
import { projectClaimsAfterAdvance } from './partnerAdvanceClaimReader';
const fixture=()=>{
 const source={collection:'cashEntries' as const,id:'source',lineKey:'133'};
 const purpose=JSON.stringify([JSON.stringify([source.collection,source.id,source.lineKey]),'invoice']);
 const command={expectedSourceFingerprint:'source',expectedTargetFingerprint:'target',operationId:'op',partnerId:'partner',date:'2026-10-08',source,statementId:'invoice',accountCode:'251' as const,amount:30,expectedRevision:1,releaseId:'release'};
 const planned=planAdvanceApplication({companyId:'taebaek',partnerId:'partner',complete:true,unattributedReduction:false,blockedSourceKeys:[],priorSourceUse:new Map(),
  sources:[{key:source,companyId:'taebaek',partnerId:'partner',code:'133',originalAmount:100,date:command.date,fingerprint:'source',purpose}],
  targets:[{statementId:'invoice',companyId:'taebaek',partnerId:'partner',accountCode:'251',remaining:100,date:command.date,fingerprint:'target',purpose}]},
  {operationId:'op',date:command.date,purpose,allocations:[{source,statementId:'invoice',accountCode:'251',amount:30}]});
 const requestHash=semanticHash({companyId:'taebaek',actorId:'auth',action:'apply',command});
 const row:any={id:'application',companyId:'taebaek',partnerId:'partner',type:'비용',tradeDate:command.date,
  items:planned.items,totalAmount:30,noncashApplication:planned.metadata,issueOperationId:'op',issuePayloadHash:requestHash,
  createdBy:'auth',docNo:'대체261008-001',issuePrefix:'대체'};
 row.issueStatementHash=semanticHash(statementBusiness(row));
 const operation:any={id:'op',companyId:'taebaek',partnerId:'partner',createdBy:'auth',status:'applied',action:'apply',command,
  commandHash:semanticHash(command),requestHash,statementId:'application',statementHash:row.issueStatementHash,
  docNo:row.docNo,issuePrefix:'대체',source,targetStatementId:'invoice',amount:30};
 const claims=[{id:'invoice',companyId:'taebaek',partnerId:'partner',tradeDate:command.date,accountCode:'251' as const,amount:80}];
 return {row,operation,claims};
};
it('검증된 적용은 반품 후 미결에서 한 번 차감하며 원문을 바꾸지 않는다',()=>{
 const f=fixture(),before=JSON.stringify(f);
 expect(projectClaimsAfterAdvance(f.claims,[f.row],[f.operation])[0].amount).toBe(50);
 expect(JSON.stringify(f)).toBe(before);
});
it.each(['missing','actor','company','command','number','status','hash','source','sourceFingerprint','targetFingerprint','purpose'])('%s 감사 변조는 미결을 추정하지 않고 거절한다',what=>{
 const f=fixture();
 if(what==='actor')f.operation.createdBy='foreign';
 if(what==='company')f.operation.companyId='punghoe';
 if(what==='command')f.operation.command.amount=31;
 if(what==='number')f.operation.docNo='대체261008-002';
 if(what==='status')f.operation.status='rejected';
 if(what==='hash')f.operation.statementHash='bad';
 if(what==='source')f.operation.source={...f.operation.source,id:'other'};
 if(what==='sourceFingerprint'||what==='targetFingerprint'){f.operation.command[what==='sourceFingerprint'?'expectedSourceFingerprint':'expectedTargetFingerprint']='changed';f.operation.commandHash=semanticHash(f.operation.command);f.operation.requestHash=semanticHash({companyId:'taebaek',actorId:'auth',action:'apply',command:f.operation.command});f.row.issuePayloadHash=f.operation.requestHash;}
 if(what==='purpose'){f.row.noncashApplication.purpose='wrong pair';f.row.issueStatementHash=semanticHash(statementBusiness(f.row));f.operation.statementHash=f.row.issueStatementHash;}
 expect(()=>projectClaimsAfterAdvance(f.claims,[f.row],what==='missing'?[]:[f.operation])).toThrow();
});
it('metadata 없는 기존 채무는 동일하게 유지한다',()=>{
 const f=fixture();expect(projectClaimsAfterAdvance(f.claims,[],[])).toEqual(f.claims);
});
it.each([false,true])('취소 원천 감사 변조=%s이면 잔량을 부당 복구하지 않는다',tampered=>{
 const f=fixture(),command={operationId:'cancel',partnerId:'partner',date:'2026-10-08',applicationStatementId:'application',reason:'  사용자 취소  ',expectedRevision:2,releaseId:'release'};
 const plan=planAdvanceCancellation(f.row,'cancel',command.reason);
 const requestHash=semanticHash({companyId:'taebaek',actorId:'auth',action:'cancel',command});
 const row:any={...f.row,id:'cancellation',items:plan.items,noncashApplication:plan.metadata,issueOperationId:'cancel',issuePayloadHash:requestHash,docNo:'대체261008-002'};
 row.issueStatementHash=semanticHash(statementBusiness(row));
 const operation={...f.operation,id:'cancel',action:'cancel',command,commandHash:semanticHash(command),requestHash,
  statementId:row.id,statementHash:row.issueStatementHash,docNo:row.docNo,applicationStatementId:'application',
  source:tampered?{...f.operation.source,id:'different'}:f.operation.source};
 const project=()=>projectClaimsAfterAdvance(f.claims,[f.row,row],[f.operation,operation]);
 if(tampered)expect(project).toThrow('원천');else expect(project()[0].amount).toBe(80);
});
