import { beforeEach, expect, it, vi } from 'vitest';
import type { OemCostEvidence } from '../types';
const m = vi.hoisted(() => ({ call: vi.fn(), callable: vi.fn(), get: vi.fn() }));
vi.mock('../firebase', () => ({ auth: { currentUser: { uid: 'uid' } }, authReady: Promise.resolve(), db: {}, functions: { tag: '함수' } }));
vi.mock('firebase/functions', () => ({ httpsCallable: m.callable }));
vi.mock('firebase/firestore', async importOriginal => ({ ...await importOriginal<typeof import('firebase/firestore')>(), doc: vi.fn(() => ({})), getDoc: m.get }));
import { receiveOemFinishedGoodsCommand } from './firebaseService';
const base = { poId: 'po', operationId: 'op', date: '2026-10-13', returns: [{ itemId: '완제품', qty: 7 }], unitPricePerKg: 500 };
beforeEach(() => {
  vi.clearAllMocks();
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
  expect(m.call.mock.calls[0][0].oemCostEvidence).toBe(evidence);
  expect(JSON.stringify(input)).toBe(before);
});
it('근거 없는 기존 요청도 그대로 보내고 duplicate 응답을 유지한다', async () => {
  m.call.mockResolvedValue({ data: { status: 'duplicate', receivedKg: 7, loss: 0, lotNos: {} } });
  expect((await receiveOemFinishedGoodsCommand(base)).status).toBe('duplicate');
  expect(m.call).toHaveBeenCalledExactlyOnceWith({ ...base, releaseId: 'original-release' });
  expect(Object.hasOwn(m.call.mock.calls[0][0], 'oemCostEvidence')).toBe(false);
});
it('벌크 입고의 최초 홀더 ID와 kg도 기존 멱등키와 같이 전송한다',async()=>{const bulk=[{material:'볶음참깨',kg:100,rawItemId:'raw'}];await receiveOemFinishedGoodsCommand({...base,returns:[],bulk});expect(m.call).toHaveBeenCalledWith({...base,returns:[],bulk,releaseId:'original-release'});expect(m.call.mock.calls[0][0].bulk).toBe(bulk);});
