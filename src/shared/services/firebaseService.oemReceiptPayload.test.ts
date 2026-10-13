/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest';
import type { OemCostEvidence } from '../types';
const m = vi.hoisted(() => ({ call: vi.fn(), callable: vi.fn(), get: vi.fn(),token:vi.fn(),auth:{currentUser:{uid:'uid',getIdTokenResult:async()=>({claims:{companyId:'taebaek',isAdmin:true,employeeId:'employee'}})}} }));
vi.mock('../firebase', () => ({ auth:m.auth, authReady: Promise.resolve(), db: {}, functions: { tag: '함수' } }));
vi.mock('firebase/functions', () => ({ httpsCallable: m.callable }));
vi.mock('firebase/firestore', async importOriginal => ({ ...await importOriginal<typeof import('firebase/firestore')>(), doc: vi.fn(() => ({})), getDoc: m.get }));
import { receiveOemFinishedGoodsCommand } from './firebaseService';
import {readOemReceiptEntry,oemReceiptPacketKey,isOemReceiptPreCallFailure,clearOemReceiptAttempt,markOemReceiptFailure} from '../oemReceiptPending';
const base = { poId: 'po', operationId: 'oem-receive:po', date: '2026-10-13', returns: [{ itemId: '완제품', qty: 7 }], unitPricePerKg: 500 };
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();sessionStorage.clear();m.auth.currentUser.uid='uid';m.token.mockResolvedValue({claims:{companyId:'taebaek',isAdmin:true,employeeId:'employee'}});m.auth.currentUser.getIdTokenResult=m.token;
  const queues=new Map<string,Promise<unknown>>();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(key:string,_options:unknown,work:()=>unknown)=>{const task=(queues.get(key)??Promise.resolve()).catch(()=>{}).then(work);queues.set(key,task);return task;}}});
  m.callable.mockReturnValue(m.call);
  m.get.mockResolvedValue({ data: () => ({ status: 'active', releaseId: 'original-release' }) });
  m.call.mockResolvedValue({ data: { status: 'applied', receivedKg: 7, loss: 0, lotNos: { 완제품: '로트' } } });
});
it('실제 서비스는 선택적 공용 근거와 원래 수량·가격·멱등키·release를 함께 전송한다', async () => {
  const evidence: OemCostEvidence = { version: 1, ownerCompanyId: 'taebaek', rawMaterials: [{ rawItemId: '원료', kg: 100, supplyAmount: 123456 }], packaging: { confirmed: true, supplyAmount: 900 }, capturedAt: '2026-10-13T01:00:00Z' };
  const input = { ...base, oemCostEvidence: evidence };
  const before = JSON.stringify(input);
  expect(await receiveOemFinishedGoodsCommand(input)).toEqual({ status: 'applied', receivedKg: 7, loss: 0, lotNos: { 완제품: '로트' } });
  expect(m.callable).toHaveBeenCalledWith({ tag: '함수' }, 'receiveOemFinishedGoodsCommand');
  expect(m.call).toHaveBeenCalledExactlyOnceWith({ ...base, oemCostEvidence: evidence, releaseId: 'original-release' });
  expect(m.call.mock.calls[0][0].oemCostEvidence).toEqual(evidence);
  expect(JSON.stringify(input)).toBe(before);
});
it('근거 없는 기존 요청도 그대로 보내고 duplicate 응답을 유지한다', async () => {
  m.call.mockResolvedValue({ data: { status: 'duplicate', receivedKg: 7, loss: 0, lotNos: {} } });
  expect((await receiveOemFinishedGoodsCommand(base)).status).toBe('duplicate');
  expect(m.call).toHaveBeenCalledExactlyOnceWith({ ...base, releaseId: 'original-release' });
  expect(Object.hasOwn(m.call.mock.calls[0][0], 'oemCostEvidence')).toBe(false);
});
it('벌크 입고의 최초 홀더 ID와 kg도 기존 멱등키와 같이 전송한다',async()=>{const bulk=[{material:'볶음참깨',kg:100,rawItemId:'raw'}];await receiveOemFinishedGoodsCommand({...base,returns:[],bulk});expect(m.call).toHaveBeenCalledWith({...base,returns:[],bulk,releaseId:'original-release'});expect(m.call.mock.calls[0][0].bulk).toEqual(bulk);});
const scope={companyId:'taebaek' as const,actorUid:'uid',poId:'po'};
it('송신 전에 최초 packet을 고정하고 unknown 재시도에는 새 release를 조회하지 않는다',async()=>{
 const error=Error('응답 유실');m.call.mockImplementationOnce(async()=>{expect(readOemReceiptEntry(scope).packet?.request).toEqual({...base,releaseId:'original-release'});throw error;});
 await expect(receiveOemFinishedGoodsCommand(base,'taebaek','uid')).rejects.toBe(error);
 const original=localStorage.getItem(oemReceiptPacketKey(scope));expect(isOemReceiptPreCallFailure(error,scope)).toBe(false);
 m.get.mockRejectedValue(Error('새 release 조회 금지'));
 await receiveOemFinishedGoodsCommand(base,'taebaek','uid');expect(m.get).toHaveBeenCalledTimes(1);expect(localStorage.getItem(oemReceiptPacketKey(scope))).toBe(original);
 await clearOemReceiptAttempt(readOemReceiptEntry(scope),()=>true);expect(readOemReceiptEntry(scope).packet).toBeNull();
});
it('최초 송신 수량 변경은 호출하지 않고 원문을 보존한다',async()=>{
 m.call.mockRejectedValueOnce(Error('응답 유실'));await expect(receiveOemFinishedGoodsCommand(base)).rejects.toThrow();const text=localStorage.getItem(oemReceiptPacketKey(scope));m.call.mockClear();
 await expect(receiveOemFinishedGoodsCommand({...base,returns:[{itemId:'완제품',qty:8}]})).rejects.toThrow();expect(m.call).not.toHaveBeenCalled();expect(localStorage.getItem(oemReceiptPacketKey(scope))).toBe(text);
});
it('늦은 ACK 전에 계정이 바뀌면 완료 정리 권한을 주지 않는다',async()=>{
 m.call.mockImplementationOnce(async()=>{m.auth.currentUser.uid='other';return {data:{status:'applied',receivedKg:7,loss:0,lotNos:{}}};});await expect(receiveOemFinishedGoodsCommand(base,'taebaek','uid')).rejects.toThrow();m.auth.currentUser.uid='uid';
 await expect(clearOemReceiptAttempt(readOemReceiptEntry(scope),()=>true)).rejects.toThrow('완료 응답');expect(readOemReceiptEntry(scope).packet).not.toBeNull();
});
it('송신 전 확정 오류만 scoped pre-call 증거를 갖는다',async()=>{const error=Error('gate 조회 실패');m.get.mockRejectedValue(error);await expect(receiveOemFinishedGoodsCommand(base)).rejects.toBe(error);expect(isOemReceiptPreCallFailure(error,scope)).toBe(true);expect(m.call).not.toHaveBeenCalled();});
it('회사와 최초 UID 불일치는 송신하지 않는다',async()=>{await expect(receiveOemFinishedGoodsCommand(base,'punghoe','uid')).rejects.toThrow();await expect(receiveOemFinishedGoodsCommand(base,'taebaek','other')).rejects.toThrow();expect(m.call).not.toHaveBeenCalled();});
it('삭제된 unknown도 정확 최초 packet 결과 확인만 허용하고 신규 또는 변경 원문은 차단한다',async()=>{
 m.call.mockRejectedValueOnce(Error('응답 유실'));await expect(receiveOemFinishedGoodsCommand(base)).rejects.toThrow();const entry=readOemReceiptEntry(scope);await markOemReceiptFailure(entry,'미확인',true,()=>true);m.call.mockClear();
 await expect(receiveOemFinishedGoodsCommand(base)).rejects.toThrow('새 입고');await expect(receiveOemFinishedGoodsCommand({...entry.packet!.request,unitPricePerKg:999})).rejects.toThrow('새 입고');expect(m.call).not.toHaveBeenCalled();
 m.call.mockResolvedValue({data:{status:'duplicate',receivedKg:7,loss:0,lotNos:{}}});await receiveOemFinishedGoodsCommand(entry.packet!.request,'taebaek','uid');expect(m.call).toHaveBeenCalledExactlyOnceWith(entry.packet!.request);expect(m.get).toHaveBeenCalledTimes(1);await clearOemReceiptAttempt(readOemReceiptEntry(scope),()=>true);expect(readOemReceiptEntry(scope).packet).toBeNull();
});
