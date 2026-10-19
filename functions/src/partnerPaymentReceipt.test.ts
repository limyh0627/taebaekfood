import { describe, expect, it, vi } from 'vitest';
vi.mock('firebase-functions/v2/https', () => ({ HttpsError: class extends Error {
        constructor(public code: string, message: string) { super(message); }
    } }));
import { fingerprint, readPartnerPaymentReceipt } from './partnerPaymentReceipt';
const reference = { companyId: 'taebaek' as const, partnerId: 'partner', operationId: 'pay-1' };
function harness(initial: Record<string, any>) {
    const rows = new Map(Object.entries(initial));
    const db = { collection: (collection: string) => ({ doc: (id: string) => ({ key: collection + '/' + id }), where: (field: string, _: string, value: unknown) => ({ collection, field, value }) }) };
    const tx = { get: async (ref: any) => ref.key ? { exists: rows.has(ref.key), data: () => rows.get(ref.key) } : { docs: [...rows].filter(([key, row]) => key.startsWith(ref.collection + '/') && (Array.isArray(row[ref.field]) ? row[ref.field].includes(ref.value) : row[ref.field] === ref.value)).map(([key, row]) => ({ id: key.split('/')[1], data: () => row })) } };
    return () => readPartnerPaymentReceipt(db as any, tx as any, reference, 'uid');
}
describe('공용 수금 영수증 증거', () => {
    it('부재는 실패 확정이 아니며 중단은 금융 자료가 없을 때만 확정한다', async () => {
        expect(await harness({})()).toMatchObject({ status: 'unknown', requestHash: null });
        const fence = { companyId: 'taebaek', partnerId: 'partner', createdBy: 'uid', status: 'cancelled', requestHash: null, financialWrites: false, cancelledAt: '2026-10-19T00:00:00.000Z' };
        expect(await harness({ 'partnerPaymentOperations/pay-1': fence })()).toMatchObject({ status: 'cancelled' });
        expect(await harness({ 'partnerPaymentOperations/pay-1': fence, 'cashEntries/pay-1': {} })()).toMatchObject({ status: 'unknown' });
    });
    it('status 없는 기존 성공도 원현금·정산증거를 확인하고 최초금액만 표시한다', async () => {
        const business = { companyId: 'taebaek', partnerId: 'partner', date: '2026-10-19', amount: 100, cashAccountId: 'bank', dir: '입금', lines: [], note: '' };
        const hash = 'a'.repeat(64), entry = { ...business, issueOperationId: 'pay-1', issuePayloadHash: hash, issuePrefix: '', docNo: '번호' };
        const receipt = { companyId: 'taebaek', partnerId: 'partner', createdBy: 'uid', requestHash: hash, entryHash: fingerprint(business), issuePrefix: '', cashEntryId: 'pay-1', docNo: '번호', settlements: [], createdAt: '2026-10-19T00:00:00.000Z' };
        expect(await harness({ 'partnerPaymentOperations/pay-1': receipt, 'cashEntries/pay-1': entry })()).toMatchObject({ status: 'applied', amount: 100, cashAccountId: 'bank' });
        expect(await harness({ 'partnerPaymentOperations/pay-1': receipt, 'cashEntries/pay-1': { ...entry, amount: 999 } })()).toMatchObject({ status: 'unknown' });
        await expect(harness({ 'partnerPaymentOperations/pay-1': { ...receipt, createdBy: 'other' } })()).rejects.toThrow('사용자');
    });
    it.each(['cancelled','rejected'] as const)('%s 영수증과 삭제 감사가 모순되면 금융0 확정 대신 unknown을 보존한다',async status=>{
        const receipt={companyId:'taebaek',partnerId:'partner',createdBy:'uid',status,requestHash:'a'.repeat(64),financialWrites:false,cancelledAt:'2026-10-19T00:00:00.000Z',failureCode:'failed-precondition',failureMessage:'거절'};
        expect(await harness({'partnerPaymentOperations/pay-1':receipt,'voucherMutationOperations/audit':{cashEntryIds:['pay-1'],action:'delete'}})()).toMatchObject({status:'unknown',requestHash:null});
    });});
