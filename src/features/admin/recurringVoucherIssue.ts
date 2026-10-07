import { canAutoIssue, autoVoucherId, buildCashVoucher, buildStatementVoucher, dirOf, isCashDir } from '../../shared/autoVoucher';
import type { AccountCode, CashAccount, CashEntry, CompanyId, FixedCostTemplate, IssuedStatement } from '../../shared/types';
import { statementBlockReason } from '../../shared/statementGuard';
import { issueNumberedCashEntry, issueNumberedStatement } from '../statements/infrastructure/issueTradeStatementCommand';

export async function issueRecurringVouchers(input: {
  ym: string;
  onlyId?: string;
  companyId: CompanyId;
  createdBy?: string;
  templates: FixedCostTemplate[];
  cashEntries: Pick<CashEntry, 'id'>[];
  issuedStatements: Pick<IssuedStatement, 'id' | 'orderId'>[];
  cashAccounts: Pick<CashAccount, 'id' | 'active' | 'type'>[];
  accountCodes: Pick<AccountCode, 'code' | 'name'>[];
}): Promise<number> {
  const { ym, onlyId, companyId, createdBy, templates, cashEntries, issuedStatements, cashAccounts, accountCodes } = input;
  const defaultAcctId = cashAccounts.find(a => a.active && a.type !== '카드')?.id
    ?? cashAccounts.find(a => a.active)?.id ?? '';
  let created = 0;
  for (const t of templates.filter(t => canAutoIssue(t, ym) && (!onlyId || t.id === onlyId))) {
    const key = autoVoucherId(t, ym);
    const legacyKey = `RC-${t.id}-${ym}`;
    if (cashEntries.some(e => e.id === key || e.id === legacyKey)) continue;
    // 옛 RC 전표는 주문 키 없이 ID만 남은 것도 있어 함께 중복으로 본다.
    if (issuedStatements.some(s => s.id === key || s.id === legacyKey || s.orderId === key || s.orderId === legacyKey)) continue;
    const accountName = accountCodes.find(c => c.code === t.accountCode)?.name;
    // 번호와 본문을 서버에서 함께 저장해야 다른 기기의 동시 발행에도 번호가 겹치지 않는다.
    if (isCashDir(dirOf(t))) {
      await issueNumberedCashEntry({ ...buildCashVoucher(t, ym, { cashAccountId: defaultAcctId, accountName }), companyId, createdBy });
    } else {
      const statement = { ...buildStatementVoucher(t, ym, { docNo: '', accountName }), companyId, createdBy };
      const reason = statementBlockReason(statement);
      if (reason) throw new Error(`전표를 만들 수 없습니다 — ${reason}`);
      await issueNumberedStatement(statement);
    }
    created++;
  }
  return created;
}
