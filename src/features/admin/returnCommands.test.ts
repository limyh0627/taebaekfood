import { webcrypto,createHash } from 'node:crypto';
import {returnBusinessText} from '../../shared/returnBusinessEvidence';
/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ call: vi.fn(), get: vi.fn(), user: { uid: 'u', getIdTokenResult: vi.fn() }, auth: { currentUser: null as unknown } }));
vi.mock('../../shared/firebase', () => ({ auth: m.auth, authReady: Promise.resolve(), db: {}, functions: {} }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, group: string, id: string) => ({ group, id }), getDoc: m.get }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => m.call }));
vi.mock('../../shared/day', () => ({ today: () => '2026-10-07' }));
import { processReturn,hasPendingReturn,resumePendingReturn } from './returnCommands';
import type { ReturnRequest } from '../../shared/types';
const request = { id: 'r', companyId: 'taebaek', partnerId: 'p', partnerName: '합성 거래처', createdAt: '2026-10-07T00:00:00Z', linkedStatementId: 's', returnType: '매입', totalAmount: 110,
  items: [{ itemId: 'box', name: '박스', quantity: 1, price: 110, reason: '기타', isResellable: false }], status: 'pending' } as ReturnRequest;
const firstId = 'return-11111111-1111-4111-8111-111111111111';
const result = { data: { status: 'applied', docNo: '반품-261007-001', journalId: `return-${firstId}`,companyId:'taebaek',operationId:firstId,returnRequestId:'r' } };
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); m.auth.currentUser = m.user;
  vi.stubGlobal('crypto', { subtle:webcrypto.subtle, randomUUID: vi.fn().mockReturnValueOnce(firstId.slice(7)).mockReturnValue('22222222-2222-4222-8222-222222222222') });
  m.user.getIdTokenResult.mockResolvedValue({ claims: { isAdmin: true, companyId: 'taebaek' } });
  m.get.mockImplementation(({ id }) => Promise.resolve({ exists: () => true, data: () => id === 'releaseCutover' ? { status: 'active', releaseId: 'release-A' } : { revision: 7 } }));
  m.call.mockResolvedValue(result);
});
describe('반품 명령 wrapper', () => {
  it('이전 버전의 고정 ID pending도 원문 그대로 재시도한다', async () => {
    const fingerprint = JSON.stringify({ companyId: 'taebaek', linkedStatementId: request.linkedStatementId,
      partnerId: request.partnerId, returnType: request.returnType, totalAmount: request.totalAmount, items: request.items });
    const command = { operationId: 'return-r', returnRequestId: 'r', tradeDate: '2026-10-06',
      expectedPartnerRevision: 3, releaseId: 'old-release' };
    localStorage.setItem('return-pending:taebaek:r:u', JSON.stringify({ version: 1, fingerprint, command }));
    m.get.mockRejectedValue(new Error('새 조회 금지'));
    m.call.mockResolvedValue({ data: { status: 'duplicate', docNo: '반품-261006-001', journalId: 'return-return-r' } });
    await processReturn('taebaek', request);
    expect(m.call).toHaveBeenCalledExactlyOnceWith(command);
    expect(localStorage.length).toBe(0);
  });
  it('회사 관리자 인증 후 전체 계약을 한 callable로 보내고 성공만 pending을 지운다', async () => {
    await processReturn('taebaek', request);
    expect(m.call).toHaveBeenCalledExactlyOnceWith({ operationId: firstId, returnRequestId: 'r', tradeDate: '2026-10-07', expectedPartnerRevision: 7, releaseId: 'release-A',expectedBusinessHash:expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(m.call.mock.calls[0][0].expectedBusinessHash).toBe(createHash('sha256').update(returnBusinessText(request)).digest('hex'));
    expect(localStorage.length).toBe(0);
  });
  it('응답 유실 후 revision/release가 바뀌어도 payload를 그대로 재전송한다', async () => {
    m.call.mockRejectedValueOnce(new Error('timeout')); await expect(processReturn('taebaek', request)).rejects.toThrow('timeout');
    const first = m.call.mock.calls[0][0]; m.get.mockRejectedValue(new Error('새 조회 금지'));
    m.call.mockResolvedValue({ data: { ...result.data, status: 'duplicate' } });
    await processReturn('taebaek', request); expect(m.call.mock.calls[1][0]).toEqual(first); expect(localStorage.length).toBe(0);
  });
  it('불확실 pending에 바뀐 본문·손상 기록·틀린 응답을 새 요청으로 덮어쓰지 않는다', async () => {
    m.call.mockRejectedValueOnce(new Error('timeout')); await expect(processReturn('taebaek', request)).rejects.toThrow();
    const before = localStorage.getItem('return-pending:taebaek:r:u');
    await expect(processReturn('taebaek', { ...request, totalAmount: 111 })).rejects.toThrow('이전 반품');
    expect(m.call).toHaveBeenCalledTimes(1); expect(localStorage.getItem('return-pending:taebaek:r:u')).toBe(before);
    m.call.mockResolvedValue({ data: { ...result.data, journalId: 'other' } });
    await expect(processReturn('taebaek', request)).rejects.toThrow('응답'); expect(localStorage.length).toBe(1);
    localStorage.setItem('return-pending:taebaek:r:u', '{broken');
    await expect(processReturn('taebaek', request)).rejects.toThrow('저장된'); expect(localStorage.getItem('return-pending:taebaek:r:u')).toBe('{broken');
  });
  it('중복 처리와 직원/회사/UID 변경을 차단하며 실패 pending은 보존한다', async () => {
    let resolve!: (value: typeof result) => void; m.call.mockImplementation(() => new Promise(done => { resolve = done; }));
    const first = processReturn('taebaek', request); await vi.waitFor(() => expect(m.call).toHaveBeenCalledOnce());
    await expect(processReturn('taebaek', request)).rejects.toThrow('처리 중'); resolve(result); await first;
    m.user.getIdTokenResult.mockResolvedValue({ claims: { isAdmin: false, companyId: 'taebaek' } });
    await expect(processReturn('taebaek', request)).rejects.toThrow('회사 권한');
    m.user.getIdTokenResult.mockResolvedValue({ claims: { isAdmin: true, companyId: 'punghoe' } });
    await expect(processReturn('taebaek', request)).rejects.toThrow('회사 권한');
    m.user.getIdTokenResult.mockImplementation(async () => { m.auth.currentUser = { uid: 'other' }; return { claims: { isAdmin: true, companyId: 'taebaek' } }; });
    m.auth.currentUser = m.user; await expect(processReturn('taebaek', request)).rejects.toThrow('회사 권한');
  });
  it('서버의 확정 거절 원문을 확인한 경우만 요청을 풀고 새 revision과 ID로 재시도한다', async () => {
    const failure = { code: 'functions/failed-precondition', details: { operationStatus: 'rejected', companyId: 'taebaek',
      operationId: firstId, returnRequestId: 'r', requestHash: 'hash' } };
    m.call.mockRejectedValueOnce(failure);
    const originalGet = m.get.getMockImplementation()!;
    m.get.mockImplementation((ref) => ref.group === 'returnOperations'
      ? Promise.resolve({ exists: () => true, data: () => ({ status: 'rejected', companyId: 'taebaek', createdBy: 'u',
        operationId: firstId,
        returnRequestId: 'r', requestHash: 'hash', failureCode: 'failed-precondition', command: m.call.mock.calls[0][0] }) })
      : originalGet(ref));
    await expect(processReturn('taebaek', request)).rejects.toEqual(failure);
    expect(localStorage.length).toBe(0);
    m.call.mockImplementation(async command => ({ data: { ...result.data, journalId: `return-${command.operationId}`,operationId:command.operationId } }));
    await processReturn('taebaek', { ...request, totalAmount: 220 });
    expect(m.call.mock.calls[1][0].operationId).not.toBe(firstId);
  });
  it('거절 문구만 있거나 감사 읽기에 실패하면 불확실 요청을 그대로 보존한다', async () => {
    const failure = { code: 'functions/failed-precondition', details: { operationStatus: 'rejected', companyId: 'taebaek',
      operationId: firstId, returnRequestId: 'r', requestHash: 'hash' } };
    m.call.mockRejectedValue(failure);
    const originalGet = m.get.getMockImplementation()!;
    m.get.mockImplementation(ref => ref.group === 'returnOperations' ? Promise.reject(new Error('offline')) : originalGet(ref));
    await expect(processReturn('taebaek', request)).rejects.toEqual(failure);
    expect(localStorage.length).toBe(1);
    m.call.mockRejectedValue({ code: 'functions/failed-precondition' });
    await expect(processReturn('taebaek', request)).rejects.toBeDefined();
    expect(localStorage.length).toBe(1);
  });
  it('거절 감사 조회 중 사용자가 바뀌거나 감사 명령에 다른 필드가 있으면 pending을 보존한다', async () => {
    const failure = { code: 'functions/failed-precondition', details: { operationStatus: 'rejected', companyId: 'taebaek',
      operationId: firstId, returnRequestId: 'r', requestHash: 'hash' } };
    m.call.mockRejectedValue(failure);
    const originalGet = m.get.getMockImplementation()!;
    let switchUser = true;
    m.get.mockImplementation(async ref => {
      if (ref.group !== 'returnOperations') return originalGet(ref);
      if (switchUser) m.auth.currentUser = { uid: 'other' };
      return { exists: () => true, data: () => ({ status: 'rejected', companyId: 'taebaek', createdBy: 'u',
        operationId: firstId, returnRequestId: 'r', requestHash: 'hash', failureCode: 'failed-precondition',
        command: { ...m.call.mock.calls[0][0], ...(!switchUser ? { extra: true } : {}) } }) };
    });
    await expect(processReturn('taebaek', request)).rejects.toEqual(failure);
    expect(localStorage.length).toBe(1);
    switchUser = false; m.auth.currentUser = m.user;
    await expect(processReturn('taebaek', request)).rejects.toEqual(failure);
    expect(localStorage.length).toBe(1);
  });
});

it('standalone 신규 승인 원문을 저장하고 처리완료 뒤 보존 명령으로 재개한다',async()=>{
 const standalone={...request,linkedStatementId:undefined,payableAccountCode:'253'} as ReturnRequest;
 m.call.mockRejectedValueOnce(Error('timeout'));await expect(processReturn('taebaek',standalone)).rejects.toThrow('timeout');
 const original=m.call.mock.calls[0][0];expect(original.expectedBusinessHash).toMatch(/^[a-f0-9]{64}$/);expect(hasPendingReturn('taebaek','r')).toBe(true);
 m.get.mockRejectedValue(Error('재조회 금지'));m.call.mockResolvedValue({data:{...result.data,status:'duplicate'}});
 await resumePendingReturn('taebaek','r');expect(m.call.mock.calls[1][0]).toEqual(original);expect(localStorage.length).toBe(0);
});
it('성공 응답 중 UID 변경 또는 정리 실패는 최초 승인 명령을 보존한다',async()=>{
 m.call.mockImplementationOnce(async()=>{m.auth.currentUser={uid:'other'};return result;});await expect(processReturn('taebaek',request)).rejects.toThrow('회사 권한');expect(localStorage.length).toBe(1);
 m.auth.currentUser=m.user;const remove=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw Error('정리 실패');});
 try{await expect(resumePendingReturn('taebaek','r')).rejects.toThrow('정리 실패');expect(localStorage.length).toBe(1);}finally{remove.mockRestore();}
 await resumePendingReturn('taebaek','r');expect(localStorage.length).toBe(0);
});
it('최초 승인 영속 저장 실패는 callable 전에 멈춘다',async()=>{
 const set=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('공간 부족');});try{await expect(processReturn('taebaek',request)).rejects.toThrow('공간 부족');expect(m.call).not.toHaveBeenCalled();}finally{set.mockRestore();}
});

