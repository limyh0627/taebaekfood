import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } },
  onCall: (_options: unknown, handler: unknown) => handler,
}));
import { mutateManualSettlement, mutateManualSettlementCommand } from './manualSettlementCommand';
import { issueVoucher } from './voucherIssue';

const available = ['127.0.0.1:8182', '127.0.0.1:8082'].includes(process.env.FIRESTORE_EMULATOR_HOST ?? '');
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
      expect((await db.collection(collection).get()).docs.filter(row => row.id.includes(prefix))).toHaveLength(0);
    }
    for (const [collection, id] of [['partners', partnerId], ['issuedStatements', statementId],
      ['cashEntries', cashId], ['appMeta', `partnerPaymentState_taebaek_${partnerId}`]]) {
      await ref(collection, id).delete(); expect((await ref(collection, id).get()).exists).toBe(false);
    }
    await app.delete();
  });
  it('historical generic cash supports manual rows, concurrent terminal rejections and immutable issue replay policy', async () => {
    const co = 'taebaek', p = `${prefix}-generic-partner`, s = `${prefix}-generic-statement`, c = `${prefix}-generic-cash`;
    const state = `partnerPaymentState_${co}_${p}`;
    const cash = { companyId: co, partnerId: p, date: '2026-10-07', dir: '입금', amount: 100,
      accountCode: '108', lines: [{ accountCode: '108', amount: 120, side: '대변' }, { accountCode: '108', amount: -20, side: '차변' }], issueOperationId: c, issuePayloadHash: 'historical-hash', docNo: '261007-001' };
    const statement = { companyId: co, partnerId: p, type: '매출', tradeDate: '2026-10-07', totalAmount: 100,
      totalSupply: 100, totalTax: 0, items: [{ accountCode: '800', supply: 100, tax: 0, total: 100 }] };
    const counterId = `voucherNo_${co}_2026-10-07_general`;
    const counter = { companyId: co, tradeDate: '2026-10-07', prefix: '', last: 10 };
    await Promise.all([ref('partners', p).set({ companyId: co, name: '합성' }), ref('issuedStatements', s).set(statement),
      ref('cashEntries', c).set(cash), ref('appMeta', counterId).set(counter)]);
    const command = (label: string, extra: Record<string, unknown> = {}) => ({ operationId: `${prefix}-generic-${label}`,
      action: 'add' as const, partnerId: p, statementId: s, cashEntryId: c, amount: 80, expectedRevision: 0, releaseId, ...extra });
    const invoke = (value: ReturnType<typeof command>) => mutateManualSettlement(db, co, `${prefix}-admin`, value);
    const replay = () => issueVoucher(db, co, { kind: 'cashEntries', operationId: c, tradeDate: '2026-10-07', releaseId,
      document: { date: '2026-10-07', dir: '입금', amount: 100, partnerId: p, accountCode: '108' } });
    try {
      await expect(replay()).rejects.toThrow('원자 명령');
      const denied = command('overflow', { amount: 101 });
      const failures = await Promise.allSettled([invoke(denied), invoke(denied)]);
      expect(failures.every(row => row.status === 'rejected')).toBe(true);
      expect((await ref('manualSettlementOperations', denied.operationId).get()).data()).toMatchObject({ status: 'rejected', companyId: co, partnerId: p });
      expect((await ref('settlements', `manual-${denied.operationId}`).get()).exists).toBe(false);
      expect((await ref('appMeta', state).get()).exists).toBe(false);
      const add = command('add');
      const results = await Promise.all([invoke(add), invoke(add)]);
      expect(results.map(row => row.status).sort()).toEqual(['applied', 'duplicate']);
      const rowId = `manual-${add.operationId}`;
      const update = command('update', { action: 'update', settlementId: rowId, expectedAmount: 80, amount: 60, expectedRevision: 1 });
      expect((await invoke(update)).revision).toBe(2);
      // 응답 유실 후에도 같은 요청이 같은 결과를 돌려준다.
      expect((await invoke(update)).status).toBe('duplicate');
      const remove = command('delete', { action: 'delete', settlementId: rowId, amount: 60, expectedRevision: 2 });
      expect((await invoke(remove)).revision).toBe(3); expect((await invoke(remove)).status).toBe('duplicate');
      expect((await ref('cashEntries', c).get()).data()).toEqual(cash);
      expect((await ref('issuedStatements', s).get()).data()).toEqual(statement);
      expect((await ref('appMeta', counterId).get()).data()).toEqual(counter);
      expect((await ref('settlements', rowId).get()).exists).toBe(false);
      await expect(replay()).rejects.toThrow('원자 명령');
    } finally {
      const ops = await db.collection('manualSettlementOperations').get();
      const settlements = await db.collection('settlements').get();
      for (const row of [...ops.docs, ...settlements.docs]) if (row.id.includes(`${prefix}-generic`)) await row.ref.delete();
      for (const [group, id] of [['partners', p], ['issuedStatements', s], ['cashEntries', c], ['appMeta', state], ['appMeta', counterId]]) {
        await ref(group, id).delete(); expect((await ref(group, id).get()).exists).toBe(false);
      }
    }
  });
  it('generic split cash matches both 251 and 253 without exceeding either budget', async () => {
    const p = prefix+'-split-partner', a = prefix+'-split-trade', b = prefix+'-split-expense', c = prefix+'-split-cash';
    const state = 'partnerPaymentState_taebaek_'+p;
    const cash = { companyId:'taebaek', partnerId:p, date:'2026-10-07', dir:'출금', amount:100, issueOperationId:c,
      lines:[{accountCode:'251',amount:60},{accountCode:'253',amount:40}] };
    await Promise.all([ref('partners',p).set({companyId:'taebaek',name:'합성 분할 거래처'}),ref('cashEntries',c).set(cash),
      ref('issuedStatements',a).set({companyId:'taebaek',partnerId:p,type:'매입',tradeDate:'2026-10-07',totalAmount:60,totalSupply:60,totalTax:0,items:[{accountCode:'500',supply:60,tax:0,total:60}]}),
      ref('issuedStatements',b).set({companyId:'taebaek',partnerId:p,type:'매입',tradeDate:'2026-10-07',totalAmount:40,totalSupply:40,totalTax:0,items:[{accountCode:'520',supply:40,tax:0,total:40}]})]);
    const command=(label:string,statementId:string,amount:number,revision:number)=>({operationId:prefix+'-split-'+label,action:'add' as const,partnerId:p,cashEntryId:c,statementId,amount,expectedRevision:revision,releaseId});
    try {
      expect(await run(command('a',a,60,0))).toMatchObject({status:'applied',revision:1});
      expect(await run(command('b',b,40,1))).toMatchObject({status:'applied',revision:2});
      expect(await run(command('b',b,40,1))).toMatchObject({status:'duplicate',revision:2});
      await expect(run(command('overflow',a,1,2))).rejects.toThrow('한도');
      expect((await ref('cashEntries',c).get()).data()).toEqual(cash);
      expect((await ref('settlements','manual-'+prefix+'-split-a').get()).data()?.amount).toBe(60);
      expect((await ref('settlements','manual-'+prefix+'-split-b').get()).data()?.amount).toBe(40);
      expect((await ref('appMeta',state).get()).data()?.revision).toBe(2);
      expect((await ref('manualSettlementOperations',prefix+'-split-overflow').get()).data()?.status).toBe('rejected');
      expect((await ref('settlements','manual-'+prefix+'-split-overflow').get()).exists).toBe(false);
    } finally {
      for (const group of ['manualSettlementOperations','settlements']) {
        const rows=await db.collection(group).get();for(const row of rows.docs)if(row.id.includes(prefix+'-split'))await row.ref.delete();
        expect((await db.collection(group).get()).docs.filter(row=>row.id.includes(prefix+'-split'))).toHaveLength(0);
      }
      for (const [group,id] of [['partners',p],['cashEntries',c],['issuedStatements',a],['issuedStatements',b],['appMeta',state]]) {
        await ref(group,id).delete();expect((await ref(group,id).get()).exists).toBe(false);
      }
    }
  });
  it('checks callable auth, creates once, and rejects excess without partial revision', async () => {
    const callable = mutateManualSettlementCommand as unknown as (request: unknown) => Promise<unknown>;
    await expect(callable({ data: input('auth', 'add', 20, 0) })).rejects.toThrow('로그인');
    await expect(callable({ auth: { uid: 'staff', token: { companyId: 'taebaek', isAdmin: false } },
      data: input('auth', 'add', 20, 0) })).rejects.toThrow('관리자');
    await ref('cashEntries', cashId).update({ dir: '대체' });
    await expect(run(input('transfer', 'add', 20, 0))).rejects.toThrow('입출금');
    await ref('cashEntries', cashId).update({ dir: '입금', lines: [{ accountCode: '108', amount: 120 }] });
    const mismatchedCash = (await ref('cashEntries', cashId).get()).data();
    await expect(run(input('line-mismatch', 'add', 20, 0))).rejects.toThrow('순액');
    expect((await ref('cashEntries', cashId).get()).data()).toEqual(mismatchedCash);
    expect((await ref('settlements', `manual-${prefix}-line-mismatch`).get()).exists).toBe(false);
    expect((await ref('manualSettlementOperations', `${prefix}-line-mismatch`).get()).data()?.status).toBe('rejected');
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
