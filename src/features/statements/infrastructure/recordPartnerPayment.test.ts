// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({read:vi.fn(),call:vi.fn(),token:vi.fn()}));
vi.mock('firebase/firestore',()=>({doc:(_db:unknown,collection:string,id:string)=>({collection,id}),getDoc:m.read}));
vi.mock('firebase/functions',()=>({httpsCallable:(_f:unknown,name:string)=>{expect(name).toBe('recordPartnerPaymentCommand');return m.call;}}));
vi.mock('../../../shared/firebase',()=>({authReady:Promise.resolve(),db:{},functions:{},auth:{currentUser:{uid:'demo-admin',getIdTokenResult:m.token}}}));
vi.mock('../../../shared/services/firebaseService',()=>({companyScopedWriteData:vi.fn()}));
import { recordPartnerPayment } from './issueTradeStatementCommand';
const input={tradeDate:'2026-10-07',partnerId:'partner-a',direction:'출금' as const,amount:100,cashAccountId:'bank-a',pin:false,allocations:[],note:' 지급 '};
const key='partner-payment-pending:taebaek:partner-a:demo-admin';
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();m.token.mockResolvedValue({claims:{companyId:'taebaek',isAdmin:true}});
 m.read.mockImplementation(async({id})=>({exists:()=>true,data:()=>id==='releaseCutover'?{status:'active',releaseId:'release-a'}:{revision:3}}));
 m.call.mockImplementation(async r=>({data:{status:'applied',id:r.operationId}}));});
it('확정 거절은 수정 입력과 새 작업을 허용한다',async()=>{m.call.mockImplementationOnce(async r=>{throw{details:{partnerPaymentFailure:{version:1,companyId:'taebaek',partnerId:'partner-a',operationId:r.operationId,operationRejected:true,financialWrites:false}}};});
 await expect(recordPartnerPayment('taebaek',input)).rejects.toBeDefined();expect(localStorage.length).toBe(0);
 await recordPartnerPayment('taebaek',{...input,amount:101});expect(m.call.mock.calls[1][0].operationId).not.toBe(m.call.mock.calls[0][0].operationId);});
it('응답 유실 뒤 전체 요청과 release를 고정하고 재조회하지 않는다',async()=>{m.call.mockRejectedValueOnce(new Error('lost'));
 await expect(recordPartnerPayment('taebaek',input)).rejects.toThrow('lost');const first=m.call.mock.calls[0][0];
 m.read.mockRejectedValue(new Error('must not refresh'));m.call.mockResolvedValueOnce({data:{status:'duplicate',id:first.operationId}});
 await recordPartnerPayment('taebaek',input);expect(m.call.mock.calls[1][0]).toEqual(first);expect(first).toMatchObject({releaseId:'release-a',expectedRevision:3,note:'지급'});expect(m.read).toHaveBeenCalledTimes(2);});
it('불확실 요청의 입력 변경은 원 요청을 보존한다',async()=>{m.call.mockRejectedValueOnce(new Error('lost'));await expect(recordPartnerPayment('taebaek',input)).rejects.toThrow();
 const saved=localStorage.getItem(key);await expect(recordPartnerPayment('taebaek',{...input,amount:101})).rejects.toThrow('불확실');expect(localStorage.getItem(key)).toBe(saved);expect(m.call).toHaveBeenCalledTimes(1);});
for(const changed of [{companyId:'punghoe'},{partnerId:'other'},{operationId:'other'},{operationRejected:false},{financialWrites:true},{version:2}])
 it(`다른 또는 불완전 terminal detail 보존 ${JSON.stringify(changed)}`,async()=>{m.call.mockImplementationOnce(async r=>{throw{details:{partnerPaymentFailure:{version:1,companyId:'taebaek',partnerId:'partner-a',operationId:r.operationId,operationRejected:true,financialWrites:false,...changed}}};});
 await expect(recordPartnerPayment('taebaek',input)).rejects.toBeDefined();expect(localStorage.length).toBe(1);});
async function legacyPending(){const bytes=new TextEncoder().encode(JSON.stringify(input));const digest=await crypto.subtle.digest('SHA-256',bytes);return{fingerprint:Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join(''),operationId:'legacy-op',revision:2};}
it('구형 동일 입력은 현재 release 확인 요청을 같은 작업으로 고정한다',async()=>{localStorage.setItem(key,JSON.stringify(await legacyPending()));m.call.mockRejectedValueOnce(new Error('lost'));
 await expect(recordPartnerPayment('taebaek',input)).rejects.toThrow('lost');const first=m.call.mock.calls[0][0];expect(first).toMatchObject({operationId:'legacy-op',expectedRevision:2,releaseId:'release-a'});
 m.read.mockRejectedValue(new Error('no refresh'));m.call.mockResolvedValueOnce({data:{status:'duplicate',id:'legacy-op'}});await recordPartnerPayment('taebaek',input);expect(m.call.mock.calls[1][0]).toEqual(first);expect(localStorage.length).toBe(0);});