it('v2 map 순서 변경은 같은 승인 해시로 재개하고 행/계정 변경은 거절한다',async()=>{
 m.call.mockRejectedValueOnce(Error('timeout'));await expect(processReturn('taebaek',request)).rejects.toThrow('timeout');const original=m.call.mock.calls[0][0];
 const row=request.items[0];const reordered={...request,items:[Object.fromEntries(Object.entries(row).reverse())]} as ReturnRequest;
 await processReturn('taebaek',reordered);expect(m.call.mock.calls[1][0]).toEqual(original);
 const standalone={...request,linkedStatementId:undefined,payableAccountCode:'251'} as ReturnRequest;m.call.mockRejectedValueOnce(Error('timeout'));await expect(processReturn('taebaek',standalone)).rejects.toThrow();
 const stored=localStorage.getItem('return-pending:taebaek:r:u');await expect(processReturn('taebaek',{...standalone,payableAccountCode:'253'} as ReturnRequest)).rejects.toThrow('이전 반품');expect(localStorage.getItem('return-pending:taebaek:r:u')).toBe(stored);
});
it('손상 pending과 다른 scope 응답은 보존하여 새 요청으로 대체하지 않는다',async()=>{
 localStorage.setItem('return-pending:taebaek:r:u','{}');expect(()=>hasPendingReturn('taebaek','r')).toThrow('저장된');expect(localStorage.getItem('return-pending:taebaek:r:u')).toBe('{}');
 localStorage.clear();m.call.mockResolvedValue({data:{...result.data,companyId:'punghoe'}});await expect(processReturn('taebaek',request)).rejects.toThrow('회사·요청');expect(localStorage.length).toBe(1);
});
it('최초 준비 조회 중 다른 탭 요청이 생기면 원문을 덮지 않고 callable을 실행하지 않는다',async()=>{
 let finish!:(value:any)=>void;const release=new Promise(resolve=>{finish=resolve;});const original=m.get.getMockImplementation()!;
 m.get.mockImplementation(ref=>ref.id==='releaseCutover'?release:original(ref));
 const running=processReturn('taebaek',request);await vi.waitFor(()=>expect(m.get).toHaveBeenCalled());
 const other=JSON.stringify({version:1,fingerprint:'다른 화면 최초 원문',command:{operationId:'return-other'}});localStorage.setItem('return-pending:taebaek:r:u',other);
 finish({exists:()=>true,data:()=>({status:'active',releaseId:'release-A'})});await expect(running).rejects.toThrow('다른 화면');
 expect(m.call).not.toHaveBeenCalled();expect(localStorage.getItem('return-pending:taebaek:r:u')).toBe(other);
});
it('빈 문자열 손상 key도 없는 요청으로 오인하거나 새 승인으로 덮지 않는다',async()=>{
 const key='return-pending:taebaek:r:u';localStorage.setItem(key,'');
 expect(()=>hasPendingReturn('taebaek','r')).toThrow('저장된');await expect(resumePendingReturn('taebaek','r')).rejects.toThrow('저장된');
 await expect(processReturn('taebaek',request)).rejects.toThrow('저장된');expect(m.get).not.toHaveBeenCalled();expect(m.call).not.toHaveBeenCalled();expect(localStorage.getItem(key)).toBe('');
});
