import { recurringDate, recurringDir, recurringId, recurringType, recurringStatement } from './shared/recurringVoucher';
type Company = 'taebaek' | 'punghoe';
type Template = {
  id: string; companyId?: string; autoIssue?: boolean; kind?: string;
  name?: string; itemName?: string; amount?: number; accountCode?: string;
  issueDay?: number; startYm?: string; endYm?: string;
  statementType?: '매출' | '매입' | '비용';
  dir?: string; mode?: string; loanId?: string;
  principal?: number; interest?: number; transferLines?: unknown[];
  partnerId?: string; partnerName?: string; taxExempt?: boolean;
};
type Draft = { kind: 'issuedStatements' | 'cashEntries'; companyId: Company; operationId: string; tradeDate: string; document: Record<string, unknown> };
export type AutoVoucherDecision = { skip: string; draft?: never } | { draft: Draft; skip?: never };

export function scheduledCashAccountId(accounts: Array<{ id: string; companyId?: string; active?: boolean; type?: string }>, companyId: Company): string {
  const active = accounts.filter(a => (a.companyId === companyId || (!a.companyId && companyId === 'taebaek')) && a.active)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return active.find(a => a.id === 'cashacct-temp-main')?.id ?? active.find(a => a.type !== '카드')?.id ?? active[0]?.id ?? '';
}

export function scheduledAccountName(accounts: Array<{ id: string; companyId?: string; code?: string; name?: string }>, companyId: Company, code: string): string | undefined {
  return accounts.filter(a => a.companyId === companyId).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .find(a => a.code === code)?.name;
}

/** Scheduler policy stays here; the app and scheduler consume the same pure projection. */
export function autoVoucherDraft(t: Template, ym: string, today: string, cashAccountId = '', accountName = ''): AutoVoucherDecision {
  if (!t.autoIssue) return { skip: '자동 발행 꺼짐' };
  if (t.kind === 'voucher') return { skip: '수동 전표 양식' };
  if (t.companyId !== 'taebaek' && t.companyId !== 'punghoe') return { skip: '회사 미지정' };
  if (!t.accountCode) return { skip: '계정 미지정' };
  if (typeof t.amount !== 'number' || !Number.isSafeInteger(t.amount) || t.amount <= 0) return { skip: '유효하지 않은 원화 총액' };
  if (!/^\d{4}-\d{2}$/.test(ym) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return { skip: '발행월/날짜 오류' };
  if (t.startYm && ym < t.startYm) return { skip: '시작월 이전' };
  if (t.endYm && ym > t.endYm) return { skip: '종료월 이후' };
  const [year, month] = ym.split('-').map(Number);
  if (month < 1 || month > 12 || today.slice(0, 7) !== ym) return { skip: '발행월/날짜 오류' };
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const issueDay = t.issueDay === undefined ? 1 : Number(t.issueDay);
  if (!Number.isFinite(issueDay)) return { skip: '발행일 오류' };
  const tradeDate = recurringDate(ym, Math.trunc(issueDay), last);
  if (today !== tradeDate) return { skip: '발행일 아님' };
  if (t.mode === '상환' || t.loanId || (t.principal ?? 0) > 0 || (t.interest ?? 0) > 0) return { skip: '대출 상환 분할 필요' };
  const dir = recurringDir({ ...t, dir: t.dir || undefined });
  if (dir === '회사이체') return { skip: '회사이체 원자 명령 필요' };
  if (!['입금', '출금', '줄돈', '받을돈', '대체'].includes(dir)) return { skip: '전표 갈래 오류' };
  const isCash = dir === '입금' || dir === '출금';
  if (isCash && t.transferLines?.length) return { skip: '대체 분개 줄 필요' };
  if (t.statementType !== undefined && !['매출', '매입', '비용'].includes(t.statementType)) return { skip: '전표 종류 오류' };
  const statementType = recurringType({ ...t, dir });
  if (!isCash && t.statementType && ((dir === '줄돈' && statementType !== '매입') || (dir === '받을돈' && statementType !== '매출')))
    return { skip: '전표 종류와 갈래 불일치' };
  const transferLines = (t.transferLines ?? []) as Array<{ accountCode?: string; side?: string; name?: string }>;
  if (!isCash && statementType === '비용') {
    if (t.statementType !== '비용' || transferLines.length !== 2
      || !transferLines.every(line => line && typeof line.accountCode === 'string' && !!line.accountCode)
      || transferLines.filter(line => line.side === '차변').length !== 1
      || transferLines.filter(line => line.side === '대변').length !== 1)
      return { skip: '대체 분개 줄 필요' };
  } else if (!t.statementType && transferLines.length) return { skip: '대체 분개 줄 필요' };
  if (!isCash && statementType !== '비용' && !t.partnerId) return { skip: '비현금 거래처 미지정' };
  const operationId = recurringId(t.id, ym);
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(operationId)) return { skip: '작업 ID 오류' };
  const base = { id: operationId, companyId: t.companyId };
  if (isCash) return { draft: {
    kind: 'cashEntries', companyId: t.companyId, operationId, tradeDate,
    document: { ...base, date: tradeDate, cashAccountId, dir, amount: t.amount,
      accountCode: t.accountCode, ...(t.partnerId ? { partnerId: t.partnerId, partnerName: t.partnerName ?? '' } : {}),
      note: `정기 · ${t.name ?? ''}${t.partnerName ? ` · ${t.partnerName}` : ''}`,
      createdAt: new Date().toISOString() },
  } };
  const projection = recurringStatement({ ...t, statementType, amount: t.amount, transferLines }, accountName);
  return { draft: {
    kind: 'issuedStatements', companyId: t.companyId, operationId, tradeDate,
    document: { ...base, issuedAt: new Date(`${tradeDate}T09:00:00+09:00`).toISOString(), tradeDate,
      partnerId: t.partnerId ?? '', partnerName: t.partnerName ?? '', orderId: operationId,
      ...projection,
    },
  } };
}
