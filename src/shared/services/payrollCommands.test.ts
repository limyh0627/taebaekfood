import { beforeEach,describe,expect,it,vi } from 'vitest';
const state=vi.hoisted(()=>({claims:{companyId:'taebaek',isAdmin:true},row:{} as Record<string,unknown>,call:vi.fn(),user:{} as any}));
vi.mock('../firebase',()=>({auth:{get currentUser(){return state.user}},authReady:Promise.resolve(),db:{},functions:{}}));
vi.mock('firebase/firestore',()=>({doc:(_db:unknown,collection:string,id:string)=>({collection,id}),getDoc:vi.fn(async(ref:any)=>({data:()=>ref.collection==='appMeta'?{status:'active',releaseId:'test-release'}:state.row}))}));
vi.mock('firebase/functions',()=>({httpsCallable:vi.fn(()=>state.call)}));
import {issuePayrollVoucher,savePayrollDraft} from './payrollCommands';
const input={yearMonth:'2026-10',payDate:'2026-10-25',expectedRevision:3,lines:[{employeeId:'e1',employeeName:'사원',base:100}]};
beforeEach(()=>{vi.clearAllMocks();state.claims={companyId:'taebaek',isAdmin:true};state.row={companyId:'taebaek',revision:7};state.user={uid:'admin',getIdTokenResult:async()=>({claims:state.claims})};state.call.mockResolvedValue({data:{revision:4,id:'fixed',docNo:'급여261025-001',kind:'cashEntries'}});});
describe('급여 원본 버전·응답 유실 경계 후보',()=>{
 it('현재 조회 revision이 높아도 저장은 UI 원본 revision을 전송한다',async()=>{await savePayrollDraft('taebaek',input);expect(state.call).toHaveBeenCalledWith(expect.objectContaining({expectedRevision:3}));});
 it('응답 유실 재시도는 발행 당시 버전과 지급 계좌를 유지한다',async()=>{state.row={companyId:'taebaek',revision:4,issueOperationId:'payroll-taebaek-2026-10-base',issueExpectedRevision:3,issueCashAccountId:'main'};await issuePayrollVoucher('taebaek',{...input,expectedRevision:4},'cash','changed');expect(state.call).toHaveBeenCalledWith(expect.objectContaining({expectedRevision:3,cashAccountId:'main'}));});
 it('기존 무계좌 요청의 재시도 hash 형식을 보존한다',async()=>{state.row={companyId:'taebaek',revision:4,issueOperationId:'payroll-taebaek-2026-10-base',issueExpectedRevision:3};await issuePayrollVoucher('taebaek',input,'cash','new-main');expect(state.call.mock.calls[0][0]).not.toHaveProperty('cashAccountId');});
 it('회사 권한이 다르면 명령을 호출하지 않는다',async()=>{state.claims.companyId='punghoe';await expect(savePayrollDraft('taebaek',input)).rejects.toThrow('회사 권한');expect(state.call).not.toHaveBeenCalled();});
});
