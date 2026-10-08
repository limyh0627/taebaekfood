import { describe, expect, it, vi } from 'vitest';
vi.mock('firebase-functions/v2/https', () => ({ HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } } }));
import { cashOriginalHash, readCashCreationMutation } from './cashMutationReceipt';
const original = { companyId: 'taebaek', amount: 100, docNo: '261008-001', issuePayloadHash: 'original' };
const revised = { ...original, amount: 120, mutationRevision: 1 };
const edited = (before = original, after: any = revised) => ({ companyId: 'taebaek', voucherId: 'cash', kind: 'cashEntries',
  action: 'edit', status: 'applied', createdBy: 'uid', cashEntryIds: ['cash'], expectedRevision: (before as any).mutationRevision ?? 0,
  beforeSnapshot: before, beforeHash: cashOriginalHash(before), afterHash: cashOriginalHash(after) });
const deleted = { ...edited(revised), action: 'delete', afterHash: null, expectedRevision: 1 };
async function read(history: any[], current: any = revised, validates = (row: any) => row.issuePayloadHash === 'original') {
  const db = { collection: () => ({ where: (field: string, op: string, id: string) => {
    expect([field, op, id]).toEqual(['cashEntryIds', 'array-contains', 'cash']); return {}; } }) };
  const tx = { get: async () => ({ docs: history.map(row => ({ data: () => row })) }) };
  return readCashCreationMutation(db as any, tx as any, 'taebaek', 'cash', { exists: !!current, data: () => current } as any, validates);
}
describe('creation receipt follows the complete mutation chain', () => {
  it('returns the immutable original after edit or deletion without authorizing recreation', async () => {
    expect(await read([edited()])).toEqual(original);
    expect(await read([deleted, edited()], null)).toEqual(original);
  });
  it('rejects omitted revisions, modified current cash and wrong original creation hash', async () => {
    await expect(read([deleted], null)).rejects.toThrow();
    await expect(read([edited()], { ...revised, amount: 121 })).rejects.toThrow();
    await expect(read([edited()], revised, () => false)).rejects.toThrow();
  });
  it('rejects altered before evidence, cross-company receipts and an edit after cancellation', async () => {
    await expect(read([{ ...edited(), beforeHash: '0'.repeat(64) }])).rejects.toThrow();
    await expect(read([{ ...edited(), companyId: 'punghoe' }])).rejects.toThrow();
    const again = { ...revised, mutationRevision: 2 };
    await expect(read([edited(), deleted, edited(again as any, { ...again, mutationRevision: 3 })])).rejects.toThrow();
  });
});
