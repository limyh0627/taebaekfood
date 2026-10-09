import {webcrypto} from 'node:crypto';
/** @vitest-environment jsdom */
import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({call:vi.fn(),user:{uid:'u',getIdTokenResult:vi.fn().mockResolvedValue({claims:{companyId:'taebaek',employeeId:'e'}})}}));
vi.mock('../firebase',()=>({auth:{get currentUser(){return m.user;}},authReady:Promise.resolve(),functions:{}}));
vi.mock('firebase/functions',()=>({httpsCallable:()=>m.call}));
import {getPendingReturnSubmission,submitReturnRequest,resumeReturnSubmission,returnSubmissionRequestHash} from './returnRequestSubmission';
const body={companyId:'taebaek',status:'pending',partnerId:'p',partnerName:'합성',returnType:'매출',items:[{itemId:'i',quantity:1}],totalAmount:110};
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);localStorage.clear();m.user.uid='u';m.call.mockReset();});
it('응답 유실은 동일 ID·전체 원문으로 재개하며 정상 응답만 해제한다',async()=>{
 m.call.mockRejectedValueOnce(new Error('연결 유실'));
 await expect(submitReturnRequest('taebaek',body)).rejects.toThrow('연결 유실');
 const pending=getPendingReturnSubmission('taebaek')!;
 await expect(submitReturnRequest('taebaek',{...body,totalAmount:120})).rejects.toThrow('이전');
 m.call.mockImplementationOnce(async input=>({data:{status:'duplicate',requestId:input.requestId,actorId:'u',requestHash:await returnSubmissionRequestHash(input.request)}}));
 await expect(resumeReturnSubmission('taebaek')).resolves.toBe('duplicate');
 expect(m.call.mock.calls[1][0]).toEqual(m.call.mock.calls[0][0]);expect(getPendingReturnSubmission('taebaek')).toBeNull();
 expect(pending.request).toEqual(body);
});
it('동시 클릭과 응답 뒤 UID 변경은 원문을 잃지 않는다',async()=>{
 let resolve!:(value:unknown)=>void;m.call.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 const first=submitReturnRequest('taebaek',body);await vi.waitFor(()=>expect(m.call).toHaveBeenCalledOnce());
 await expect(resumeReturnSubmission('taebaek')).rejects.toThrow('확인 중');
 const input=m.call.mock.calls[0][0];m.user.uid='other';resolve({data:{status:'created',requestId:input.requestId,actorId:'u',requestHash:await returnSubmissionRequestHash(input.request)}});
 await expect(first).rejects.toThrow('로그인');m.user.uid='u';expect(getPendingReturnSubmission('taebaek')).not.toBeNull();
});
it('손상 원문과 다른 요청 결과를 보존한다',async()=>{
 localStorage.setItem('return-submission:taebaek:u','{');expect(()=>getPendingReturnSubmission('taebaek')).toThrow('보존');expect(localStorage.getItem('return-submission:taebaek:u')).toBe('{');
 localStorage.clear();m.call.mockResolvedValue({data:{status:'created',requestId:'wrong',actorId:'u',requestHash:'wrong-hash'}});
 await expect(submitReturnRequest('taebaek',body)).rejects.toThrow('결과');expect(getPendingReturnSubmission('taebaek')).not.toBeNull();
});
it('정확 terminal 거절은 prior unknown도 해제하고 단순 no-write는 보존한다',async()=>{
 const reject=async(input:any)=>{throw Object.assign(new Error('확정 거절'),{details:{version:1,operationStatus:'rejected',receiptStatus:'rejected',terminalConfirmed:true,submissionWrites:false,financialWrites:false,companyId:'taebaek',requestId:input.requestId,actorId:'u',requestHash:await returnSubmissionRequestHash(input.request)}});};
 m.call.mockImplementationOnce(reject);await expect(submitReturnRequest('taebaek',body)).rejects.toThrow('확정 거절');expect(getPendingReturnSubmission('taebaek')).toBeNull();
 m.call.mockRejectedValueOnce(new Error('unknown'));await expect(submitReturnRequest('taebaek',body)).rejects.toThrow('unknown');
 m.call.mockImplementationOnce(reject);
 await expect(resumeReturnSubmission('taebaek')).rejects.toThrow('확정 거절');expect(localStorage.getItem('return-submission:taebaek:u')).toBeNull();
 m.call.mockImplementationOnce(async(input:any)=>{throw Object.assign(new Error('쓰기 전 거절'),{details:{version:1,operationStatus:'rejected',submissionWrites:false,financialWrites:false,companyId:'taebaek',requestId:input.requestId,actorId:'u',requestHash:await returnSubmissionRequestHash(input.request)}});});
 await expect(submitReturnRequest('taebaek',body)).rejects.toThrow('쓰기 전 거절');expect(getPendingReturnSubmission('taebaek')).not.toBeNull();
});
it('틀린 원문 hash 거절은 pending을 해제하지 않는다',async()=>{
 m.call.mockImplementationOnce(async input=>{throw Object.assign(new Error('거절'),{details:{version:1,operationStatus:'rejected',receiptStatus:'rejected',terminalConfirmed:true,submissionWrites:false,financialWrites:false,companyId:'taebaek',requestId:input.requestId,actorId:'u',requestHash:'wrong'}});});
 await expect(submitReturnRequest('taebaek',body)).rejects.toThrow('거절');expect(getPendingReturnSubmission('taebaek')).not.toBeNull();
});

it('짧은 native 원문 선택 잠금은 동일 본문 ID를 재사용하고 네트워크를 잠그지 않는다',async()=>{
 let inside=false;const claim=vi.fn(async(_name:string,run:()=>unknown)=>{inside=true;try{return run();}finally{inside=false;}});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:claim}});
 const replies:Array<()=>Promise<void>>=[];
 m.call.mockImplementation((input:any)=>{expect(inside).toBe(false);return new Promise(resolve=>{replies.push(async()=>resolve({data:{status:'created',requestId:input.requestId,actorId:'u',requestHash:await returnSubmissionRequestHash(input.request)}}));});});
 try {
  const first=submitReturnRequest('taebaek',body);await vi.waitFor(()=>expect(m.call).toHaveBeenCalledTimes(1));
  vi.resetModules();const other=await import('./returnRequestSubmission');
  const second=other.submitReturnRequest('taebaek',body);await vi.waitFor(()=>expect(m.call).toHaveBeenCalledTimes(2));
  expect(m.call.mock.calls[0][0].requestId).toBe(m.call.mock.calls[1][0].requestId);expect(claim).toHaveBeenCalledTimes(2);
  await replies[0]();await replies[1]();await first;await second;expect(localStorage.getItem('return-submission:taebaek:u')).toBeNull();
 }finally{Reflect.deleteProperty(navigator,'locks');}
});
