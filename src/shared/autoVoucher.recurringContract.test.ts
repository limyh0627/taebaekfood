import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../functions/src/shared/recurringVoucher', async importOriginal => {
  const actual = await importOriginal<typeof import('../../functions/src/shared/recurringVoucher')>();
  return { ...actual, recurringStatement: vi.fn(actual.recurringStatement) };
});
import { recurringStatement } from '../../functions/src/shared/recurringVoucher';
import { buildCashVoucher, buildStatementVoucher, issueDateOf } from './autoVoucher';
import { autoVoucherDraft } from '../../functions/src/autoVoucherDraft';
import type { FixedCostTemplate } from './types';
const t = { id:'rent', companyId:'taebaek', name:'임대료', amount:110001, accountCode:'520',
  autoIssue:true, issueDay:31, dir:'줄돈', partnerId:'owner' } as FixedCostTemplate;
beforeEach(()=>{ vi.mocked(recurringStatement).mockClear(); });
describe('실제 앱과 서버의 단일 계산 소비',()=>{
  it('두 adapter가 같은 계산 소스를 호출하고 동일 품목 금액을 반환한다',()=>{
    const app=buildStatementVoucher(t,'2026-02',{docNo:'kept',accountName:'임대비'});
    const server=autoVoucherDraft(t,'2026-02','2026-02-28','','임대비').draft!;
    expect(recurringStatement).toHaveBeenCalledTimes(2);
    expect(server.document).toMatchObject({totalSupply:100001,totalTax:10000,totalAmount:110001,items:app.items});
    expect(app).toMatchObject({docNo:'kept',tradeDate:'2026-02-28'});
  });
  it('앱 소수 입력과 서버 엄격 거절을 유지한다',()=>{
    const app=buildStatementVoucher({...t,amount:110.4},'2026-02');
    expect(app).toMatchObject({totalSupply:100,totalTax:10,totalAmount:110.4});
    expect(autoVoucherDraft({...t,amount:110.4},'2026-02','2026-02-28')).toEqual({skip:'유효하지 않은 원화 총액'});
    expect(issueDateOf('2026-02',1.5)).toBe('2026-02-1.5');
  });
  it('수동 상환 줄은 앱에 유지하고 서버 예약 발행은 배제한다',()=>{
    const loan={...t,dir:'출금' as const,mode:'상환' as const,principal:100,interest:10,loanCode:'260'};
    expect(buildCashVoucher(loan,'2026-02')).toMatchObject({amount:110,lines:[{accountCode:'260',amount:100,note:'원금'},{accountCode:'931',amount:10,note:'이자'}]});
    expect(autoVoucherDraft(loan,'2026-02','2026-02-28')).toEqual({skip:'대출 상환 분할 필요'});
  });
});
