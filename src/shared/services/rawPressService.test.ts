/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest';
const mem=vi.hoisted(()=>({store:new Map<string,any>(),commitThenThrow:false,uid:'uid',company:'taebaek',afterCommit:null as null|(()=>void)}));
vi.mock('../firebase',()=>({db:{},authReady:Promise.resolve(),auth:{get currentUser(){return {uid:mem.uid,getIdTokenResult:async()=>({claims:{companyId:mem.company}})};}}}));
vi.mock('firebase/firestore',()=>({
 doc:(_db:any,...paths:string[])=>({path:paths.join('/'),id:paths.at(-1)}),
 getDocFromServer:async(ref:any)=>{const data=mem.store.get(ref.path);return {exists:()=>data!==undefined,data:()=>data};},
 runTransaction:async(_db:any,callback:any)=>{
  const writes:any[]=[];let started=false;
  const tx={get:async(ref:any)=>{if(started)throw Error('쓰기 뒤 읽기');const data=mem.store.get(ref.path);return {exists:()=>data!==undefined,data:()=>data};},
   set:(ref:any,data:any)=>{started=true;writes.push([ref.path,data]);},update:(ref:any,data:any)=>{started=true;writes.push([ref.path,{...mem.store.get(ref.path),...data}]);}};
  const result=await callback(tx);for(const [path,data]of writes)mem.store.set(path,data);mem.afterCommit?.();if(mem.commitThenThrow){mem.commitThenThrow=false;throw Error('응답 유실');}return result;
 },
}));
import { executeRawPress, executeRawPressWithDb, executeRawPressCancellation, executeRawPressCancellationWithDb } from './rawPressService';
import { executeRawInventoryCommand } from './rawInventoryService';
import { operationDocId,inventoryDocId,legacyOperationDocId } from '../rawInventoryCore';
import { makeRawPressCancellationRequest,readRawPressCancellationAttempt,readRawPressAttempt, type RawPressRequest } from '../rawPressAttempt';
import {beginNewRawPressAttempt,submitRawPressAttempt,listRawPressAttempts} from '../rawPressAttempt';
function request():RawPressRequest{return {version:1,companyId:'taebaek',actorUid:'uid',entry:{id:'press',material:'참깨',date:'2026-10-12',received:0,used:10,note:'메모',type:'manual',createdAt:'2026-10-12T01:00:00Z',effectiveAt:'2026-10-12T01:00:00Z',targetLotId:'source-lot'},yieldRule:{product:'통깨참기름',rate:0.48},sourceCommand:{operationId:'press',companyId:'taebaek',rawItemId:'source',materialSnapshot:'참깨',effectiveAt:'2026-10-12T01:00:00Z',source:{type:'manual',id:'press'},kind:'consume-lot',kg:10,lotId:'source-lot'},derivedCommand:{operationId:'yield:press',companyId:'taebaek',rawItemId:'derived',materialSnapshot:'통깨참기름',effectiveAt:'2026-10-12T01:00:00Z',source:{type:'manual',id:'press'},kind:'receive',kg:4.8,lot:{supplierName:'참깨 압착',qtyIn:0}},sourceLegacy:{note:'메모',type:'manual'},derivedLegacy:{note:'참깨 압착 (수율 48%)',type:'auto'}};}
it('명시 선택한 submitted 요청의 조회0은 원료·파생 재적용 없이 원문을 유지한다',async()=>{
 vi.stubGlobal('navigator',{locks:{request:async(_key:string,_opts:any,work:any)=>work()}});
 const retained=await submitRawPressAttempt(await beginNewRawPressAttempt(request(),()=>true),()=>true),before=structuredClone(mem.store);
 expect(await executeRawPress(retained.request,{retained,isCurrent:()=>true})).toMatchObject({status:'blocked',retainPending:true});expect(mem.store).toEqual(before);expect(listRawPressAttempts('taebaek','uid')).toHaveLength(1);
});
it('명시 선택한 최초 압착은 한 번만 적용하고 응답 유실 재조회로 완료한다',async()=>{
 vi.stubGlobal('navigator',{locks:{request:async(_key:string,_opts:any,work:any)=>work()}});
 const retained=await beginNewRawPressAttempt(request(),()=>true);mem.commitThenThrow=true;
 await expect(executeRawPress(retained.request,{retained,isCurrent:()=>true})).rejects.toThrow('응답 유실');
 const stored=listRawPressAttempts('taebaek','uid')[0].retained!;expect(stored.state).toBe('submitted');expect((await executeRawPress(stored.request,{retained:stored,isCurrent:()=>true})).status).toBe('duplicate');expect(mem.store.get('items/source').stock).toBe(90);expect(listRawPressAttempts('taebaek','uid')).toHaveLength(0);
});
it('현대 압착 commit 후 같은 회사 UID가 바뀌면 ACK 정리 없이 submitted 원문을 보존한다',async()=>{
 vi.stubGlobal('navigator',{locks:{request:async(_key:string,_opts:any,work:any)=>work()}});
 const retained=await beginNewRawPressAttempt(request(),()=>true);mem.afterCommit=()=>{mem.uid='other';};
 await expect(executeRawPress(retained.request,{retained,isCurrent:()=>mem.uid==='uid'})).rejects.toThrow('계정');
 expect(listRawPressAttempts('taebaek','uid')[0].retained?.state).toBe('submitted');expect(mem.store.get('items/source').stock).toBe(90);
 mem.uid='uid';mem.afterCommit=null;const saved=listRawPressAttempts('taebaek','uid')[0].retained!;
 expect((await executeRawPress(saved.request,{retained:saved,isCurrent:()=>true})).status).toBe('duplicate');expect(mem.store.get('items/source').stock).toBe(90);
});
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
const cancellationInput=()=>({companyId:'taebaek' as const,actorUid:mem.uid,originalOperationId:'press'});
it('압착 취소는 원료 로트 복원과 파생 입고 제거·두 guard·완료표를 함께 저장한다',async()=>{
 await executeRawPress(request());expect((await executeRawPressCancellation(cancellationInput())).status).toBe('cancelled');expect(mem.store.get('items/source').stock).toBe(100);expect(mem.store.get('items/derived').stock).toBe(0);expect(readRawPressCancellationAttempt('taebaek','uid','press')).toBeNull();const before=structuredClone(mem.store);expect((await executeRawPressCancellation(cancellationInput())).status).toBe('already-cancelled');expect(mem.store).toEqual(before);expect(await executeRawPress(request())).toMatchObject({status:'cancelled'});expect(mem.store).toEqual(before);expect(readRawPressAttempt('taebaek','uid')).toBeNull();
});
it('취소 commit 응답 유실은 최초 ID와 시각으로 재개하고 추가 복원하지 않는다',async()=>{await executeRawPress(request());mem.commitThenThrow=true;await expect(executeRawPressCancellation(cancellationInput())).rejects.toThrow('응답 유실');const pending=readRawPressCancellationAttempt('taebaek','uid','press')!;const before=structuredClone(mem.store);expect((await executeRawPressCancellation(cancellationInput())).status).toBe('duplicate');expect(mem.store).toEqual(before);expect(readRawPressCancellationAttempt('taebaek','uid','press')).toBeNull();expect(pending.request.effectiveAt).toBe(pending.request.sourceReverse.effectiveAt);});
it('이미 사용한 파생 로트는 원료 복원도 쓰지 않고 확정 거절 pending을 정리한다',async()=>{await executeRawPress(request());await executeRawInventoryCommand({...request().derivedCommand,operationId:'oil-use',source:{type:'manual',id:'oil-use'},kind:'consume',kg:1},{db:{}as any});const before=structuredClone(mem.store);expect(await executeRawPressCancellation(cancellationInput())).toMatchObject({status:'blocked',retainPending:false});expect(mem.store).toEqual(before);expect(readRawPressCancellationAttempt('taebaek','uid','press')).toBeNull();});
it('과거 source만 취소한 pair는 자동으로 파생 취소를 보완하지 않는다',async()=>{await executeRawPress(request());const cancel=makeRawPressCancellationRequest(request(),'uid','old-cancel','2026-10-13T00:00:00Z');await executeRawInventoryCommand(cancel.sourceReverse,{db:{}as any});const before=structuredClone(mem.store);expect(await executeRawPressCancellation(cancellationInput())).toMatchObject({status:'blocked',retainPending:true});expect(mem.store).toEqual(before);});
it('새 취소 행동자는 원 작성자와 달라도 같은 회사면 취소하며 완료 증거를 덮지 않는다',async()=>{await executeRawPress(request());mem.uid='other-admin';expect((await executeRawPressCancellation(cancellationInput())).status).toBe('cancelled');const job=mem.store.get('rawInventoryJobs/raw-press-'+operationDocId('press'));expect(job.actorUid).toBe('uid');expect(job.cancellation.actorUid).toBe('other-admin');const before=structuredClone(mem.store);mem.uid='uid';expect((await executeRawPressCancellation(cancellationInput())).status).toBe('already-cancelled');expect(mem.store).toEqual(before);});
it.each(['source','derived'] as const)('%s 소급0의 취소도 기존 core 결과와 pair 완료 근거를 보존한다',async side=>{const command=side==='source'?request().sourceCommand:request().derivedCommand;await executeRawInventoryCommand({...command,kind:'stocktake',operationId:'anchor',targetKg:side==='source'?100:0,effectiveAt:'2026-10-13T00:00:00Z'},{db:{}as any});await executeRawPress(request());expect((await executeRawPressCancellation(cancellationInput())).status).toBe('cancelled');expect(mem.store.get('items/source').stock).toBe(100);expect(mem.store.get('items/derived').stock).toBe(0);expect((await executeRawPress(request())).status).toBe('cancelled');});
it('손상 취소 flag와 양쪽 원영수증 중복은 완료라고 추정하지 않는다',async()=>{await executeRawPress(request());await executeRawPressCancellation(cancellationInput());mem.store.get('rawInventoryJobs/raw-press-'+operationDocId('press')).cancellation.sourceAppliedKg=9;const before=structuredClone(mem.store);expect((await executeRawPress(request())).status).toBe('blocked');expect((await executeRawPressCancellation(cancellationInput())).status).toBe('blocked');expect(mem.store).toEqual(before);});
it('job가 없는 기록만 legacy로 돌려주고 손상 job는 fallback하지 않는다',async()=>{expect((await executeRawPressCancellation(cancellationInput())).status).toBe('legacy');mem.store.set('rawInventoryJobs/raw-press-'+operationDocId('press'),{});expect((await executeRawPressCancellation(cancellationInput())).status).toBe('blocked');});
it('취소 최초 저장 실패는 TX 쓰기0이며 성공 뒤 정리 실패는 같은 원문으로 확인한다',async()=>{await executeRawPress(request());const before=structuredClone(mem.store);const set=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('취소 저장 실패');});await expect(executeRawPressCancellation(cancellationInput())).rejects.toThrow('취소 저장 실패');set.mockRestore();expect(mem.store).toEqual(before);const remove=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw Error('정리 실패');});await expect(executeRawPressCancellation(cancellationInput())).rejects.toThrow('정리 실패');remove.mockRestore();expect(readRawPressCancellationAttempt('taebaek','uid','press')).not.toBeNull();expect((await executeRawPressCancellation(cancellationInput())).status).toBe('duplicate');});
it.each(['uid','company'] as const)('취소 commit 뒤 %s 변경은 첫 취소 원문을 보존한다',async field=>{await executeRawPress(request());mem.afterCommit=()=>{mem[field]=field==='uid'?'other':'punghoe';};await expect(executeRawPressCancellation(cancellationInput())).rejects.toThrow();expect(readRawPressCancellationAttempt('taebaek','uid','press')).not.toBeNull();mem.afterCommit=null;mem.uid='uid';mem.company='taebaek';expect((await executeRawPressCancellation(cancellationInput())).status).toBe('duplicate');});
