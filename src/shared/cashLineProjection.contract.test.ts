import { describe, expect, it, vi } from 'vitest';
vi.mock('firebase-functions/v2/https', () => ({ HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } }, onCall: (_o: unknown, h: unknown) => h }));
vi.mock('firebase-admin', () => ({ firestore: () => ({}) }));
import { journalizeCashEntry } from './autoJournal';
import { cashFromEntry } from '../../functions/src/partnerPaymentCommand';
import type { CashEntry } from './types';
const entry = (extra: Record<string, unknown>): CashEntry => ({ id:'c', companyId:'taebaek', partnerId:'p', date:'2026-10-08', cashAccountId:'bank', dir:'출금', amount:100, createdAt:'', ...extra } as CashEntry);
function journalReductions(row: CashEntry) {
  const sums = new Map<string, number>();
  for (const line of journalizeCashEntry(row)!.lines) {
    if (!['108','251','253'].includes(line.accountCode)) continue;
    const reduce = line.accountCode === '108' ? line.credit-line.debit : line.debit-line.credit;
    sums.set(line.accountCode,(sums.get(line.accountCode)??0)+reduce);
  }
  return [...sums].filter(([,reduce])=>reduce!==0).map(([accountCode,reduce])=>({accountCode,reduce}));
}
describe('실제 앱 분개와 서버 자금 정산의 공통 투영',()=>{
  it.each(['108','251','253'])('기존 양수 ordinary %s는 입출금 결과를 보존한다',code=>{
    for(const dir of ['입금','출금']) {
      const row=entry({dir,accountCode:code});
      expect(cashFromEntry('c',row)!.parts).toEqual(journalReductions(row));
      expect(cashFromEntry('c',row)!.parts[0].reduce).toBe((code==='108'?dir==='입금':dir==='출금')?100:-100);
    }
  });
  it('음수와 side 혼합·동일 계정은 실제 차대 순액으로 합산한다',()=>{
    const row=entry({lines:[{accountCode:'251',amount:120,side:'차변'},{accountCode:'251',amount:-20,side:'대변'}]});
    expect(cashFromEntry('c',row)!.parts).toEqual([{accountCode:'251',reduce:100}]);
    expect(cashFromEntry('c',row)!.parts).toEqual(journalReductions(row));
    const legacy=entry({lines:[{accountCode:'251',amount:120},{accountCode:'251',amount:-20}]});
    expect(journalizeCashEntry(row)!.lines).toEqual(journalizeCashEntry(legacy)!.lines);
  });
  it('대체의 정상 상계와 반대 차대는 각각 감소와 증가로 읽는다',()=>{
    for(const reverse of [false,true]) {
      const row=entry({dir:'대체',lines:[{accountCode:'251',amount:100,side:reverse?'대변':'차변'},{accountCode:'108',amount:100,side:reverse?'차변':'대변'}]});
      expect(cashFromEntry('c',row)!.parts).toEqual(journalReductions(row));
      expect(cashFromEntry('c',row)!.parts.map(p=>p.reduce)).toEqual(reverse?[-100,-100]:[100,100]);
    }
  });
  it('소수·순액 불일치·불균형 상계·누적 안전정수 초과는 서버에서 거절한다',()=>{
    for(const extra of [
      {lines:[{accountCode:'251',amount:100.5}]},
      {lines:[{accountCode:'251',amount:120}]},
      {dir:'대체',lines:[{accountCode:'251',amount:100},{accountCode:'108',amount:-90}]},
      {lines:[{accountCode:'251',amount:Number.MAX_SAFE_INTEGER},{accountCode:'251',amount:100},{accountCode:'251',amount:-Number.MAX_SAFE_INTEGER}]}
    ]) expect(()=>cashFromEntry('c',entry(extra))).toThrow();
  });
  it('앱의 소수 반올림과 amount 불일치 시 줄 우선 계약은 보존한다',()=>{
    const row=entry({amount:100,lines:[{accountCode:'520',amount:100.555}]});
    expect(journalizeCashEntry(row)!.lines[0]).toMatchObject({debit:100.56});
    expect(journalizeCashEntry(row)!.lines[1]).toMatchObject({credit:100.56});
  });
});
