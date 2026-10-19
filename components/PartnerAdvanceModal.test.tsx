// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PartnerAdvanceModal from './PartnerAdvanceModal';
import type {AdvanceRecoveryEntry,AdvanceRecoveryOutcome,AdvanceRecoveryScope,PendingPartnerAdvance} from '../src/features/statements/infrastructure/partnerAdvanceCommands';
const api = vi.hoisted(() => ({ advanceRead:vi.fn(),advanceResolve:vi.fn(),advanceRetry:vi.fn(),advanceDiscard:vi.fn(),advanceHistory:vi.fn(),authListeners:new Set<(user:{uid:string}|null)=>void>(), prepare: vi.fn(), apply: vi.fn(), cancel: vi.fn(), pending: vi.fn(), confirm: vi.fn(), user: { uid: 'admin' } }));
vi.mock('../src/shared/firebase', () => ({ auth: { currentUser: api.user }, authReady: Promise.resolve() }));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,listener:(user:{uid:string}|null)=>void)=>{api.authListeners.add(listener);listener(api.user);return()=>api.authListeners.delete(listener);}}));
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: api.confirm }));
vi.mock('../src/features/statements/infrastructure/partnerAdvanceCommands', async importOriginal => ({...await importOriginal<typeof import('../src/features/statements/infrastructure/partnerAdvanceCommands')>(),preparePartnerAdvance:api.prepare,applyPartnerAdvance:api.apply,cancelPartnerAdvance:api.cancel,readPendingPartnerAdvance:api.pending,partnerAdvanceRecovery:{read:(...args:unknown[])=>api.advanceRead(...args),persist:vi.fn(),resolve:(...args:unknown[])=>api.advanceResolve(...args),retry:(...args:unknown[])=>api.advanceRetry(...args),discard:(...args:unknown[])=>api.advanceDiscard(...args),list:(...args:unknown[])=>api.advanceHistory(...args),submit:mockAdvanceSubmit}}));

