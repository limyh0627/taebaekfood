export type RecurringStatementType = '매출' | '매입' | '비용';
export type RecurringSource = {
  id?: string; dir?: string; statementType?: RecurringStatementType;
  partnerId?: string; name?: string; itemName?: string; amount?: number; accountCode?: string;
  taxExempt?: boolean; transferLines?: { accountCode?: string; side?: string; name?: string }[];
};
export const recurringDir = (t: Pick<RecurringSource, 'dir'>) => t.dir ?? '출금';
export const recurringId = (id: string, ym: string) => `AUTO-${id}-${ym}`;
export function recurringDate(ym: string, issueDay = 1, lastDay?: number): string {
  const [y, m] = ym.split('-').map(Number);
  const last = lastDay ?? new Date(y, m, 0).getDate();
  return `${ym}-${String(Math.min(Math.max(issueDay, 1), last)).padStart(2, '0')}`;
}
export function recurringType(t: Pick<RecurringSource, 'statementType' | 'dir' | 'partnerId'>): RecurringStatementType {
  if (t.statementType === '매출' || t.statementType === '매입' || t.statementType === '비용') return t.statementType;
  return recurringDir(t) === '받을돈' ? '매출' : t.partnerId ? '매입' : '비용';
}
export function recurringTransferItems(t: RecurringSource & { amount: number }) {
  return (t.transferLines ?? []).map(l => ({ name: l.name || t.name || '', accountCode: l.accountCode,
    side: l.side, spec: '', qty: 1, price: t.amount, supply: t.amount, tax: 0, total: t.amount, isTaxExempt: true }));
}
/** Caller validation and stamps stay in each adapter. Gross preserves the app's rounding contract. */
export function recurringStatement(t: RecurringSource & { amount: number }, accountName = '', gross = t.amount) {
  const type = recurringType(t), exempt = type === '비용' || !!t.taxExempt;
  const supply = exempt ? gross : Math.round(gross / 1.1), tax = gross - supply;
  const item = { name: t.itemName?.trim() || accountName || t.name || '', spec: '', qty: 1, price: t.amount,
    supply, tax, total: t.amount, isTaxExempt: exempt, accountCode: t.accountCode };
  return { type, totalSupply: supply, totalTax: tax, totalAmount: t.amount,
    items: type === '비용' && t.transferLines?.length ? recurringTransferItems(t) : [item] };
}
