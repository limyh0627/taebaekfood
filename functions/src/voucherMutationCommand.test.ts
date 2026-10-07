import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } },
  onCall: (_options: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-admin', () => ({ firestore: () => ({}) }));
import { mutateVoucher } from './voucherMutationCommand';

type Row = Record<string, unknown>;
function fakeDb(initial: Record<string, Row>) {
  const rows = new Map(Object.entries(initial));
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => ({ key: `${name}/${id}` }),
      where: (field: string, _op: string, value: unknown) => ({ collection: name, field, value }),
    }),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
      const writes: (() => void)[] = [];
      const result = await fn({
        get: async (ref: { key?: string; collection?: string; field?: string; value?: unknown }) => ref.key
          ? { exists: rows.has(ref.key), data: () => rows.get(ref.key) }
          : { empty: ![...rows].some(([key, value]) => key.startsWith(`${ref.collection}/`) && value[ref.field!] === ref.value) },
        update: (ref: { key: string }, value: Row) => writes.push(() => rows.set(ref.key, { ...rows.get(ref.key), ...value })),
        delete: (ref: { key: string }) => writes.push(() => { rows.delete(ref.key); }),
        create: (ref: { key: string }, value: Row) => writes.push(() => rows.set(ref.key, value)),
      });
      writes.forEach(write => write());
      return result;
    },
  };
  return { db: db as any, rows };
}
const releaseId = 'release-1';
const input = (action: 'edit-note' | 'delete', operationId: string) => ({
  kind: 'cashEntries' as const, voucherId: 'cash-1', operationId, action, expectedRevision: 0,
  releaseId, ...(action === 'edit-note' ? { note: '확인됨' } : {}),
});
const seeded = (cash: Row = {}) => fakeDb({
  'appMeta/releaseCutover': { status: 'active', releaseId },
  'cashEntries/cash-1': { companyId: 'taebaek', issueOperationId: 'cash-1', docNo: '261003-001', date: '2026-10-03', amount: 100, ...cash },
});

describe('narrow server voucher correction', () => {
  it('edits an unlinked server voucher once and verifies duplicate retry', async () => {
    const { db, rows } = seeded();
    expect(await mutateVoucher(db, 'taebaek', 'admin-1', input('edit-note', 'edit-1')))
      .toMatchObject({ status: 'applied' });
    expect(rows.get('cashEntries/cash-1')).toMatchObject({ note: '확인됨', mutationRevision: 1 });
    expect(await mutateVoucher(db, 'taebaek', 'admin-1', input('edit-note', 'edit-1')))
      .toMatchObject({ status: 'duplicate' });
  });
  it('deletes only an unlinked server voucher and returns duplicate on retry', async () => {
    const { db, rows } = seeded();
    expect(await mutateVoucher(db, 'taebaek', 'admin-1', input('delete', 'delete-1')))
      .toMatchObject({ status: 'applied' });
    expect(rows.has('cashEntries/cash-1')).toBe(false);
    expect(await mutateVoucher(db, 'taebaek', 'admin-1', input('delete', 'delete-1')))
      .toMatchObject({ status: 'duplicate' });
  });
  it('rejects linked, stale, and wrong-company changes without partial writes', async () => {
    for (const cash of [{ loanId: 'loan-1' }, { transferOperationId: 'transfer-1' }]) {
      const { db, rows } = seeded(cash);
      await expect(mutateVoucher(db, 'taebaek', 'admin-1', input('delete', 'blocked'))).rejects.toThrow('연결된 전표');
      expect(rows.has('cashEntries/cash-1')).toBe(true);
      expect(rows.has('voucherMutationOperations/blocked')).toBe(false);
    }
    const { db } = seeded();
    await expect(mutateVoucher(db, 'punghoe', 'admin-1', input('delete', 'wrong-company'))).rejects.toThrow('회사');
    await expect(mutateVoucher(db, 'taebaek', 'admin-1', { ...input('edit-note', 'stale'), expectedRevision: 1 }))
      .rejects.toThrow('이미 변경');
  });
  it('allows a numbered legacy partner voucher only when all accounting links are absent', async () => {
    const { db, rows } = seeded({ partnerId: 'partner-1', issueOperationId: undefined });
    expect(await mutateVoucher(db, 'taebaek', 'admin-1', input('edit-note', 'legacy-note')))
      .toMatchObject({ status: 'applied' });
    expect(rows.get('cashEntries/cash-1')).toMatchObject({ partnerId: 'partner-1', note: '확인됨' });
    const linked = seeded({ partnerId: 'partner-1', issueOperationId: undefined });
    linked.rows.set('settlements/link-1', { companyId: 'taebaek', cashEntryId: 'cash-1', statementId: 'statement-1', amount: 100 });
    await expect(mutateVoucher(linked.db, 'taebaek', 'admin-1', input('delete', 'linked-delete')))
      .rejects.toThrow('연결된 전표');
    expect(linked.rows.has('cashEntries/cash-1')).toBe(true);
  });
  it('rejects a legacy voucher with ambiguous numbering or another server operation', async () => {
    for (const fields of [{ docNo: '261002-001' }, { issueOperationId: 'someone-else' },
      { issuePayloadHash: 'orphan-hash', issueOperationId: undefined }]) {
      const { db, rows } = seeded(fields);
      await expect(mutateVoucher(db, 'taebaek', 'admin-1', input('delete', 'ambiguous'))).rejects.toThrow();
      expect(rows.has('cashEntries/cash-1')).toBe(true);
    }
  });
  it('does not delete unpinned partner payments or protected ledger cash without settlements', async () => {
    const operated = seeded({ partnerId: 'partner-1' });
    operated.rows.set('partnerPaymentOperations/cash-1', { companyId: 'taebaek', cashEntryId: 'cash-1' });
    await expect(mutateVoucher(operated.db, 'taebaek', 'admin-1', input('delete', 'delete-payment')))
      .rejects.toThrow('연결된 전표');
    const legacy = seeded({ partnerId: 'partner-1', issueOperationId: undefined, accountCode: '108' });
    await expect(mutateVoucher(legacy.db, 'taebaek', 'admin-1', input('delete', 'delete-ar')))
      .rejects.toThrow('연결된 전표');
  });
});