const advanceUnknown=():AdvanceRecoveryOutcome=>({terminal:false,outcome:{status:'unknown',message:'상계 결과를 확인하지 못했습니다.',nextAction:'같은 요청 결과를 확인하거나 미처리 요청을 중단해 주세요.'}});
function advanceEntry(request:PendingPartnerAdvance):AdvanceRecoveryEntry {
 const reference={companyId:request.companyId,partnerId:request.input.partnerId,operationId:request.input.operationId};
 return {key:'advance-old',bodyText:JSON.stringify(request),sidecarKey:null,sidecarText:null,reference,request,requestHash:'a'.repeat(64),sidecarHash:null,status:'valid',description:'보관된 상계 원문'};
}
async function mockAdvanceSubmit(scope:AdvanceRecoveryScope,request:PendingPartnerAdvance,current:()=>boolean):Promise<AdvanceRecoveryOutcome> {
 try {
  if(request.action==='apply')await api.apply(scope.companyId,request.input);else await api.cancel(scope.companyId,request.input);
  if(!current())return advanceUnknown();api.pending.mockReturnValue(null);
  return {terminal:true,outcome:{status:'saved'},serverResult:{version:1,reference:{companyId:scope.companyId,partnerId:scope.partnerId,operationId:request.input.operationId},actorId:scope.actorId,status:'applied',action:request.action,requestHash:'a'.repeat(64),statementId:'applied-statement',docNo:'applied-doc',message:'상계 처리를 확인했습니다.'}};
 }catch{return advanceUnknown();}
}
function resetAdvanceRecoveryMocks(){
 api.advanceRead.mockReset().mockImplementation(async(scope:AdvanceRecoveryScope)=>{const request=api.pending(scope.companyId) as PendingPartnerAdvance|null;return request?.input.partnerId===scope.partnerId?[advanceEntry(request)]:[];});
 api.advanceResolve.mockReset().mockImplementation(async(scope:AdvanceRecoveryScope,entry:AdvanceRecoveryEntry,mode:string)=>{if(mode!=='stop')return advanceUnknown();api.pending.mockReturnValue(null);return {terminal:true,outcome:{status:'cancelled',message:'미처리 상계 요청 중단을 확인했습니다.'},serverResult:{version:1,reference:entry.reference,actorId:scope.actorId,status:'cancelled',requestHash:null,message:'미처리 상계 요청 중단을 확인했습니다.'}};});
 api.advanceRetry.mockReset().mockImplementation(async(scope:AdvanceRecoveryScope,entry:AdvanceRecoveryEntry,current:()=>boolean)=>entry.request?mockAdvanceSubmit(scope,entry.request,current):advanceUnknown());
 api.advanceDiscard.mockReset().mockImplementation(async()=>{api.pending.mockReturnValue(null);api.advanceRead.mockResolvedValue([]);return {status:'cleared',message:'상계 기기 사본만 정리했습니다.'};});
 api.advanceHistory.mockReset().mockResolvedValue({entries:[],nextCursor:null});
}
const source = (id: string, date: string, remaining: number, code = '133') => ({ key: { collection: 'cashEntries', id, lineKey: code }, code, originalAmount: remaining, remaining, date, docNo: id, note: '', fingerprint: id.repeat(64).slice(0, 64) });
const target = (id: string, date: string, remaining: number, accountCode = '251') => ({ statementId: id, accountCode, remaining, date, docNo: id, fingerprint: id.repeat(64).slice(0, 64) });
const prepared = () => ({ enabled: true, revision: 7, releaseId: 'release', sources: [source('new', '2026-10-06', 50), source('old', '2026-09-01', 300)], targets: [target('recent', '2026-10-07', 1000), target('earliest', '2026-09-02', 200), target('sale', '2026-08-01', 100, '108')], applications: [], diagnostics: [] });
beforeEach(() => { vi.clearAllMocks();resetAdvanceRecoveryMocks(); api.prepare.mockResolvedValue(prepared()); api.pending.mockReturnValue(null); api.confirm.mockResolvedValue(true); api.apply.mockResolvedValue({ status: 'applied', id: 'result', docNo: 'result' }); });
afterEach(cleanup);
const open = () => render(<PartnerAdvanceModal companyId="taebaek" partnerId="partner" partnerName="거래처" onClose={vi.fn()} />);
describe('선급·선수 적용 확인', () => {
  it('오래된 호환 내역과 미결 전표를 기본 선택하고 확인 전에는 저장하지 않는다', async () => {
    open(); await waitFor(() => expect(screen.getByLabelText('미리 지급하거나 받은 내역')).toHaveValue('old:133'));
    expect(screen.getByLabelText('갚을 전표')).toHaveValue('earliest:251'); expect(screen.getByLabelText('적용 금액')).toHaveValue('200');
    expect(api.apply).not.toHaveBeenCalled(); expect(screen.queryByRole('option', { name: /sale/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '확인하고 적용' }));
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith('taebaek', expect.objectContaining({ source: expect.objectContaining({ id: 'old' }), statementId: 'earliest', amount: 200, expectedRevision: 7, expectedSourceFingerprint: prepared().sources[1].fingerprint, expectedTargetFingerprint: prepared().targets[1].fingerprint })));
  });
  it('다른 전표 선택과 금액 수정이 가능하고 확인 취소 시 쓰지 않는다', async () => {
    open(); await waitFor(() => expect(screen.getByLabelText('갚을 전표')).toHaveValue('earliest:251'));
    fireEvent.change(screen.getByLabelText('갚을 전표'), { target: { value: 'recent:251' } }); expect(screen.getByLabelText('적용 금액')).toHaveValue('300');
    fireEvent.change(screen.getByLabelText('적용 금액'), { target: { value: '150' } }); api.confirm.mockResolvedValue(false);
    fireEvent.click(screen.getByRole('button', { name: '확인하고 적용' })); await waitFor(() => expect(api.confirm).toHaveBeenCalled()); expect(api.apply).not.toHaveBeenCalled();
  });
  it('잔액 초과를 바로잡은 뒤 정상 적용할 수 있다', async () => {
    open(); await waitFor(() => expect(screen.getByLabelText('적용 금액')).toHaveValue('200'));
    fireEvent.change(screen.getByLabelText('적용 금액'), { target: { value: '201' } }); fireEvent.click(screen.getByRole('button', { name: '확인하고 적용' }));
    expect((await screen.findAllByRole('alert')).some(row => row.textContent?.includes('남은 금액'))).toBe(true); expect(api.apply).not.toHaveBeenCalled();
    expect(screen.getByLabelText('적용 금액')).not.toBeDisabled(); fireEvent.change(screen.getByLabelText('적용 금액'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '확인하고 적용' })); await waitFor(() => expect(api.apply).toHaveBeenCalled());
  });
  it('결과 불명 요청은 새 선택을 잠그고 보존된 원문으로 재시도한다', async () => {
    const input = { operationId: 'same', partnerId: 'partner', date: '2026-10-08', source: { collection: 'cashEntries', id: 'old', lineKey: '133' }, statementId: 'earliest', accountCode: '251', amount: 77, expectedRevision: 7, releaseId: 'release', expectedSourceFingerprint: 'a'.repeat(64), expectedTargetFingerprint: 'b'.repeat(64) };
    api.pending.mockReturnValue({ version: 1, companyId: 'taebaek', actorId: 'admin', action: 'apply', input }); open();
    const retry = await screen.findByRole('button', { name: '같은 상계 요청 재시도' });
    expect(screen.getByLabelText('적용 금액')).toBeDisabled();
    fireEvent.click(retry);
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith('taebaek', input)); expect(api.confirm).not.toHaveBeenCalled();
  });
  it('활성화되지 않은 회사는 적용을 허용하지 않는다', async () => {
    api.prepare.mockResolvedValue({ ...prepared(), enabled: false, blockedReason: '준비 중' }); open();
    await screen.findByText('준비 중'); expect(screen.getByRole('button', { name: '확인하고 적용' })).toBeDisabled(); expect(api.apply).not.toHaveBeenCalled();
  });
  it('적용 취소는 원 적용을 지정하고 확인 뒤 별도 취소 요청으로 보낸다', async () => {
    api.prepare.mockResolvedValue({ ...prepared(), applications: [{ statementId: 'application', date: '2026-10-08', docNo: 'apply-001', amount: 200, source: { collection: 'cashEntries', id: 'old', lineKey: '133' }, targetStatementId: 'earliest' }] });
    api.cancel.mockResolvedValue({ status: 'applied', id: 'cancel', docNo: 'cancel-001' }); open();
    fireEvent.click(await screen.findByRole('button', { name: '적용 취소' }));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('taebaek', expect.objectContaining({ applicationStatementId: 'application', partnerId: 'partner', expectedRevision: 7, reason: expect.any(String) })));
    expect(api.apply).not.toHaveBeenCalled(); expect(api.confirm).toHaveBeenCalledWith(expect.stringContaining('apply-001'));
  });
});

