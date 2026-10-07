import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } },
  onCall: (_options: unknown, handler: unknown) => handler,
}));
import { mutateManualSettlement, mutateManualSettlementCommand } from './manualSettlementCommand';

const available = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8182';
const prefix = `manual-${randomUUID()}`;
const partnerId = `${prefix}-partner`, statementId = `${prefix}-statement`, cashId = `${prefix}-cash`;
const releaseId = prefix;
let app: admin.app.App, db: admin.firestore.Firestore;
const ref = (collection: string, id: string) => db.collection(collection).doc(id);
const input = (label: string, action: 'add' | 'update' | 'delete', amount: number, revision: number,
  extra: Record<string, unknown> = {}) => ({ operationId: `${prefix}-${label}`, action, partnerId,
  statementId, cashEntryId: cashId, amount, expectedRevision: revision, releaseId, ...extra });
const run = (request: Parameters<typeof mutateManualSettlement>[3]) =>
  mutateManualSettlement(db, 'taebaek', `${prefix}-admin`, request);

describe.skipIf(!available)('manual settlement Admin SDK transaction', () => {
  beforeAll(async () => {
    app = admin.initializeApp({ projectId: 'demo-taebaekfood-local' }, prefix);
    db = admin.firestore(app);
    await Promise.all([
      ref('partners', partnerId).set({ companyId: 'taebaek', name: '시험 거래처' }),
      ref('issuedStatements', statementId).set({ companyId: 'taebaek', partnerId, type: '매출',
        tradeDate: '2026-10-03', totalAmount: 100, totalSupply: 100, totalTax: 0,
        items: [{ accountCode: '800', supply: 100, tax: 0, total: 100 }] }),
      ref('cashEntries', cashId).set({ companyId: 'taebaek', partnerId, dir: '입금', amount: 100,
        lines: [{ accountCode: '108', amount: 100 }] }),
      ref('appMeta', 'releaseCutover').set({ status: 'active', releaseId }),
      ref('appMeta', 'partnerPaymentCutover_taebaek').set({ companyId: 'taebaek', enabled: true,
        legacyWritersBlocked: true, auditPassed: true }),
    ]);
  });
  afterAll(async () => {
    if (!db) return;
    for (const collection of ['manualSettlementOperations', 'settlements']) {
      const docs = await db.collection(collection).get();
      for (const row of docs.docs) if (row.id.includes(prefix)) await row.ref.delete();
    }
    for (const [collection, id] of [['partners', partnerId], ['issuedStatements', statementId],
      ['cashEntries', cashId], ['appMeta', `partnerPaymentState_taebaek_${partnerId}`]]) await ref(collection, id).delete();
    await app.delete();
  });
  it('checks callable auth, creates once, and rejects excess without partial revision', async () => {
    const callable = mutateManualSettlementCommand as unknown as (request: unknown) => Promise<unknown>;
    await expect(callable({ data: input('auth', 'add', 20, 0) })).rejects.toThrow('로그인');
    await expect(callable({ auth: { uid: 'staff', token: { companyId: 'taebaek', isAdmin: false } },
      data: input('auth', 'add', 20, 0) })).rejects.toThrow('관리자');
    await ref('cashEntries', cashId).update({ dir: '대체' });
    await expect(run(input('transfer', 'add', 20, 0))).rejects.toThrow('입출금');
    await ref('cashEntries', cashId).update({ dir: '입금', lines: [{ accountCode: '108', amount: 120 }] });
    await expect(run(input('line-mismatch', 'add', 20, 0))).rejects.toThrow('총액');
    await ref('cashEntries', cashId).update({ lines: [{ accountCode: '108', amount: 100 }] });
    expect((await ref('appMeta', `partnerPaymentState_taebaek_${partnerId}`).get()).exists).toBe(false);
    const add = input('add', 'add', 80, 0);
    expect((await run(add)).status).toBe('applied');
    expect((await run(add)).status).toBe('duplicate');
    await expect(run(input('overflow', 'add', 30, 1))).rejects.toThrow('한도');
    expect((await ref('appMeta', `partnerPaymentState_taebaek_${partnerId}`).get()).data()?.revision).toBe(1);
    expect((await ref('settlements', `manual-${prefix}-overflow`).get()).exists).toBe(false);
  });
  it('updates and deletes only the expected manual row', async () => {
    const id = `manual-${prefix}-add`;
    await expect(run(input('stale', 'update', 60, 0, { settlementId: id, expectedAmount: 80 }))).rejects.toThrow('변경');
    expect((await run(input('update', 'update', 60, 1, { settlementId: id, expectedAmount: 80 }))).revision).toBe(2);
    await expect(run(input('wrong-old', 'delete', 80, 2, { settlementId: id }))).rejects.toThrow('변경');
    expect((await run(input('delete', 'delete', 60, 2, { settlementId: id }))).revision).toBe(3);
    expect((await ref('settlements', id).get()).exists).toBe(false);
  });
});
