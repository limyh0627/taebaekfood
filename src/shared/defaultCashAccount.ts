import { companyOf, type CashAccount, type CompanyId } from './types';

/** 기본 계좌는 이름이 바뀌어도 같은 ID를 사용한다. 다른 회사 계좌는 선택하지 않는다. */
export function defaultCashAccountId(accounts: Pick<CashAccount, 'id' | 'active' | 'type' | 'companyId'>[], companyId: CompanyId): string {
  const available = accounts.filter(account => account.active && companyOf(account) === companyId);
  return available.find(account => account.id === 'cashacct-temp-main')?.id ?? available.find(account => account.type !== '카드')?.id ?? available[0]?.id ?? '';
}
