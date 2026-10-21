/** @vitest-environment jsdom */
import {beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({auth:{currentUser:{uid:'uid',getIdTokenResult:vi.fn()}},get:vi.fn(),call:vi.fn()}));
vi.mock('firebase/firestore',()=>({doc:()=>({}),getDoc:m.get}));vi.mock('firebase/functions',()=>({httpsCallable:()=>m.call}));vi.mock('../firebase',()=>({auth:m.auth,authReady:Promise.resolve(),db:{},functions:{}}));
import {runFinancialOpening,resumeFinancialOpening,getPendingFinancialOpening,readFinancialOpeningObservation,resumeObservedFinancialOpening} from './financialOpeningCommands';
const draft={kind:'loan-create' as const,loan:{id:'loan',companyId:'punghoe' as const,name:'대출',lenderName:'은행',accountCode:'260' as const,openingDate:'2026-07-31',openingPrincipal:1000,createdAt:'2026-07-31'}};
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();m.get.mockReset();m.call.mockReset();m.auth.currentUser.getIdTokenResult.mockReset();m.auth.currentUser.uid='uid';m.auth.currentUser.getIdTokenResult.mockResolvedValue({claims:{companyId:'punghoe',isAdmin:true}});m.get.mockResolvedValue({data:()=>({status:'active',releaseId:'release'})});m.call.mockResolvedValue({data:{result:'created'}});});
it('unknown 뒤 재개는 ID·과거일·원문·release를 모두 그대로 보낸다',async()=>{m.call.mockRejectedValueOnce(new Error('unknown'));await expect(runFinancialOpening('punghoe',draft)).rejects.toThrow();const request=m.call.mock.calls[0][0];expect(getPendingFinancialOpening('punghoe')?.request).toEqual(request);await resumeFinancialOpening('punghoe');expect(m.call.mock.calls[1][0]).toEqual(request);expect(getPendingFinancialOpening('punghoe')).toBeNull();});
it('unknown 뒤 입력변경이나 다른 UID로 새 원문을 보내지 않는다',async()=>{m.call.mockRejectedValueOnce(new Error('unknown'));await expect(runFinancialOpening('punghoe',draft)).rejects.toThrow();await expect(runFinancialOpening('punghoe',{...draft,loan:{...draft.loan,openingPrincipal:2000}})).rejects.toThrow('먼저');m.auth.currentUser.uid='other';expect(getPendingFinancialOpening('punghoe')).toBeNull();expect(m.call).toHaveBeenCalledOnce();});
it('송신 전 계정조회 실패는 원문대기를 만들지 않는다',async()=>{m.get.mockRejectedValueOnce(new Error('읽기 실패'));await expect(runFinancialOpening('punghoe',draft)).rejects.toThrow();expect(localStorage.length).toBe(0);expect(m.call).not.toHaveBeenCalled();});
it('최초 exactproof 거절만 해제하고 이전unknown 재시도의proof는 보존한다',async()=>{const fail=()=>{const request=m.call.mock.calls.at(-1)![0];return Object.assign(new Error('거절'),{details:{operationStatus:'rejected',version:1,financialWrites:false,companyId:'punghoe',operationId:request.operationId}});};m.call.mockImplementationOnce(async()=>{throw fail();});await expect(runFinancialOpening('punghoe',draft)).rejects.toThrow();expect(getPendingFinancialOpening('punghoe')).toBeNull();m.call.mockRejectedValueOnce(new Error('unknown'));await expect(runFinancialOpening('punghoe',draft)).rejects.toThrow();m.call.mockImplementationOnce(async()=>{throw fail();});await expect(resumeFinancialOpening('punghoe')).rejects.toThrow();expect(getPendingFinancialOpening('punghoe')).not.toBeNull();});
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
 const observed=await seedFinancialObservation();const raw=JSON.stringify(observed.pending,null,2);localStorage.setItem(observedKey,raw);
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
 if(mode==='success')await resumeObservedFinancialOpening('punghoe',observed,()=>true);else await expect(resumeObservedFinancialOpening('punghoe',observed,()=>true)).rejects.toThrow('거절');expect(localStorage.getItem(observedKey)).toBe('replacement');
});
it('자기 ACK 정리 이벤트가 UI 목록을 비워도 현재 실행의 성공을 유지한다',async()=>{
 const observed=await seedFinancialObservation();let listed=readFinancialOpeningObservation('punghoe');const listener=()=>{listed=readFinancialOpeningObservation('punghoe');};window.addEventListener('financial-opening-pending',listener);
 try{await expect(resumeObservedFinancialOpening('punghoe',observed,()=>true)).resolves.toBe('created');expect(listed).toBeNull();}finally{window.removeEventListener('financial-opening-pending',listener);}
});
