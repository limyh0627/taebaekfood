import { beforeEach, expect, it, vi } from 'vitest';
import { applyRawCommand, operationDocId, inventoryDocId, type RawInventoryCommand } from '../rawInventoryCore';
import { cancelOemIssue } from './oemCancelService';
const mock = vi.hoisted(() => ({ rows: new Map<string, any>(), writes: 0 }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => `${collection}/${id}`,
  runTransaction: async (_db: unknown, callback: any) => {
    const pending: [string, any][] = [];
    const result = await callback({ get: async (ref: string) => ({ exists: () => mock.rows.has(ref), data: () => structuredClone(mock.rows.get(ref)) }),
      set: (ref: string, value: any) => pending.push([ref, value]), update: (ref: string, value: any) => pending.push([ref, { ...mock.rows.get(ref), ...value }]) });
    pending.forEach(([ref, value]) => mock.rows.set(ref, structuredClone(value))); mock.writes += pending.length;
    return result;
  },
}));
const db = {} as Parameters<typeof cancelOemIssue>[0];
function seed(rawItemId = 'raw') {
  const base = { companyId: 'taebaek' as const, rawItemId, materialSnapshot: '참깨', effectiveAt: '2026-10-08T12:00:00+09:00', source: { type: 'oem' as const, id: 'po' } };
  const det = { now: '2026-10-08T03:00:00Z', newLotId: `lot-${rawItemId}`, carryOverLotId: 'carry' };
  const received = applyRawCommand({ state: null, command: { ...base, operationId: `receive-${rawItemId}`, kind: 'receive', kg: 200, lot: { supplierName: '공급처' } }, det });
  if (received.status !== 'applied') throw new Error('입고 fixture 오류');
  const command: RawInventoryCommand = { ...base, operationId: `oem-issue:po:${rawItemId}`, kind: 'consume', kg: 100 };
  const consumed = applyRawCommand({ state: received.state, command, det });
  if (consumed.status !== 'applied') throw new Error('차감 fixture 오류');
  mock.rows.set(`rawInventories/${inventoryDocId('taebaek', rawItemId)}`, consumed.state);
  mock.rows.set(`rawMaterialLedger/${operationDocId(command.operationId)}`, consumed.movement);
  mock.rows.set(`items/${rawItemId}`, { companyId: 'taebaek', name: '참깨', stock: 100, lots: [...consumed.state.activeLots, ...consumed.state.recentDepletedLots] });
}
beforeEach(() => {
  mock.rows.clear(); mock.writes = 0; seed();
  mock.rows.set('purchaseOrders/po', { companyId: 'taebaek', poType: 'oem', status: 'invoiced', oemIssueStatus: 'complete', oemIssueDate: '2026-10-08', oemSent: [{ rawItemId: 'raw', material: '참깨', kg: 100 }] });
});
it('원래 로트와 재고를 한 거래로 복원하고 재시도는 추가 저장하지 않는다', async () => {
  expect(await cancelOemIssue(db, 'taebaek', 'po')).toEqual({ status: 'applied' });
  expect(mock.rows.get('items/raw').stock).toBe(200);
  expect(mock.rows.get('items/raw').lots[0].id).toBe('lot-raw');
  expect(mock.rows.get('items/raw').lots[0].kgRemaining).toBe(200);
  expect(mock.rows.get('purchaseOrders/po').oemCancelOperationId).toBe('oem-cancel:po');
  const count = mock.writes;
  expect(await cancelOemIssue(db, 'taebaek', 'po')).toEqual({ status: 'duplicate' });
  expect(mock.writes).toBe(count);
});
it.each(['oemReceiptOperations/oem-receive:po', 'adjustmentRequests/OEMFEE-po', 'issuedStatements/OEMFEE-po'])('입고·가공비 근거 %s가 있으면 모든 원문을 보존한다', async ref => {
  mock.rows.set(ref, { companyId: 'taebaek' });
  const before = structuredClone([...mock.rows]);
  await expect(cancelOemIssue(db, 'taebaek', 'po')).rejects.toThrow('취소할 수 없습니다');
  expect([...mock.rows]).toEqual(before); expect(mock.writes).toBe(0);
});
it('다른 회사와 원료 ID 없는 옛 발주는 추정 복원하지 않는다', async () => {
  await expect(cancelOemIssue(db, 'punghoe', 'po')).rejects.toThrow('다른 회사');
  mock.rows.get('purchaseOrders/po').oemSent[0].rawItemId = '';
  await expect(cancelOemIssue(db, 'taebaek', 'po')).rejects.toThrow('옛 OEM');
  expect(mock.writes).toBe(0);
});
it('두 번째 원료의 원차감 내용이 다르면 첫 번째 원료도 복원하지 않는다', async () => {
  seed('raw-two');
  mock.rows.get('purchaseOrders/po').oemSent.push({ rawItemId: 'raw-two', material: '참깨', kg: 99 });
  const before = structuredClone([...mock.rows]);
  await expect(cancelOemIssue(db, 'taebaek', 'po')).rejects.toThrow('차감 내용');
  expect([...mock.rows]).toEqual(before); expect(mock.writes).toBe(0);
});
it('새 취소 원장의 hash가 사라지면 legacy 중복 호환으로 성공하지 않는다', async () => {
  await cancelOemIssue(db, 'taebaek', 'po');
  delete mock.rows.get(`rawMaterialLedger/${operationDocId('oem-cancel:po:raw')}`).commandHash;
  const count = mock.writes;
  await expect(cancelOemIssue(db, 'taebaek', 'po')).rejects.toThrow('근거가 불완전');
  expect(mock.writes).toBe(count);
});
