/** @vitest-environment jsdom */
import {webcrypto} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
import {cashOriginalHash} from '../../../../functions/src/cashMutationReceipt';
import type {TaxIssueCommand} from './applyTaxIssueWrites';
const m=vi.hoisted(()=>({call:vi.fn(),user:{uid:'uid',getIdTokenResult:vi.fn()}}));
vi.mock('../../../shared/firebase',()=>({auth:{get currentUser(){return m.user;}},authReady:Promise.resolve(),functions:{}}));
vi.mock('firebase/functions',()=>({httpsCallable:()=>m.call}));
import {applyTaxIssueWrites,getPendingTaxIssue,resumeTaxIssue,taxIssueRequestHash} from './applyTaxIssueWrites';
const body:TaxIssueCommand={companyId:'taebaek',operationId:'tax-test',scope:'all',issuedAt:'2026-10-09T00:00:00Z',statements:[{id:'statement',companyId:'taebaek',docNo:'261008-001',type:'매출',partnerId:'p',partnerName:'합성',orderId:'',tradeDate:'2026-10-08',issuedAt:'2026-10-08T00:00:00Z',totalSupply:100,totalTax:10,totalAmount:110,items:[{name:'품목',spec:'',qty:1,price:100,supply:100,tax:10,total:110,isTaxExempt:false}]}]};
const key='tax-issue:taebaek:uid';
const reply=(command:TaxIssueCommand)=>({data:{status:'duplicate',companyId:command.companyId,operationId:command.operationId,actorId:'uid',requestHash:cashOriginalHash(command),statementPatches:[{id:'statement',data:{taxIssuedAt:command.issuedAt,mutationRevision:(command.statements[0].mutationRevision??0)+1}}]}});
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);localStorage.clear();m.call.mockReset();m.user.uid='uid';m.user.getIdTokenResult.mockReset().mockResolvedValue({claims:{companyId:'taebaek',isAdmin:true}});});
it('unknown는 같은 전체 원문·발행시각·요청번호로 재개하고 변경원문은 보내지 않는다',async()=>{
 m.call.mockRejectedValueOnce(new Error('unknown'));await expect(applyTaxIssueWrites(body)).rejects.toThrow('unknown');
 await expect(applyTaxIssueWrites({...body,issuedAt:'2026-10-10T00:00:00Z'})).rejects.toThrow('이전');expect(m.call).toHaveBeenCalledOnce();
 m.call.mockImplementationOnce(reply);await resumeTaxIssue('taebaek');expect(m.call.mock.calls[1][0]).toEqual(m.call.mock.calls[0][0]);expect(getPendingTaxIssue('taebaek')).toBeNull();
});
it('terminal proof는 prior unknown도 해제하고 위조 hash는 보존한다',async()=>{
 m.call.mockRejectedValueOnce(new Error('unknown'));await expect(applyTaxIssueWrites(body)).rejects.toThrow();
 const proof={version:1,operationStatus:'rejected',terminalConfirmed:true,financialWrites:false,companyId:'taebaek',operationId:body.operationId,actorId:'uid',requestHash:cashOriginalHash(body)};
 m.call.mockRejectedValueOnce(Object.assign(new Error('rejected'),{details:{...proof,requestHash:'wrong'}}));await expect(resumeTaxIssue('taebaek')).rejects.toThrow();expect(getPendingTaxIssue('taebaek')).not.toBeNull();
 m.call.mockRejectedValueOnce(Object.assign(new Error('rejected'),{details:proof}));await expect(resumeTaxIssue('taebaek')).rejects.toThrow();expect(getPendingTaxIssue('taebaek')).toBeNull();
});
it('빠른 중복은 송신1회·늦은 완료는 다른 창 원문을 지우지 않는다',async()=>{
 let resolve!:(value:unknown)=>void;m.call.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const first=applyTaxIssueWrites(body);await vi.waitFor(()=>expect(m.call).toHaveBeenCalledOnce());
 await expect(resumeTaxIssue('taebaek')).rejects.toThrow('확인 중');const other=JSON.stringify({...body,operationId:'tax-other'});localStorage.setItem(key,other);resolve(reply(body));await first;expect(localStorage.getItem(key)).toBe(other);
});
it('token await 중 UID 변경은 송신0·응답뒤 회사 변경은 보존한다',async()=>{
 let resolve!:(value:unknown)=>void;m.user.getIdTokenResult.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const first=applyTaxIssueWrites(body);await vi.waitFor(()=>expect(m.user.getIdTokenResult).toHaveBeenCalledOnce());m.user.uid='other';resolve({claims:{companyId:'taebaek',isAdmin:true}});await expect(first).rejects.toThrow();expect(m.call).not.toHaveBeenCalled();
 m.user.uid='uid';m.call.mockImplementationOnce(async command=>{m.user.getIdTokenResult.mockResolvedValue({claims:{companyId:'punghoe',isAdmin:true}});return reply(command);});await expect(applyTaxIssueWrites(body)).rejects.toThrow();expect(localStorage.getItem(key)).not.toBeNull();
});
it('손상 원문·불완전 결과는 unknown으로 보존한다',async()=>{
 localStorage.setItem(key,'{');expect(()=>getPendingTaxIssue('taebaek')).toThrow('보존');expect(localStorage.getItem(key)).toBe('{');localStorage.clear();
 m.call.mockResolvedValue({data:{status:'applied'}});await expect(applyTaxIssueWrites(body)).rejects.toThrow('결과');expect(getPendingTaxIssue('taebaek')).not.toBeNull();
});
it('Timestamp와 Date 원문의 hash는 서버 canonical과 동일하다',async()=>{
 const command={...body,statements:body.statements.map(s=>({...s,createdAt:{toMillis:()=>123},otherDate:new Date('2026-10-09')}))};expect(await taxIssueRequestHash(command)).toBe(cashOriginalHash(command));
});

it('정확 requestHash라도 부분 결과나 빈 표시 데이터면 원문을 해제하지 않는다',async()=>{
 const command={...body,statements:[...body.statements,{...body.statements[0],id:'second'}]};
 m.call.mockImplementationOnce(()=>reply(command));await expect(applyTaxIssueWrites(command)).rejects.toThrow('결과');
 const saved=localStorage.getItem(key);expect(saved).not.toBeNull();
 m.call.mockImplementationOnce(()=>({data:{...reply(command).data,statementPatches:[{id:'statement',data:{}},{id:'second',data:{taxIssuedAt:command.issuedAt,mutationRevision:(command.statements[0].mutationRevision??0)+1}}]}}));
 await expect(resumeTaxIssue('taebaek')).rejects.toThrow('결과');expect(localStorage.getItem(key)).toBe(saved);
});
