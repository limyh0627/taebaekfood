/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest';
const mem=vi.hoisted(()=>({store:new Map<string,any>(),commitThenThrow:false,uid:'uid',company:'taebaek',afterCommit:null as null|(()=>void)}));
vi.mock('../firebase',()=>({db:{},authReady:Promise.resolve(),auth:{get currentUser(){return {uid:mem.uid,getIdTokenResult:async()=>({claims:{companyId:mem.company}})};}}}));
vi.mock('firebase/firestore',()=>({
 doc:(_db:any,...paths:string[])=>({path:paths.join('/'),id:paths.at(-1)}),
 runTransaction:async(_db:any,callback:any)=>{
  const writes:any[]=[];let started=false;
  const tx={get:async(ref:any)=>{if(started)throw Error('쓰기 뒤 읽기');const data=mem.store.get(ref.path);return {exists:()=>data!==undefined,data:()=>data};},
   set:(ref:any,data:any)=>{started=true;writes.push([ref.path,data]);},update:(ref:any,data:any)=>{started=true;writes.push([ref.path,{...mem.store.get(ref.path),...data}]);}};
  const result=await callback(tx);for(const [path,data]of writes)mem.store.set(path,data);mem.afterCommit?.();if(mem.commitThenThrow){mem.commitThenThrow=false;throw Error('응답 유실');}return result;
 },
}));
import { executeRawPress, executeRawPressWithDb } from './rawPressService';
import { executeRawInventoryCommand } from './rawInventoryService';
import { operationDocId,inventoryDocId,legacyOperationDocId } from '../rawInventoryCore';
import { readRawPressAttempt, type RawPressRequest } from '../rawPressAttempt';
function request():RawPressRequest{return {version:1,companyId:'taebaek',actorUid:'uid',entry:{id:'press',material:'참깨',date:'2026-10-12',received:0,used:10,note:'메모',type:'manual',createdAt:'2026-10-12T01:00:00Z',effectiveAt:'2026-10-12T01:00:00Z',targetLotId:'source-lot'},yieldRule:{product:'통깨참기름',rate:0.48},sourceCommand:{operationId:'press',companyId:'taebaek',rawItemId:'source',materialSnapshot:'참깨',effectiveAt:'2026-10-12T01:00:00Z',source:{type:'manual',id:'press'},kind:'consume-lot',kg:10,lotId:'source-lot'},derivedCommand:{operationId:'yield:press',companyId:'taebaek',rawItemId:'derived',materialSnapshot:'통깨참기름',effectiveAt:'2026-10-12T01:00:00Z',source:{type:'manual',id:'press'},kind:'receive',kg:4.8,lot:{supplierName:'참깨 압착',qtyIn:0}},sourceLegacy:{note:'메모',type:'manual'},derivedLegacy:{note:'참깨 압착 (수율 48%)',type:'auto'}};}
beforeEach(async()=>{mem.store.clear();localStorage.clear();mem.uid='uid';mem.company='taebaek';mem.commitThenThrow=false;mem.afterCommit=null;
 mem.store.set('items/source',{companyId:'taebaek',name:'참깨',stock:0,lots:[]});mem.store.set('items/derived',{companyId:'taebaek',name:'통깨참기름',stock:0,lots:[]});
 const r=await executeRawInventoryCommand({operationId:'seed',companyId:'taebaek',rawItemId:'source',materialSnapshot:'참깨',effectiveAt:'2026-10-01T01:00:00Z',source:{type:'manual',id:'seed'},kind:'receive',kg:100,lot:{supplierName:'공급'}},{db:{} as any,newLotId:'source-lot'});expect(r.status).toBe('applied');
});
it('원료·기름 두 수불과 job을 같은 TX로 쓰고 재시도는 추가 차감하지 않는다',async()=>{
 expect(await executeRawPress(request())).toMatchObject({status:'applied',sourceAppliedKg:-10,derivedAppliedKg:4.8});
 expect(mem.store.get('items/source').stock).toBe(90);expect(mem.store.get('items/derived').stock).toBe(4.8);expect(readRawPressAttempt('taebaek','uid')).toBeNull();
 const before=structuredClone(mem.store);expect((await executeRawPress(request())).status).toBe('duplicate');expect(mem.store).toEqual(before);
});
it.each(['insufficient','foreign','mirror','legacy'])('%s 거절은 원료·파생·job 모두 쓰지 않는다',async kind=>{
 const r=request();if(kind==='insufficient'){r.entry.used=101;r.sourceCommand.kg=101;r.derivedCommand.kg=48.48;}
 if(kind==='foreign')mem.store.get('items/derived').companyId='punghoe';
 if(kind==='mirror')mem.store.get('items/derived').lots=[{id:'bad',kgRemaining:1}];
 if(kind==='legacy')mem.store.set('rawMaterialLedger/'+operationDocId('press'),{operationId:'press'});
 const before=structuredClone(mem.store);expect((await executeRawPressWithDb({}as any,r)).status).toBe('blocked');expect(mem.store).toEqual(before);
});
it('commit 뒤 응답 유실은 최초 원문으로 두 영수증을 재확인한다',async()=>{
 mem.commitThenThrow=true;await expect(executeRawPress(request())).rejects.toThrow('응답 유실');const saved=readRawPressAttempt('taebaek','uid')!;expect(saved.request.entry.effectiveAt).toBe(request().entry.effectiveAt);
 expect((await executeRawPress(saved.request)).status).toBe('duplicate');expect(mem.store.get('items/source').stock).toBe(90);expect(mem.store.get('items/derived').stock).toBe(4.8);
});
it('신구 receipt가 동시에 있으면 우선 선택하지 않는다',async()=>{
 await executeRawPress(request());const legacy=legacyOperationDocId('press'),current=operationDocId('press');expect(legacy).not.toBe(current);mem.store.set('rawMaterialLedger/'+legacy,mem.store.get('rawMaterialLedger/'+current));const before=structuredClone(mem.store);expect((await executeRawPressWithDb({}as any,request())).status).toBe('blocked');expect(mem.store).toEqual(before);
});
it('최초 저장 실패와 로그인 회사 변경은 TX를 시작하지 않는다',async()=>{
 const before=structuredClone(mem.store);const write=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('저장 실패');});await expect(executeRawPress(request())).rejects.toThrow('저장 실패');write.mockRestore();expect(mem.store).toEqual(before);
 mem.company='punghoe';await expect(executeRawPress(request())).rejects.toThrow('다른 회사');expect(mem.store).toEqual(before);
});
it('파생 앵커 뒤 소급은 원료 정상 사용과 파생 reported양/applied0을 함께 보존한다',async()=>{
 await executeRawInventoryCommand({...request().derivedCommand,operationId:'derived-anchor',kind:'stocktake',targetKg:0,effectiveAt:'2026-10-13T00:00:00Z'},{db:{} as any});
 expect(await executeRawPress(request())).toMatchObject({status:'applied',sourceAppliedKg:-10,derivedAppliedKg:0});expect(mem.store.get('rawMaterialLedger/'+operationDocId('yield:press')).reportedDeltaKg).toBe(4.8);
});
it('원료 소급0은 파생 없음 disposition을 저장하고 재개한다',async()=>{
 await executeRawInventoryCommand({...request().sourceCommand,operationId:'source-anchor',kind:'stocktake',targetKg:100,effectiveAt:'2026-10-13T00:00:00Z'},{db:{} as any});
 expect(await executeRawPress(request())).toMatchObject({status:'applied',sourceAppliedKg:0,derivedAppliedKg:0});expect(mem.store.has('rawMaterialLedger/'+operationDocId('yield:press'))).toBe(false);
 const job=mem.store.get('rawInventoryJobs/raw-press-'+operationDocId('press'));expect(job.derivedDisposition).toBe('source-unapplied');expect((await executeRawPress(request())).status).toBe('duplicate');
});
it.each(['companyId','rawItemId','kind','reportedDeltaKg','appliedDeltaKg','source'])('완료 원영수증 %s 변조는 성공으로 추정하지 않는다',async field=>{
 await executeRawPress(request());const receipt=mem.store.get('rawMaterialLedger/'+operationDocId('press'));
 receipt[field]=field==='source'?{type:'manual',id:'다른 원문'}:field.endsWith('Kg')?123:'잘못된 값';
 const before=structuredClone(mem.store);expect(await executeRawPressWithDb({}as any,request())).toMatchObject({status:'blocked',retainPending:true});expect(mem.store).toEqual(before);
});
it('쓰기0가 확정된 신규 거절은 첫 원문을 정리하고 수정 입력을 허용한다',async()=>{
 const r=request();r.entry.used=101;r.sourceCommand.kg=101;r.derivedCommand.kg=48.48;
 expect(await executeRawPress(r)).toMatchObject({status:'blocked',retainPending:false});expect(readRawPressAttempt('taebaek','uid')).toBeNull();expect((await executeRawPress(request())).status).toBe('applied');
});
it.each(['uid','company'] as const)('commit 응답 경계 %s 변경은 최초 pending을 정리하지 않는다',async field=>{
 mem.afterCommit=()=>{mem[field]=field==='uid'?'다른 계정':'punghoe';};await expect(executeRawPress(request())).rejects.toThrow();expect(readRawPressAttempt('taebaek','uid')!.request).toEqual(request());expect(mem.store.get('items/source').stock).toBe(90);
 mem.afterCommit=null;mem.uid='uid';mem.company='taebaek';expect((await executeRawPress(request())).status).toBe('duplicate');expect(readRawPressAttempt('taebaek','uid')).toBeNull();
});
it('job 출처·예상 명령이 손상되면 두 완료표가 있어도 그대로 보존한다',async()=>{
 await executeRawPress(request());mem.store.get('rawInventoryJobs/raw-press-'+operationDocId('press')).expectedOperationIds=['press'];const before=structuredClone(mem.store);expect((await executeRawPressWithDb({}as any,request())).status).toBe('blocked');expect(mem.store).toEqual(before);
});
it('품목 표시명 변경은 raw ID로 확정된 최초 명령 재개를 막지 않는다',async()=>{await executeRawPress(request());mem.store.get('rawMaterialLedger/'+operationDocId('press')).materialSnapshot='바뀐 표시명';mem.store.get('items/source').name='바뀐 표시명';expect((await executeRawPressWithDb({}as any,request())).status).toBe('duplicate');});
it('원소모0인데 파생 영수증까지 있는 손상 pair는 성공으로 확정하지 않는다',async()=>{await executeRawPress(request());const job=mem.store.get('rawInventoryJobs/raw-press-'+operationDocId('press'));job.sourceAppliedKg=0;mem.store.get('rawMaterialLedger/'+operationDocId('press')).appliedDeltaKg=0;const before=structuredClone(mem.store);expect((await executeRawPressWithDb({}as any,request())).status).toBe('blocked');expect(mem.store).toEqual(before);});
