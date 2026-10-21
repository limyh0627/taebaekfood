/** @vitest-environment jsdom */
import {beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({auth:{currentUser:{uid:'uid',getIdTokenResult:vi.fn()}},get:vi.fn(),call:vi.fn()}));
vi.mock('firebase/firestore',()=>({doc:()=>({}),getDoc:m.get}));vi.mock('firebase/functions',()=>({httpsCallable:()=>m.call}));vi.mock('../firebase',()=>({auth:m.auth,authReady:Promise.resolve(),db:{},functions:{}}));
import {runFinancialOpening,resumeFinancialOpening,getPendingFinancialOpening,readFinancialOpeningObservation,resumeObservedFinancialOpening,readFinancialOpeningRecovery,retryFinancialOpening,inspectFinancialOpening,cancelFinancialOpening,discardFinancialOpeningCopy,upgradeFinancialOpeningReference,financialOpeningRecoveryProjection} from './financialOpeningCommands';
const draft={kind:'loan-create' as const,loan:{id:'loan',companyId:'punghoe' as const,name:'대출',lenderName:'은행',accountCode:'260' as const,openingDate:'2026-07-31',openingPrincipal:1000,createdAt:'2026-07-31'}};
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();m.get.mockReset();m.call.mockReset();m.auth.currentUser.getIdTokenResult.mockReset();m.auth.currentUser.uid='uid';m.auth.currentUser.getIdTokenResult.mockResolvedValue({claims:{companyId:'punghoe',isAdmin:true}});m.get.mockResolvedValue({data:()=>({status:'active',releaseId:'release'})});m.call.mockResolvedValue({data:{result:'created'}});});
it('unknown 뒤 재개는 ID·과거일·원문·release를 모두 그대로 보낸다',async()=>{m.call.mockRejectedValueOnce(new Error('unknown'));await expect(runFinancialOpening('punghoe',draft)).rejects.toThrow();const request=m.call.mock.calls[0][0];expect(getPendingFinancialOpening('punghoe')?.request).toEqual(request);await resumeFinancialOpening('punghoe');expect(m.call.mock.calls[1][0]).toEqual(request);expect(getPendingFinancialOpening('punghoe')).toBeNull();});
it('unknown 뒤 입력변경이나 다른 UID로 새 원문을 보내지 않는다',async()=>{m.call.mockRejectedValueOnce(new Error('unknown'));await expect(runFinancialOpening('punghoe',draft)).rejects.toThrow();await expect(runFinancialOpening('punghoe',{...draft,loan:{...draft.loan,openingPrincipal:2000}})).rejects.toThrow('먼저');m.auth.currentUser.uid='other';expect(getPendingFinancialOpening('punghoe')).toBeNull();expect(m.call).toHaveBeenCalledOnce();});
it('송신 전 계정조회 실패는 원문대기를 만들지 않는다',async()=>{m.get.mockRejectedValueOnce(new Error('읽기 실패'));await expect(runFinancialOpening('punghoe',draft)).rejects.toThrow();expect(localStorage.length).toBe(0);expect(m.call).not.toHaveBeenCalled();});
it('최초 무쓰기 거절도 미래 처리 중단은 아니므로 본문과 참조를 보존한다',async()=>{
 const fail=()=>{const request=m.call.mock.calls.at(-1)![0];return Object.assign(new Error('거절'),{details:{operationStatus:'rejected',version:1,financialWrites:false,companyId:'punghoe',operationId:request.operationId}});};
 m.call.mockImplementationOnce(async()=>{throw fail();});await expect(runFinancialOpening('punghoe',draft)).rejects.toThrow('거절');
 const first=await readFinancialOpeningRecovery('punghoe');expect(first?.pending).not.toBeNull();expect(first?.referenceRaw).not.toBeNull();expect(first?.lastAttempt?.outcome).toBe('server-rejected');
 m.call.mockImplementationOnce(async()=>{throw fail();});await expect(resumeFinancialOpening('punghoe')).rejects.toThrow('거절');expect(getPendingFinancialOpening('punghoe')).not.toBeNull();
});
it('권한 await 중 UID 교체는 callable을 보내지 않는다',async()=>{m.auth.currentUser.getIdTokenResult.mockImplementationOnce(async()=>{m.auth.currentUser.uid='other';return {claims:{companyId:'punghoe',isAdmin:true}};});await expect(runFinancialOpening('punghoe',draft)).rejects.toThrow('변경');expect(m.call).not.toHaveBeenCalled();});
it('손상 JSON은 삭제하거나 재전송하지 않는다',async()=>{localStorage.setItem('financial-opening:punghoe:uid','{"version":1}');expect(()=>getPendingFinancialOpening('punghoe')).toThrow('확인');await expect(resumeFinancialOpening('punghoe')).rejects.toThrow();expect(m.call).not.toHaveBeenCalled();expect(localStorage.length).toBe(1);});