it('embedded는중첩모달없이표시하며외부현금처리중상계송신을막는다',async()=>{render(<PartnerAdvanceModal companyId="taebaek" partnerId="partner" partnerName="거래처" embedded externalBusy onClose={vi.fn()}/>);await screen.findByLabelText('적용 금액');expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByRole('button',{name:'확인하고 적용'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'확인하고 적용'}));expect(api.apply).not.toHaveBeenCalled();});

it('결과 확인은 조회만 하고 미처리 중단은 완료 역분개를 호출하지 않는다',async()=>{
 const request:PendingPartnerAdvance={version:1,companyId:'taebaek',actorId:'admin',action:'apply',input:{operationId:'old-op',partnerId:'partner',date:'2026-10-01',source:{collection:'cashEntries',id:'old',lineKey:'133'},statementId:'earliest',accountCode:'251',amount:30,expectedRevision:7,releaseId:'release',expectedSourceFingerprint:'a'.repeat(64),expectedTargetFingerprint:'b'.repeat(64)}};
 api.pending.mockReturnValue(request);open();
 fireEvent.click(await screen.findByRole('button',{name:'상계 결과 확인'}));
 await waitFor(()=>expect(api.advanceResolve).toHaveBeenCalledWith(expect.any(Object),expect.objectContaining({request}),'inspect',expect.any(Function)));
 expect(api.apply).not.toHaveBeenCalled();expect(api.cancel).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'미처리 상계 요청 중단'}));
 await waitFor(()=>expect(api.advanceResolve).toHaveBeenLastCalledWith(expect.any(Object),expect.objectContaining({request}),'stop',expect.any(Function)));
 expect(api.cancel).not.toHaveBeenCalled();
});
it('빈 이력 페이지도 다음 커서를 그대로 전달하며 이력 조회로 상계를 보내지 않는다',async()=>{
 api.advanceHistory.mockResolvedValueOnce({entries:[],nextCursor:'opaque_cursor'}).mockResolvedValue({entries:[],nextCursor:null});open();
 fireEvent.click(await screen.findByRole('button',{name:'서버 상계 이력 조회'}));
 fireEvent.click(await screen.findByRole('button',{name:'다음 상계 이력 확인'}));
 await waitFor(()=>expect(api.advanceHistory).toHaveBeenLastCalledWith(expect.any(Object),'opaque_cursor',expect.any(Function)));
 expect(api.apply).not.toHaveBeenCalled();expect(api.cancel).not.toHaveBeenCalled();
});

