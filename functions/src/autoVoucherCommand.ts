import { recordScheduledLoanMovement } from './loanMovementCommand';
import type * as admin from 'firebase-admin';
import { autoVoucherDraft, scheduledAccountName, scheduledCashAccountId } from './autoVoucherDraft';
import { issueVoucher } from './voucherIssue';

/** The scheduler and tests both enter through this complete issue command. */
export async function issueScheduledVoucher(
  db: admin.firestore.Firestore,
  template: Parameters<typeof autoVoucherDraft>[0],
  yearMonth: string,
  issueDate: string,
  releaseId: string,
) {
  if (template.mode === '상환' && template.loanId && (template.companyId === 'taebaek' || template.companyId === 'punghoe'))
    return recordScheduledLoanMovement(db, template.id, template.companyId, yearMonth, issueDate, releaseId);
  let decision = autoVoucherDraft(template, yearMonth, issueDate);
  if (decision.loan) return recordScheduledLoanMovement(db, template.id, decision.loan.companyId, yearMonth, issueDate, releaseId);
  if (!decision.draft) return { skip: decision.skip ?? '대출 연결 양식 아님' };
  if (decision.draft.kind === 'cashEntries') {
    const accounts = await db.collection('cashAccounts').get();
    const accountId = scheduledCashAccountId(accounts.docs.map(doc => ({ ...doc.data(), id: doc.id })), decision.draft.companyId);
    decision = autoVoucherDraft(template, yearMonth, issueDate, accountId);
    if (!decision.draft) return { skip: decision.skip ?? '대출 연결 양식 아님' };
  } else {
    const accounts = await db.collection('accountCodes').get();
    if (decision.draft.document.type === '비용' && template.statementType === '비용') {
      const have = new Set(accounts.docs.filter(doc => doc.data().companyId === decision.draft!.companyId)
        .map(doc => String(doc.data().code ?? '')));
      const codes = [template.accountCode, ...(template.transferLines ?? []).map(line => (line as { accountCode?: string }).accountCode)];
      const missing = [...new Set(codes.filter((code): code is string => !!code && !have.has(code)))];
      if (missing.length) return { skip: `현재 회사 계정표에 없는 계정: ${missing.join(', ')}` };
    }
    const accountName = scheduledAccountName(accounts.docs.map(doc => ({ ...doc.data(), id: doc.id })),
      decision.draft.companyId, String(template.accountCode ?? ''));
    decision = autoVoucherDraft(template, yearMonth, issueDate, '', accountName);
    if (!decision.draft) return { skip: decision.skip ?? '대출 연결 양식 아님' };
  }
  const { kind, companyId, operationId, tradeDate, document } = decision.draft;
  const result = await issueVoucher(db, companyId, { kind, operationId, tradeDate, document, releaseId, prefix: document.type === '비용' ? '대체' : '' });
  return { result };
}