it('필수 원본이 없거나 null인 JSON은 보존하고 복구 화면으로 반환하지 않는다',()=>{for(const request of [{kind:'loan-create'},{kind:'account-update',original:null}]){const text=JSON.stringify({version:1,companyId:'punghoe',userId:'uid',request:{...request,companyId:'punghoe',operationId:'op',releaseId:'release'}});localStorage.setItem('financial-opening:punghoe:uid',text);expect(()=>getPendingFinancialOpening('punghoe')).toThrow('원문');expect(localStorage.getItem('financial-opening:punghoe:uid')).toBe(text);}});
it('불명확한 성공 응답은 원문을 지우지 않는다',async()=>{m.call.mockResolvedValueOnce({data:{}});await expect(runFinancialOpening('punghoe',draft)).rejects.toThrow('결과');expect(getPendingFinancialOpening('punghoe')).not.toBeNull();});
const deferredFinancial = <T,>() => {let resolve!:(value:T)=>void;const promise=new Promise<T>(ok=>{resolve=ok;});return {promise,resolve};};
it('동시 gate 조회 뒤 첫 ACK가 정리돼도 두 번째 신규 작업을 보내지 않는다',async()=>{
 const firstGate=deferredFinancial<{data:()=>{status:string;releaseId:string}}>(),secondGate=deferredFinancial<{data:()=>{status:string;releaseId:string}}>();
 m.get.mockReturnValueOnce(firstGate.promise).mockReturnValueOnce(secondGate.promise);
 const first=runFinancialOpening('punghoe',draft);const second=runFinancialOpening('punghoe',draft).then(()=>null,error=>error);
 await vi.waitFor(()=>expect(m.get).toHaveBeenCalled());
 firstGate.resolve({data:()=>({status:'active',releaseId:'release'})});await first;expect(getPendingFinancialOpening('punghoe')).toBeNull();
 secondGate.resolve({data:()=>({status:'active',releaseId:'release'})});const secondResult=await second;
 expect(m.call).toHaveBeenCalledTimes(1);expect(secondResult).toBeInstanceOf(Error);
});
it('재개 권한 조회 중 원문이 삭제되면 다시 보관하거나 송신하지 않는다',async()=>{
 m.call.mockRejectedValueOnce(Error('unknown'));await expect(runFinancialOpening('punghoe',draft)).rejects.toThrow('unknown');m.call.mockClear();
 const key='financial-opening:punghoe:uid';m.auth.currentUser.getIdTokenResult.mockImplementationOnce(async()=>{localStorage.removeItem(key);return {claims:{companyId:'punghoe',isAdmin:true}};});
 const result=await resumeFinancialOpening('punghoe').then(()=>null,error=>error);
 expect(m.call).not.toHaveBeenCalled();expect(result).toBeInstanceOf(Error);expect(localStorage.getItem(key)).toBeNull();
});
const observedKey='financial-opening:punghoe:uid';
async function seedFinancialObservation(){m.call.mockRejectedValueOnce(Error('unknown'));await expect(runFinancialOpening('punghoe',draft)).rejects.toThrow('unknown');const observed=readFinancialOpeningObservation('punghoe');if(!observed)throw Error('관측fixture없음');m.call.mockClear();m.get.mockClear();return observed;}
it('관측 읽기는 원문 공백까지 그대로 반환하고 재개는 최초 전체 request만 보낸다',async()=>{
 const observed=await seedFinancialObservation();const raw=JSON.stringify(observed.pending,null,2);localStorage.setItem(observedKey,raw);localStorage.removeItem(observedKey+':reference');
 const legacy=await readFinancialOpeningRecovery('punghoe');await upgradeFinancialOpeningReference('punghoe',legacy!,()=>true);
 const current=readFinancialOpeningObservation('punghoe')!;expect(current.raw).toBe(raw);expect(current.pending).toEqual(observed.pending);
 await resumeObservedFinancialOpening('punghoe',current,()=>true);expect(m.call).toHaveBeenCalledExactlyOnceWith(observed.pending.request);expect(m.get).not.toHaveBeenCalled();expect(localStorage.getItem(observedKey)).toBeNull();
});
it.each(['deleted','replaced'] as const)('표시 후 %s 원문은 strict 재개에서 복원·새작업·송신하지 않는다',async mode=>{
 const observed=await seedFinancialObservation();const replacement=JSON.stringify({...observed.pending,request:{...observed.pending.request,operationId:'other-op'}});
 if(mode==='deleted')localStorage.removeItem(observedKey);else localStorage.setItem(observedKey,replacement);
 const uuid=vi.spyOn(crypto,'randomUUID');await expect(resumeObservedFinancialOpening('punghoe',observed,()=>true)).rejects.toThrow('바뀌었습니다');expect(m.call).not.toHaveBeenCalled();expect(m.get).not.toHaveBeenCalled();expect(uuid).not.toHaveBeenCalled();expect(localStorage.getItem(observedKey)).toBe(mode==='deleted'?null:replacement);
});
it('권한 await 중 관측 객체와 저장소가 함께 바뀌어도 최초 raw만 재검한다',async()=>{
 const observed=await seedFinancialObservation(),initial=observed.raw;
 m.auth.currentUser.getIdTokenResult.mockImplementationOnce(async()=>{observed.pending.request.operationId='other-op';observed.raw=JSON.stringify(observed.pending);localStorage.setItem(observedKey,observed.raw);return {claims:{companyId:'punghoe',isAdmin:true}};});
 await expect(resumeObservedFinancialOpening('punghoe',observed,()=>true)).rejects.toThrow('바뀌었습니다');expect(m.call).not.toHaveBeenCalled();expect(localStorage.getItem(observedKey)).not.toBe(initial);
});
it('raw와 공개 pending 객체가 서로 다르면 보내지 않는다',async()=>{
 const observed=await seedFinancialObservation();observed.pending.request.operationId='different';await expect(resumeObservedFinancialOpening('punghoe',observed,()=>true)).rejects.toThrow('다릅니다');expect(m.call).not.toHaveBeenCalled();
});
it.each(['uid','owner'] as const)('권한 await 중 %s 변경은 보관원문을 지우거나 보내지 않는다',async mode=>{
 const observed=await seedFinancialObservation();let current=true;
 m.auth.currentUser.getIdTokenResult.mockImplementationOnce(async()=>{if(mode==='uid')m.auth.currentUser.uid='other';else current=false;return {claims:{companyId:'punghoe',isAdmin:true}};});
 await expect(resumeObservedFinancialOpening('punghoe',observed,()=>current)).rejects.toThrow('변경');expect(m.call).not.toHaveBeenCalled();expect(localStorage.getItem(observedKey)).toBe(observed.raw);
});
it('신규 gate 대기 중 다른 사본이 생기면 덮어쓰거나 신규작업을 보내지 않는다',async()=>{
 const gate=deferredFinancial<{data:()=>{status:string;releaseId:string}}>();m.get.mockReturnValueOnce(gate.promise);const run=runFinancialOpening('punghoe',draft);await vi.waitFor(()=>expect(m.get).toHaveBeenCalledTimes(1));
 localStorage.setItem(observedKey,'external-copy');gate.resolve({data:()=>({status:'active',releaseId:'release'})});await expect(run).rejects.toThrow('바뀌었습니다');expect(m.call).not.toHaveBeenCalled();expect(localStorage.getItem(observedKey)).toBe('external-copy');
});
it('신규 권한 await 중 생긴 사본도 gate 조회 없이 보존한다',async()=>{
 m.auth.currentUser.getIdTokenResult.mockImplementationOnce(async()=>{localStorage.setItem(observedKey,'external-copy');return {claims:{companyId:'punghoe',isAdmin:true}};});
 await expect(runFinancialOpening('punghoe',draft)).rejects.toThrow('바뀌었습니다');expect(m.get).not.toHaveBeenCalled();expect(m.call).not.toHaveBeenCalled();expect(localStorage.getItem(observedKey)).toBe('external-copy');
});
it('run과 strict resume는 같은 키의 실행 잠금을 공유하고 끝난 뒤 재사용한다',async()=>{
 const observed=await seedFinancialObservation();const response=deferredFinancial<{data:{result:string}}>();m.call.mockReturnValueOnce(response.promise);
 const first=resumeObservedFinancialOpening('punghoe',observed,()=>true);await vi.waitFor(()=>expect(m.call).toHaveBeenCalledTimes(1));await expect(runFinancialOpening('punghoe',draft)).rejects.toThrow('처리 중');await expect(resumeFinancialOpening('punghoe')).rejects.toThrow('처리 중');
 response.resolve({data:{result:'unchanged'}});await first;await runFinancialOpening('punghoe',draft);expect(m.call).toHaveBeenCalledTimes(2);
});
it('회사와 UID 키가 다른 새 업무는 앞 요청의 잠금에 막히지 않는다',async()=>{
 const gate=deferredFinancial<{data:()=>{status:string;releaseId:string}}>();m.get.mockReturnValueOnce(gate.promise);
 const old=runFinancialOpening('punghoe',draft).then(()=>null,error=>error);await vi.waitFor(()=>expect(m.get).toHaveBeenCalledTimes(1));
 m.auth.currentUser.uid='other';m.auth.currentUser.getIdTokenResult.mockResolvedValue({claims:{companyId:'taebaek',isAdmin:true}});
 await runFinancialOpening('taebaek',{...draft,loan:{...draft.loan,companyId:'taebaek'}});expect(m.call).toHaveBeenCalledTimes(1);
 gate.resolve({data:()=>({status:'active',releaseId:'release'})});expect(await old).toBeInstanceOf(Error);
});
it.each(['success','proof'] as const)('응답 %s 때 교체된 사본은 CAS 정리하지 않는다',async mode=>{
 const observed=await seedFinancialObservation();m.call.mockImplementationOnce(async()=>{localStorage.setItem(observedKey,'replacement');if(mode==='proof')throw Object.assign(Error('거절'),{details:{operationStatus:'rejected',version:1,financialWrites:false,companyId:'punghoe',operationId:observed.pending.request.operationId}});return {data:{result:'unchanged'}};});
 if(mode==='success')await expect(resumeObservedFinancialOpening('punghoe',observed,()=>true)).rejects.toThrow('바뀌었습니다');else await expect(resumeObservedFinancialOpening('punghoe',observed,()=>true)).rejects.toThrow('거절');expect(localStorage.getItem(observedKey)).toBe('replacement');
});
it('자기 ACK 정리 이벤트가 UI 목록을 비워도 현재 실행의 성공을 유지한다',async()=>{
 const observed=await seedFinancialObservation();let listed=readFinancialOpeningObservation('punghoe');const listener=()=>{listed=readFinancialOpeningObservation('punghoe');};window.addEventListener('financial-opening-pending',listener);
 try{await expect(resumeObservedFinancialOpening('punghoe',observed,()=>true)).resolves.toBe('created');expect(listed).toBeNull();}finally{window.removeEventListener('financial-opening-pending',listener);}
});