it('구형 동일 작업의 durable 거절은 수정 후 새 UUID를 허용한다',async()=>{localStorage.setItem(key,JSON.stringify(await legacyPending()));m.call.mockImplementationOnce(async r=>{throw{details:{partnerPaymentFailure:{version:1,companyId:'taebaek',partnerId:'partner-a',operationId:r.operationId,operationRejected:true,financialWrites:false}}};});
 await expect(recordPartnerPayment('taebaek',input)).rejects.toBeDefined();expect(m.call.mock.calls[0][0].operationId).toBe('legacy-op');expect(localStorage.length).toBe(0);
 await recordPartnerPayment('taebaek',{...input,amount:101});expect(m.call.mock.calls[1][0].operationId).not.toBe('legacy-op');});
it('구형 applied hash 불일치 또는 미복원 입력은 기록을 보존한다',async()=>{localStorage.setItem(key,JSON.stringify(await legacyPending()));m.call.mockRejectedValueOnce({code:'functions/failed-precondition'});
 await expect(recordPartnerPayment('taebaek',input)).rejects.toBeDefined();expect(localStorage.length).toBe(1);await expect(recordPartnerPayment('taebaek',{...input,amount:101})).rejects.toThrow('불확실');expect(m.call).toHaveBeenCalledTimes(1);
 localStorage.setItem(key,JSON.stringify({fingerprint:'missing',operationId:'legacy-op',revision:2}));await expect(recordPartnerPayment('taebaek',input)).rejects.toThrow('불확실');expect(m.call).toHaveBeenCalledTimes(1);});
it('손상 pending은 보존한다',async()=>{localStorage.setItem(key,'{bad');await expect(recordPartnerPayment('taebaek',input)).rejects.toThrow('기록');expect(localStorage.getItem(key)).toBe('{bad');});
it('호출 전 회사 claim 변경은 쓰기를 시작하지 않는다',async()=>{m.token.mockResolvedValueOnce({claims:{companyId:'taebaek',isAdmin:true}}).mockResolvedValueOnce({claims:{companyId:'punghoe',isAdmin:true}});
 await expect(recordPartnerPayment('taebaek',input)).rejects.toThrow('권한');expect(m.call).not.toHaveBeenCalled();});
it('동시 클릭은 하나의 요청만 시작한다',async()=>{let resolve!:any;m.call.mockImplementationOnce(r=>new Promise(done=>{resolve=()=>done({data:{status:'applied',id:r.operationId}});}));
 const first=recordPartnerPayment('taebaek',input);await vi.waitFor(()=>expect(m.call).toHaveBeenCalledTimes(1));await expect(recordPartnerPayment('taebaek',input)).rejects.toThrow('처리 중');resolve();await first;});
it('잘못된 성공 응답은 pending을 보존한다',async()=>{m.call.mockResolvedValueOnce({data:{status:'applied',id:'wrong'}});await expect(recordPartnerPayment('taebaek',input)).rejects.toThrow('응답');expect(localStorage.length).toBe(1);});
for(const bad of [{tradeDate:'2026-02-30'},{amount:0},{amount:Number.MAX_SAFE_INTEGER+1},{note:'x'.repeat(501)},{partnerId:'a/b'},{allocations:[{statementId:'s',amount:1},{statementId:'s',amount:1}]}])
 it(`입력 거절은 pending 전 ${JSON.stringify(bad).slice(0,50)}`,async()=>{await expect(recordPartnerPayment('taebaek',{...input,...bad})).rejects.toThrow('입력');expect(localStorage.length).toBe(0);expect(m.call).not.toHaveBeenCalled();});
it('v2 pending request 누락은 사용자 오류와 원문 보존/call0',async()=>{const saved=JSON.stringify({version:2,fingerprint:'missing-request'});localStorage.setItem(key,saved);
 await expect(recordPartnerPayment('taebaek',input)).rejects.toThrow('이전 수금 결과가 불확실');expect(localStorage.getItem(key)).toBe(saved);expect(m.call).not.toHaveBeenCalled();expect(m.read).not.toHaveBeenCalled();});