it('명시 사본 정리는 표시한 body와 sidecar 관측값을 전달하고 금융 처리나 닫기를 하지 않는다',async()=>{
 const entry:AdvanceRecoveryEntry={key:'damaged',bodyText:'손상된 원문 A',sidecarKey:'ref-key',sidecarText:'관측 참조 A',reference:{companyId:'taebaek',partnerId:'partner',operationId:'damaged-op'},request:null,requestHash:null,sidecarHash:'a'.repeat(64),status:'corrupt',description:'손상 사본'};
 api.advanceRead.mockResolvedValue([entry]);const close=vi.fn();render(<PartnerAdvanceModal companyId="taebaek" partnerId="partner" partnerName="거래처" onClose={close}/>);
 fireEvent.click(await screen.findByRole('button',{name:'상계 기기 사본만 정리'}));
 await waitFor(()=>expect(api.advanceDiscard).toHaveBeenCalledWith(expect.any(Object),entry,expect.any(Function)));
 expect(close).not.toHaveBeenCalled();expect(api.apply).not.toHaveBeenCalled();expect(api.cancel).not.toHaveBeenCalled();
});
it('번호 없는 원문은 가짜 조회나 중단 없이 원문과 명시 기기 정리만 제공한다',async()=>{
 api.advanceRead.mockResolvedValue([{key:'unidentified',bodyText:'번호 없는 원문',sidecarKey:null,sidecarText:null,reference:null,request:null,requestHash:null,sidecarHash:null,status:'corrupt',description:'식별 불가 사본'}]);open();
 await screen.findByText('식별 불가 사본');expect(screen.queryByRole('button',{name:'상계 결과 확인'})).toBeNull();expect(screen.queryByRole('button',{name:'미처리 상계 요청 중단'})).toBeNull();
 expect(screen.getByRole('button',{name:'식별 불가 상계 사본만 정리'})).toBeEnabled();expect(screen.getByLabelText('식별 불가 사본 보관 원문')).toHaveValue('번호 없는 원문');expect(api.advanceResolve).not.toHaveBeenCalled();
});
it('로컬 원문 없는 이력의 미처리 중단은 정확한 이력 ref만 쓰고 금융 역분개를 하지 않는다',async()=>{
 const result={version:1,reference:{companyId:'taebaek',partnerId:'partner',operationId:'history-pending'},actorId:'admin',status:'unknown',requestHash:null,message:'서버 처리 미확인'};
 api.advanceHistory.mockResolvedValue({entries:[result],nextCursor:null});open();fireEvent.click(await screen.findByRole('button',{name:'서버 상계 이력 조회'}));
 fireEvent.click(await screen.findByRole('button',{name:'이력 미처리 요청 중단'}));
 await waitFor(()=>expect(api.advanceResolve).toHaveBeenCalledWith(expect.any(Object),expect.objectContaining({reference:result.reference,request:null}),'stop',expect.any(Function)));
 expect(api.apply).not.toHaveBeenCalled();expect(api.cancel).not.toHaveBeenCalled();
});
