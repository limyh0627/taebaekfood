import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { issueScheduledVoucher } from './autoVoucherCommand';
import { voucherSequenceKey } from './voucherIssue';

// 기존 서버 SDK 시험처럼 실제 Admin SDK 트랜잭션을 사용한다. 운영 접속은 허용하지 않는다.
const available = ['127.0.0.1:8082', '127.0.0.1:8182'].includes(process.env.FIRESTORE_EMULATOR_HOST ?? '');
const projectId = `demo-daily-${randomUUID()}`;
const releaseId = 'daily-sdk-release';
let app: admin.app.App, db: admin.firestore.Firestore;
const collections = ['appMeta', 'accountCodes', 'cashAccounts', 'cashEntries', 'issuedStatements'];
async function clear() {
  for (const name of collections) {
    const rows = await db.collection(name).get();
    for (const row of rows.docs) await row.ref.delete();
  }
}
const template = (companyId: 'taebaek' | 'punghoe', id: string, issueDay = 7) => ({
  id, companyId, autoIssue: true, dir: '대체', statementType: '비용' as const,
  name: 'SDK 비용', accountCode: '650', amount: 100, issueDay,
  transferLines: [{ accountCode: '650', side: '차변' }, { accountCode: '251', side: '대변' }],
});
async function counter(companyId: string, date: string, prefix: string, last = 0) {
  await db.doc(`appMeta/${voucherSequenceKey(companyId, date, prefix)}`).set({ companyId, tradeDate: date, prefix, last });
}
async function last(companyId: string, date: string, prefix: string) {
  return (await db.doc(`appMeta/${voucherSequenceKey(companyId, date, prefix)}`).get()).data()?.last;
}

describe.skipIf(!available)('daily 통합 서버 실제 Firestore 계약', { timeout: 30000 }, () => {
  beforeAll(() => { app = admin.initializeApp({ projectId }, projectId); db = app.firestore(); });
  beforeEach(async () => {
    await clear();
    await db.doc('appMeta/releaseCutover').set({ status: 'active', releaseId,
      voucherNotBefore: { taebaek: '2026-10-03', punghoe: '2026-10-03' },
      oldWritersBlocked: true, oldWritersBlockedEvidence: 'demo SDK fixture' });
    for (const company of ['taebaek', 'punghoe']) {
      for (const code of ['650', '251']) await db.doc(`accountCodes/${company}-${code}`).set({ companyId: company, code, name: code });
      await db.doc(`cashAccounts/${company}`).set({ companyId: company, active: true, type: '은행' });
    }
  });
  afterAll(async () => { await clear(); await app.delete(); });

  it('양사 명시 비용은 대체 번호와 균형 분개를 저장하고 AUTO 재시도는 번호를 소비하지 않는다', async () => {
    for (const company of ['taebaek', 'punghoe'] as const) {
      const t = template(company, company);
      const first = await issueScheduledVoucher(db, t, '2026-10', '2026-10-07', releaseId);
      expect(first).toMatchObject({ result: { id: `AUTO-${company}-2026-10`, docNo: '대체261007-001' } });
      const ref = db.doc(`issuedStatements/AUTO-${company}-2026-10`);
      const original = (await ref.get()).data();
      expect(original).toMatchObject({ companyId: company, type: '비용', totalSupply: 100, totalTax: 0, totalAmount: 100, issuePrefix: '대체' });
      expect(original?.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ accountCode: '650', side: '차변', supply: 100, tax: 0 }),
        expect.objectContaining({ accountCode: '251', side: '대변', supply: 100, tax: 0 }),
      ]));
      expect(await issueScheduledVoucher(db, t, '2026-10', '2026-10-07', releaseId)).toEqual(first);
      expect((await ref.get()).data()).toEqual(original);
      expect(await last(company, '2026-10-07', '대체')).toBe(1);
      await expect(issueScheduledVoucher(db, { ...t, amount: 101 }, '2026-10', '2026-10-07', releaseId)).rejects.toThrow();
      expect(await last(company, '2026-10-07', '대체')).toBe(1);
    }
  });

  it('발행일과 계정 회사 검증 실패는 문서와 번호를 만들지 않는다', async () => {
    const t = template('taebaek', 'invalid');
    expect(await issueScheduledVoucher(db, t, '2026-10', '2026-10-06', releaseId)).toHaveProperty('skip');
    await db.doc('accountCodes/taebaek-251').delete();
    expect(await issueScheduledVoucher(db, t, '2026-10', '2026-10-07', releaseId)).toHaveProperty('skip');
    expect((await db.collection('issuedStatements').get()).empty).toBe(true);
    expect(await last('taebaek', '2026-10-07', '대체')).toBeUndefined();
  });

  it('열린 catch-up은 실제 발행일 추가 카운터만 사용하며 비용·타회사·닫힌 기간은 거절한다', async () => {
    await db.doc('appMeta/releaseCutover').update({ catchUp: { companyId: 'taebaek', fromDate: '2026-09-30', status: 'open' } });
    await counter('taebaek', '2026-09-30', '추가', 7);
    await counter('taebaek', '2026-10-01', '추가');
    const cash = { id: 'catchup', companyId: 'taebaek', autoIssue: true, dir: '출금', accountCode: '650', amount: 100, issueDay: 1 };
    expect(await issueScheduledVoucher(db, cash, '2026-10', '2026-10-01', releaseId)).toMatchObject({ result: { docNo: '추가261001-001' } });
    expect(await last('taebaek', '2026-10-01', '추가')).toBe(1);
    expect(await last('taebaek', '2026-09-30', '추가')).toBe(7);
    await expect(issueScheduledVoucher(db, template('taebaek', 'costpast', 1), '2026-10', '2026-10-01', releaseId)).rejects.toThrow();
    await expect(issueScheduledVoucher(db, { ...cash, id: 'foreign', companyId: 'punghoe' }, '2026-10', '2026-10-01', releaseId)).rejects.toThrow();
    await expect(issueScheduledVoucher(db, { ...cash, id: 'tooearly', issueDay: 29 }, '2026-09', '2026-09-29', releaseId)).rejects.toThrow();
    await db.doc('appMeta/releaseCutover').update({ 'catchUp.status': 'closed' });
    await expect(issueScheduledVoucher(db, { ...cash, id: 'closed' }, '2026-10', '2026-10-01', releaseId)).rejects.toThrow();
    expect((await db.collection('cashEntries').get()).size).toBe(1);
    expect((await db.collection('issuedStatements').get()).empty).toBe(true);
    expect(await last('taebaek', '2026-10-01', '추가')).toBe(1);
  });
});