it('서로 다른 유효 본문과 참조는 두 요청을 각각 확인하고 모두 중단한 뒤 정리한다',async()=>{
 const original=await seedFinancialObservation();
 const body=JSON.stringify({...original.pending,request:{...original.pending.request,operationId:'body-other'}});
 localStorage.setItem(observedKey,body);
 const entry=await readFinancialOpeningRecovery('punghoe');
 expect(entry).not.toBeNull();
 expect((entry as unknown as {references:{reference:{operationId:string}}[]}).references.map(row=>row.reference.operationId)).toEqual([original.pending.request.operationId,'body-other']);
});

async function recoveryFixture(){await seedFinancialObservation();const entry=await readFinancialOpeningRecovery('punghoe');if(!entry)throw Error('복구fixture없음');return entry;}
function recoveryResponse(reference:NonNullable<Awaited<ReturnType<typeof readFinancialOpeningRecovery>>>['reference'],status:'applied'|'cancelled'|'unknown'='unknown'){
 return {data:{version:1,reference,actorUid:'uid',status,requestHash:status==='applied'?'a'.repeat(64):null,...(status==='applied'?{result:'created'}:{}),message:'서버 결과'}};
}
it('첫 송신 전에 본문과 독립 참조를 읽어 확인하고 raw SHA를 보관한다',async()=>{
 m.call.mockImplementationOnce(async()=>{const entry=await readFinancialOpeningRecovery('punghoe');expect(entry?.validBody).toBe(true);const copy=JSON.parse(entry!.referenceRaw!);const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(entry!.bodyRaw!)))).map(v=>v.toString(16).padStart(2,'0')).join('');expect(copy.bodyDigest).toBe(digest);expect(copy.reference.operationId).toBe(entry!.pending!.request.operationId);return {data:{result:'created'}};});
 await runFinancialOpening('punghoe',draft);expect(localStorage.length).toBe(0);
});
it.each(['absent','corrupt'] as const)('본문 %s이어도 독립 참조 조회·중단만 허용하고 새 송신은 막는다',async mode=>{
 const first=await recoveryFixture();if(mode==='absent')localStorage.removeItem(observedKey);else localStorage.setItem(observedKey,'broken');const entry=(await readFinancialOpeningRecovery('punghoe'))!;
 expect(entry.validBody).toBe(false);await expect(retryFinancialOpening('punghoe',entry,()=>true)).rejects.toThrow('원문');await expect(runFinancialOpening('punghoe',draft)).rejects.toThrow('이전');expect(m.call).not.toHaveBeenCalled();
 m.call.mockResolvedValueOnce(recoveryResponse(first.reference));await inspectFinancialOpening('punghoe',entry,()=>true);expect(m.call).toHaveBeenLastCalledWith({mode:'inspect',reference:first.reference});
 m.call.mockResolvedValueOnce(recoveryResponse(first.reference,'cancelled'));await cancelFinancialOpening('punghoe',entry,()=>true);expect(m.call).toHaveBeenLastCalledWith({mode:'cancel',reference:first.reference});expect(localStorage.getItem(observedKey+':reference')).toBe(first.referenceRaw);
});
it('식별할 수 없는 양 사본은 가짜 조회 없이 명시 기기 정리만 한다',async()=>{
 localStorage.setItem(observedKey,'bad-body');localStorage.setItem(observedKey+':reference','bad-reference');const entry=(await readFinancialOpeningRecovery('punghoe'))!;const view=financialOpeningRecoveryProjection(entry);expect(view.canInspect).toBe(false);expect(view.canDiscard).toBe(true);expect(view.nextAction).toContain('서버 요청 취소가 아닙니다');await expect(inspectFinancialOpening('punghoe',entry,()=>true)).rejects.toThrow('식별');await discardFinancialOpeningCopy('punghoe',entry,()=>true);expect(m.call).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
});
it('unknown 조회는 원인을 유지하고 정리를 막으며 중단 확인 뒤 새 업무로 이어진다',async()=>{
 const entry=await recoveryFixture();m.call.mockResolvedValueOnce(recoveryResponse(entry.reference));const unknown=await inspectFinancialOpening('punghoe',entry,()=>true);expect(financialOpeningRecoveryProjection(entry,unknown).cause).toContain('unknown');m.call.mockResolvedValueOnce(recoveryResponse(entry.reference));await expect(discardFinancialOpeningCopy('punghoe',entry,()=>true)).rejects.toThrow('중단');expect(localStorage.getItem(observedKey)).toBe(entry.bodyRaw);
 m.call.mockResolvedValueOnce(recoveryResponse(entry.reference,'cancelled'));const cancelled=await cancelFinancialOpening('punghoe',entry,()=>true);expect(financialOpeningRecoveryProjection(entry,cancelled).cause).toBe('');m.call.mockResolvedValueOnce(recoveryResponse(entry.reference,'cancelled'));await discardFinancialOpeningCopy('punghoe',entry,()=>true);m.call.mockResolvedValueOnce({data:{result:'created'}});await runFinancialOpening('punghoe',draft);expect(localStorage.length).toBe(0);
});
it('legacy 원문은 명시 승격 전 재송신하지 않고 승격 뒤에도 원문 바이트를 보존한다',async()=>{
 const first=await recoveryFixture();localStorage.removeItem(observedKey+':reference');const entry=(await readFinancialOpeningRecovery('punghoe'))!;expect(entry.legacy).toBe(true);await expect(retryFinancialOpening('punghoe',entry,()=>true)).rejects.toThrow('원문');expect(m.call).not.toHaveBeenCalled();const own=vi.fn();const next=await upgradeFinancialOpeningReference('punghoe',entry,()=>true,own);expect(next.bodyRaw).toBe(first.bodyRaw);expect(next.validBody).toBe(true);expect(own).toHaveBeenCalledExactlyOnceWith(next);await retryFinancialOpening('punghoe',next,()=>true);expect(m.call).toHaveBeenCalledExactlyOnceWith(first.pending!.request);
});
it('같은 참조의 digest 불일치는 readonly 조회만 허용한다',async()=>{
 const first=await recoveryFixture();const copy=JSON.parse(first.referenceRaw!);copy.bodyDigest='b'.repeat(64);localStorage.setItem(observedKey+':reference',JSON.stringify(copy));const entry=(await readFinancialOpeningRecovery('punghoe'))!;expect(entry.references).toHaveLength(1);expect(entry.validBody).toBe(false);await expect(retryFinancialOpening('punghoe',entry,()=>true)).rejects.toThrow('원문');expect(m.call).not.toHaveBeenCalled();m.call.mockResolvedValueOnce(recoveryResponse(entry.reference));await inspectFinancialOpening('punghoe',entry,()=>true);expect(m.call).toHaveBeenCalledOnce();
});
it('연속 응답 유실의 자기 메타 쌍은 notify 전에 전달되어 다음 재시도에 쓰인다',async()=>{
 let entry=await recoveryFixture();const events:string[]=[];const listener=()=>events.push(localStorage.getItem(observedKey+':reference')!);window.addEventListener('financial-opening-pending',listener);
 try{for(const message of ['두 번째 유실','세 번째 유실']){m.call.mockRejectedValueOnce(Error(message));await expect(retryFinancialOpening('punghoe',entry,()=>true,next=>{expect(events).not.toContain(next.referenceRaw);entry=next;})).rejects.toThrow(message);expect(entry.lastAttempt?.message).toBe(message);expect((await readFinancialOpeningRecovery('punghoe'))?.referenceRaw).toBe(entry.referenceRaw);}await retryFinancialOpening('punghoe',entry,()=>true);expect(m.call).toHaveBeenCalledTimes(3);expect(localStorage.length).toBe(0);}finally{window.removeEventListener('financial-opening-pending',listener);}
});
it('메타 보관 실패는 원래 오류와 기록 실패를 알리고 원문을 보존한다',async()=>{
 const entry=await recoveryFixture();const set=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota');});m.call.mockRejectedValueOnce(Error('네트워크 유실'));await expect(retryFinancialOpening('punghoe',entry,()=>true)).rejects.toThrow('네트워크 유실 원인 안내를 기록하지 못했습니다');expect(localStorage.getItem(observedKey)).toBe(entry.bodyRaw);expect(localStorage.getItem(observedKey+':reference')).toBe(entry.referenceRaw);set.mockRestore();
});
it('오류 메타에는 토큰·본문·스택을 복사하지 않는다',async()=>{
 const entry=await recoveryFixture();m.call.mockRejectedValueOnce(Error('Bearer secret-token\nstack data'));await expect(retryFinancialOpening('punghoe',entry,()=>true)).rejects.toThrow('Bearer');const read=(await readFinancialOpeningRecovery('punghoe'))!;expect(read.lastAttempt?.message).not.toContain('secret');expect(read.lastAttempt?.message).not.toContain('stack');expect(read.lastAttempt?.phase).toBe('sent');
});
it('조회 await 중 새 사본은 이전 결과로 정리하지 않는다',async()=>{
 const entry=await recoveryFixture();m.call.mockImplementationOnce(async()=>{localStorage.setItem(observedKey+':reference','new-reference');return recoveryResponse(entry.reference,'cancelled');});await expect(discardFinancialOpeningCopy('punghoe',entry,()=>true)).rejects.toThrow('바뀌었습니다');expect(localStorage.getItem(observedKey)).toBe(entry.bodyRaw);expect(localStorage.getItem(observedKey+':reference')).toBe('new-reference');
});
it('관측 밖 다른 회사·다른 요청은 조회하지 않는다',async()=>{
 const entry=await recoveryFixture();await expect(inspectFinancialOpening('punghoe',entry,()=>true,{...entry.reference!,companyId:'taebaek'})).rejects.toThrow('식별');await expect(cancelFinancialOpening('punghoe',entry,()=>true,{...entry.reference!,operationId:'unobserved'})).rejects.toThrow('식별');expect(m.call).not.toHaveBeenCalled();
});
it('충돌한 두 참조는 각각 terminal이어야 양 사본을 정리한다',async()=>{
 const first=await recoveryFixture();localStorage.setItem(observedKey,JSON.stringify({...first.pending,request:{...first.pending!.request,operationId:'body-other'}}));const entry=(await readFinancialOpeningRecovery('punghoe'))!;expect(entry.conflictingReference).toBe(true);await expect(retryFinancialOpening('punghoe',entry,()=>true)).rejects.toThrow();await expect(upgradeFinancialOpeningReference('punghoe',entry,()=>true)).rejects.toThrow();expect(m.call).not.toHaveBeenCalled();const results=[];
 for(const {reference} of entry.references){m.call.mockResolvedValueOnce(recoveryResponse(reference,'cancelled'));results.push(await cancelFinancialOpening('punghoe',entry,()=>true,reference));}
 expect(financialOpeningRecoveryProjection(entry,results.slice(0,1)).canDiscard).toBe(false);expect(financialOpeningRecoveryProjection(entry,results).canDiscard).toBe(true);
 m.call.mockResolvedValueOnce(recoveryResponse(entry.references[0].reference,'cancelled')).mockResolvedValueOnce(recoveryResponse(entry.references[1].reference));await expect(discardFinancialOpeningCopy('punghoe',entry,()=>true)).rejects.toThrow('중단');expect(localStorage.getItem(observedKey)).toBe(entry.bodyRaw);
 for(const {reference} of entry.references)m.call.mockResolvedValueOnce(recoveryResponse(reference,'cancelled'));await discardFinancialOpeningCopy('punghoe',entry,()=>true);expect(localStorage.length).toBe(0);
});
it('권한 확인 전송 실패도 before-send 원인을 보관하되 확정 거절로 추정하지 않는다',async()=>{
 const entry=await recoveryFixture();m.auth.currentUser.getIdTokenResult.mockRejectedValueOnce(Error('권한 확인 연결 실패'));const own=vi.fn();await expect(retryFinancialOpening('punghoe',entry,()=>true,own)).rejects.toThrow('권한 확인 연결 실패');expect(m.call).not.toHaveBeenCalled();const next=await readFinancialOpeningRecovery('punghoe');expect(next?.lastAttempt).toMatchObject({phase:'before-send',outcome:'unconfirmed',message:'권한 확인 연결 실패'});expect(own).toHaveBeenCalledOnce();
});
it('본문 또는 참조 첫 보관 readback 실패는 RPC를 보내지 않는다',async()=>{
 const actual=Storage.prototype.setItem;const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){if(key.endsWith(':reference'))return;return actual.call(this,key,value);});await expect(runFinancialOpening('punghoe',draft)).rejects.toThrow('바뀌었습니다');expect(m.call).not.toHaveBeenCalled();expect(localStorage.getItem(observedKey)).not.toBeNull();spy.mockRestore();const entry=(await readFinancialOpeningRecovery('punghoe'))!;expect(entry.legacy).toBe(true);
});
it('자기 오류 메타 기록 중 외부 참조 교체는 덮거나 자기 관측으로 알리지 않는다',async()=>{
 const entry=await recoveryFixture(),own=vi.fn();m.call.mockImplementationOnce(async()=>{localStorage.setItem(observedKey+':reference','external');throw Error('lost');});await expect(retryFinancialOpening('punghoe',entry,()=>true,own)).rejects.toThrow('원인 안내를 기록하지 못했습니다');expect(own).not.toHaveBeenCalled();expect(localStorage.getItem(observedKey+':reference')).toBe('external');expect(localStorage.getItem(observedKey)).toBe(entry.bodyRaw);
});
it('양 사본 정리 도중 들어온 다른 참조는 삭제하지 않는다',async()=>{
 const entry=await recoveryFixture();m.call.mockResolvedValueOnce(recoveryResponse(entry.reference,'cancelled'));const original=Storage.prototype.removeItem;const remove=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(function(this:Storage,key){original.call(this,key);if(key===observedKey)localStorage.setItem(observedKey+':reference','new-reference');});await expect(discardFinancialOpeningCopy('punghoe',entry,()=>true)).rejects.toThrow('바뀌었습니다');expect(localStorage.getItem(observedKey+':reference')).toBe('new-reference');remove.mockRestore();
});
it('공개 entry를 권한 대기 중 바꿔도 최초 양 관측을 기준으로만 확인한다',async()=>{
 const entry=await recoveryFixture(),raw=entry.bodyRaw; m.auth.currentUser.getIdTokenResult.mockImplementationOnce(async()=>{entry.bodyRaw='replacement';entry.referenceRaw='replacement';entry.pending!.request.operationId='changed';return {claims:{companyId:'punghoe',isAdmin:true}};});await retryFinancialOpening('punghoe',entry,()=>true);expect(m.call.mock.calls[0][0].operationId).toBe(JSON.parse(raw!).request.operationId);
});
it('같은 operation의 다른 kind 충돌은 서버 거절을 그대로 유지하고 정리하지 않는다',async()=>{
 const entry=await recoveryFixture();const copy=JSON.parse(entry.referenceRaw!);copy.reference.kind='account-create';localStorage.setItem(observedKey+':reference',JSON.stringify(copy));const conflict=(await readFinancialOpeningRecovery('punghoe'))!;expect(conflict.references).toHaveLength(2);m.call.mockRejectedValueOnce(Error('kind 충돌'));await expect(discardFinancialOpeningCopy('punghoe',conflict,()=>true)).rejects.toThrow('kind 충돌');expect(localStorage.getItem(observedKey)).toBe(conflict.bodyRaw);expect(localStorage.getItem(observedKey+':reference')).toBe(conflict.referenceRaw);
});
it('서로 다른 두 요청의 적용·중단 혼합 결과는 모두 확인한 결과로 안내한다',async()=>{
 const first=await recoveryFixture();localStorage.setItem(observedKey,JSON.stringify({...first.pending,request:{...first.pending!.request,operationId:'body-other'}}));const entry=(await readFinancialOpeningRecovery('punghoe'))!;
 const results=[recoveryResponse(entry.references[0].reference,'applied').data,recoveryResponse(entry.references[1].reference,'cancelled').data] as Parameters<typeof financialOpeningRecoveryProjection>[1];
 const view=financialOpeningRecoveryProjection(entry,results);expect(view.currentState).toBe('두 요청의 처리 결과를 모두 확인했습니다.');expect(view.referenceRows.map(row=>row.currentState)).toEqual(['이 요청의 기초 금융 처리는 완료되었습니다.','이 요청의 미처리 중단이 확인되었습니다.']);expect(view.canDiscard).toBe(true);
});
it('충돌한 참조의 과거 오류는 해당 참조가 미확정일 때만 보이고 본문 요청에 전파하지 않는다',async()=>{
 const first=await recoveryFixture();localStorage.setItem(observedKey,JSON.stringify({...first.pending,request:{...first.pending!.request,operationId:'body-other'}}));const entry=(await readFinancialOpeningRecovery('punghoe'))!;
 const view=financialOpeningRecoveryProjection(entry);expect(view.cause).not.toContain('unknown');expect(view.cause).toContain('서로 맞지');expect(view.referenceRows.find(row=>row.source==='reference')?.cause).toBe('unknown');expect(view.referenceRows.find(row=>row.source==='body')?.cause).toBe('');
 const terminal=recoveryResponse(entry.references[0].reference,'cancelled').data as NonNullable<Parameters<typeof financialOpeningRecoveryProjection>[1]>;const after=financialOpeningRecoveryProjection(entry,terminal);expect(after.referenceRows.every(row=>row.cause==='')).toBe(true);expect(after.canDiscard).toBe(false);expect(after.cause).not.toContain('unknown');
});
