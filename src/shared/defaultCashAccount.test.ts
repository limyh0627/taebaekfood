import { expect, it } from 'vitest';
import { defaultCashAccountId } from './defaultCashAccount';
import type { CashAccount } from './types';
const account = (id: string, companyId = 'taebaek', active = true) => ({ id, companyId, active, name: '통장', type: '통장' }) as CashAccount;
it('다른 계좌가 먼저 있어도 이름과 무관하게 같은 회사 메인 ID를 기본으로 쓴다', () => {
 expect(defaultCashAccountId([account('other'), { ...account('cashacct-temp-main'), name: '농협은행 351-0526-3164-13' }], 'taebaek')).toBe('cashacct-temp-main');
});
it('다른 회사 메인과 비활성 계좌를 기본값으로 쓰지 않는다', () => {
 expect(defaultCashAccountId([account('cashacct-temp-main'), account('own', 'punghoe')], 'punghoe')).toBe('own');
 expect(defaultCashAccountId([account('cashacct-temp-main', 'taebaek', false)], 'taebaek')).toBe('');
});
it('옛 태백 계좌는 회사 필드가 없어도 선택하며 계좌가 없으면 비워 둔다', () => {
 expect(defaultCashAccountId([{ ...account('cashacct-temp-main'), companyId: undefined }], 'taebaek')).toBe('cashacct-temp-main');
 expect(defaultCashAccountId([], 'punghoe')).toBe('');
});
