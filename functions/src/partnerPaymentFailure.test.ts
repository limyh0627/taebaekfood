import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error { constructor(public code: string, message: string, public details?: unknown) { super(message); } },
  onCall: (_options: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-admin', () => ({ firestore: () => ({}) }));

import { cashFromEntry, claimFromStatement, recordPartnerPayment } from './partnerPaymentCommand';

type Row = Record<string, any>;
type Ref = { key: string };
type Query = { collection: string; field?: string; value?: unknown };
function fakeDb(initial: Record<string, Row>) {
  const rows = new Map(Object.entries(initial));
  const ref = (key: string): Ref => ({ key });
  const db = {
    collection: (collection: string) => ({
      collection,
      doc: (id: string) => ref(`${collection}/${id}`),
      where: (field: string, _op: string, value: unknown): Query => ({ collection, field, value }),
    }),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
      const pending: (() => void)[] = [];
      const result = await fn({
        get: async (target: Ref | Query) => 'key' in target
          ? { ref: target, exists: rows.has(target.key), data: () => rows.get(target.key) }
          : { docs: [...rows.entries()].filter(([key, value]) => key.startsWith(`${target.collection}/`)
            && (target.field ? value[target.field] === target.value : true))
            .map(([key, value]) => ({ id: key.slice(target.collection.length + 1), data: () => value })) },
        update: (target: Ref, value: Row) => pending.push(() => rows.set(target.key, { ...rows.get(target.key), ...value })),
        create: (target: Ref, value: Row) => pending.push(() => {
          if (rows.has(target.key)) throw new Error('already exists');
          rows.set(target.key, value);
        }),
      });
      pending.forEach(write => write());
      return result;
    },
  };
  return { db: db as any, rows };
}

const date = '2026-10-03';
const counter = `appMeta/voucherNo_taebaek_${date}_general`;
const source = {
  'appMeta/releaseCutover': { releaseId: 'test-release', status: 'active', voucherNotBefore: { taebaek: '2026-10-03' } },
  'appMeta/partnerPaymentCutover_taebaek': { companyId: 'taebaek', enabled: true, legacyWritersBlocked: true, auditPassed: true },
  'cashAccounts/bank': { companyId: 'taebaek', active: true, type: '통장' },
  'partners/p1': { companyId: 'taebaek', name: '거래처' },
  'issuedStatements/s1': { companyId: 'taebaek', partnerId: 'p1', type: '매출', tradeDate: date, totalAmount: 100,
    items: [{ accountCode: '800', supply: 100, tax: 0, total: 100 }] },
  [counter]: { companyId: 'taebaek', tradeDate: date, prefix: '', last: 9 },
};
const input = { operationId: 'pay-1', tradeDate: date, partnerId: 'p1', direction: '입금' as const,
  amount: 100, cashAccountId: 'bank', pin: true, allocations: [{ statementId: 's1', amount: 100 }],
  expectedRevision: 0, releaseId: 'test-release' };

const detail={partnerPaymentFailure:{version:1,companyId:'taebaek',partnerId:'p1',operationId:'pay-1',operationRejected:true,financialWrites:false}};
for(const [name,patch] of [['gate',{'appMeta/partnerPaymentCutover_taebaek':undefined}],['revision',{'appMeta/partnerPaymentState_taebaek_p1':{companyId:'taebaek',partnerId:'p1',revision:1}}],['bank',{'cashAccounts/bank':{companyId:'punghoe',active:true}}]] as const)
 it(`${name} 확정 거절은 audit1/금융0이며 재시도 추가 쓰기0`,async()=>{const initial={...source,...patch};for(const key of Object.keys(initial))if((initial as any)[key]===undefined)delete(initial as any)[key];const f=fakeDb(initial);
 await expect(recordPartnerPayment(f.db,'taebaek','admin',input)).rejects.toMatchObject({details:detail});expect(f.rows.get('partnerPaymentOperations/pay-1')).toMatchObject({status:'rejected',partnerId:'p1'});expect(f.rows.size).toBe(Object.keys(initial).length+1);
 expect(f.rows.has('cashEntries/pay-1')).toBe(false);expect(f.rows.has('settlements/st-pay-1-s1')).toBe(false);expect(f.rows.get(counter)).toEqual(initial[counter]);
 const before=JSON.stringify([...f.rows]);await expect(recordPartnerPayment(f.db,'taebaek','admin',input)).rejects.toMatchObject({details:detail});expect(JSON.stringify([...f.rows])).toBe(before);});
it('기존 rejected hash 또는 금융문서가 다르면 안전 detail 없음',async()=>{const f=fakeDb({...source,'cashAccounts/bank':{companyId:'punghoe',active:true}});
 await expect(recordPartnerPayment(f.db,'taebaek','admin',input)).rejects.toMatchObject({details:detail});await expect(recordPartnerPayment(f.db,'taebaek','admin',{...input,amount:99})).rejects.toMatchObject({details:undefined});
 f.rows.set('settlements/unrelated',{companyId:'taebaek',operationId:'pay-1',cashEntryId:'pay-1',statementId:'s1',amount:1});await expect(recordPartnerPayment(f.db,'taebaek','admin',input)).rejects.toMatchObject({details:undefined});});
it('applied duplicate와 원본 변조 거절 유지',async()=>{const f=fakeDb(source);const first=await recordPartnerPayment(f.db,'taebaek','admin',input);expect(first.status).toBe('applied');expect(await recordPartnerPayment(f.db,'taebaek','admin',input)).toMatchObject({status:'duplicate',docNo:first.docNo});
 f.rows.set('cashEntries/pay-1',{...f.rows.get('cashEntries/pay-1'),amount:101});await expect(recordPartnerPayment(f.db,'taebaek','admin',input)).rejects.toMatchObject({details:undefined});expect(f.rows.get(counter)?.last).toBe(10);});
it('명시된 plan 검증 오류는 감사만 남기고 입력 수정 가능하다',async()=>{const f=fakeDb(source);const error=await recordPartnerPayment(f.db,'taebaek','admin',{...input,amount:90,allocations:[{statementId:'s1',amount:100}]}).catch(e=>e);expect(error).toBeInstanceOf(Error);expect(error.details).toEqual(detail);expect(f.rows.get('partnerPaymentOperations/pay-1')).toMatchObject({status:'rejected',failureCode:'failed-precondition'});expect(f.rows.get(counter)?.last).toBe(9);});
it('조회·commit 오류는 안전 detail이 없다',async()=>{const f=fakeDb(source);const reader={...f.db,runTransaction:async()=>{throw new Error('read unavailable');}};const error=await recordPartnerPayment(reader,'taebaek','admin',input).catch(e=>e);expect(error.message).toBe('read unavailable');expect(error.details).toBeUndefined();
 const commit={...f.db,runTransaction:async(fn:any)=>{await f.db.runTransaction(fn);throw new Error('commit result lost');}};await expect(recordPartnerPayment(commit,'taebaek','admin',input)).rejects.toThrow('commit result lost');expect(f.rows.get('cashEntries/pay-1')).toBeDefined();expect(await recordPartnerPayment(f.db,'taebaek','admin',input)).toMatchObject({status:'duplicate'});});
