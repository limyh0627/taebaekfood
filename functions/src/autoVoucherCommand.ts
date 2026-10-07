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
  let decision = autoVoucherDraft(template, yearMonth, issueDate);
  if (!decision.draft) return decision;
  if (decision.draft.kind === 'cashEntries') {
    const accounts = await db.collection('cashAccounts').get();
    const accountId = scheduledCashAccountId(accounts.docs.map(doc => ({ ...doc.data(), id: doc.id })), decision.draft.companyId);
    decision = autoVoucherDraft(template, yearMonth, issueDate, accountId);
    if (!decision.draft) return decision;
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
    if (!decision.draft) return decision;
  }
  const { kind, companyId, operationId, tradeDate, document } = decision.draft;
  const result = await issueVoucher(db, companyId, { kind, operationId, tradeDate, document, releaseId, prefix: document.type === '비용' ? '대체' : '' });
  return { result };
}
