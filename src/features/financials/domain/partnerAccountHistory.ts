import { AccountCode, CashEntry, CompanyId, IssuedStatement, JournalEntry, companyOf } from "../../../shared/types";
import { STANDARD_ACCOUNT } from "../../../shared/accountChart";
import { AR, AP, OTHER_PAYABLE } from "../../../shared/autoJournal";

// ── 거래처원장 ────────────────────────────────────────────────────────────────

export type PartnerHistorySource = 'statement' | 'cash' | 'manual';

export const PARTNER_BALANCE_CODES = [AR, AP, OTHER_PAYABLE, STANDARD_ACCOUNT.PREPAID, STANDARD_ACCOUNT.ADVANCE_RECEIVED];

/** 원문서당 한 행. 원본 종류를 키에 넣어 같은 ID의 자금·전표가 서로 덮이지 않게 한다. */
export function partnerAccountHistory(
  partnerId: string,
  statements: IssuedStatement[],
  cashEntries: CashEntry[],
  entries: JournalEntry[],
  skipped: { sourceType: string; id: string; reason: string }[] = [],
  companyId?: CompanyId,
) {
  const stmt = new Map(statements.filter(s => !companyId || companyOf(s) === companyId).map(s => [s.id, s]));
  const cash = new Map(cashEntries.filter(e => !companyId || companyOf(e) === companyId).map(e => [e.id, e]));
  const stmtIds = new Set(statements.map(s => s.id));
  const cashIds = new Set(cashEntries.map(e => e.id));
  const sourceOf = (type: string): PartnerHistorySource => type === '자금' ? 'cash' : type === '수동' ? 'manual' : 'statement';
  const eventKey = (type: PartnerHistorySource, id: string, original?: { companyId?: CompanyId }) => `${companyId ?? companyOf(original)}:${type}:${id}`;
  const invalid = new Map(skipped.map(item => [`${sourceOf(item.sourceType)}:${item.id}`, item.reason]));
  const history = new Map<string, { key: string; date: string; sourceType: PartnerHistorySource; sourceId: string;
    docNo: string; label: string; kind: string; warning?: string; accounts: string[];
    lines: { accountCode: string; debit: number; credit: number }[] }>();
  const rows: { key: string; eventKey: string; date: string; accountCode: string; debit: number; credit: number; opening: boolean }[] = [];
  for (const s of stmt.values()) if (s.partnerId === partnerId) history.set(eventKey('statement', s.id, s), {
    key: eventKey('statement', s.id, s), sourceType: 'statement', sourceId: s.id, date: s.tradeDate, docNo: s.docNo ?? '',
    kind: s.type === '비용' ? '대체' : s.type, label: s.items?.map(item => item.name).filter(Boolean).join(', ') || s.partnerName || '전표',
    accounts: [...new Set(s.items?.map(item => String(item.accountCode ?? '')).filter(Boolean))], lines: [],
  });
  for (const e of cash.values()) if (e.partnerId === partnerId) history.set(eventKey('cash', e.id, e), {
    key: eventKey('cash', e.id, e), sourceType: 'cash', sourceId: e.id, date: e.date, docNo: e.docNo ?? '',
    kind: e.dir, label: e.note || '자금전표',
    accounts: [...new Set((e.lines?.length ? e.lines.map(line => line.accountCode) : [e.accountCode]).filter(Boolean).map(String))], lines: [],
  });
  const seenJournals = new Set<string>();
  for (const je of entries) {
    const sourceType = sourceOf(je.sourceType);
    const sourceId = sourceType === 'manual' ? je.id : je.sourceId ?? je.id;
    const original = sourceType === 'cash' ? cash.get(sourceId) : sourceType === 'statement' ? stmt.get(sourceId) : undefined;
    // 분개에는 회사가 없으므로 원본 연결로 가른다. 다른 회사 원본은 거래처가 같아도 제외한다.
    const outside = sourceType === 'cash' ? cashIds.has(sourceId) : stmtIds.has(sourceId);
    if (sourceType !== 'manual' && outside && !original) continue;
    if (companyId && sourceType === 'manual' && companyOf(je as JournalEntry & { companyId?: CompanyId }) !== companyId) continue;
    const tagged = je.lines.some(line => line.partnerId === partnerId);
    if (original?.partnerId !== partnerId && !tagged) continue;
    const sourceKey = `${sourceType}:${sourceId}`;
    const key = eventKey(sourceType, sourceId, original ?? (je as JournalEntry & { companyId?: CompanyId }));
    const journalKey = `${key}:${je.id}`;
    if (seenJournals.has(journalKey)) continue;
    seenJournals.add(journalKey);
    const existing = history.get(key);
    const event: NonNullable<typeof existing> = existing ?? { key, sourceType, sourceId, date: je.date, docNo: original?.docNo ?? '', kind: je.sourceType,
      label: je.memo || '분개', accounts: [], lines: [] };
    event.accounts = [...new Set([...event.accounts, ...je.lines.map(line => String(line.accountCode))])];
    event.lines.push(...je.lines.map(line => ({ accountCode: String(line.accountCode), debit: line.debit ?? 0, credit: line.credit ?? 0 })));
    if (!original && sourceType !== 'manual') event.warning = '원본 확인 필요';
    if (invalid.has(sourceKey)) event.warning = `분개 확인 필요: ${invalid.get(sourceKey)}`;
    history.set(key, event);
    if (invalid.has(sourceKey) || (!original && sourceType !== 'manual')) continue;
    je.lines.forEach((line, index) => {
      // 대체의 선급·선수금에는 옛 분개가 거래처 ID를 달지 않았다. 원본 거래처가 있는
      // 채권·채무 계정만 읽기 중에 보완하고, 예금·매출·비용 상대변을 거래처 잔액으로 넘기지 않는다.
      const connected = line.partnerId === partnerId || (!line.partnerId && original?.partnerId === partnerId
        && sourceType === 'statement' && je.sourceType === '대체' && [STANDARD_ACCOUNT.PREPAID, STANDARD_ACCOUNT.ADVANCE_RECEIVED].some(code => code === String(line.accountCode)));
      if (!connected) return;
      rows.push({ key: `${key}:${je.id}:${index}`, eventKey: key, date: je.date, accountCode: String(line.accountCode),
        debit: line.debit ?? 0, credit: line.credit ?? 0,
        opening: (sourceType === 'statement' && String(original?.docNo ?? '').includes('기초'))
          || (sourceType === 'manual' && je.id === 'je-opening'),
      });
    });
  }
  for (const [key, reason] of invalid) {
    for (const event of history.values()) if (`${event.sourceType}:${event.sourceId}` === key)
      event.warning = `분개 확인 필요: ${reason}`;
  }
  return { history: [...history.values()].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key)),
    rows: rows.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key)) };
}

/** 부호는 계정의 정상방향. 자산·부채·선급·선수를 한 순액으로 합치지 않는다. */
export function partnerAccountBalances(
  rows: ReturnType<typeof partnerAccountHistory>['rows'], accounts: AccountCode[], from = '', to = '',
) {
  const codes = [...new Set([...PARTNER_BALANCE_CODES, ...rows.map(row => row.accountCode)])].sort();
  const round = (amount: number) => {
    const rounded = Math.round(amount * 100) / 100;
    return rounded === 0 ? 0 : rounded;
  };
  return codes.map(code => {
    const account = accounts.find(a => String(a.code) === code);
    const normalBalance = account?.normalBalance ?? ([AP, OTHER_PAYABLE, STANDARD_ACCOUNT.ADVANCE_RECEIVED].includes(code) ? 'credit' : 'debit');
    const sign = normalBalance === 'credit' ? -1 : 1;
    const relevant = rows.filter(row => row.accountCode === code && (!to || row.date <= to));
    const opening = round(sign * relevant.filter(row => row.opening || (from && row.date < from))
      .reduce((n, row) => n + row.debit - row.credit, 0));
    const period = relevant.filter(row => !row.opening && (!from || row.date >= from));
    const debit = round(period.reduce((n, row) => n + row.debit, 0));
    const credit = round(period.reduce((n, row) => n + row.credit, 0));
    return { code, name: account?.name ?? ({ [AR]: '외상매출금', [AP]: '외상매입금', [OTHER_PAYABLE]: '미지급금', [STANDARD_ACCOUNT.PREPAID]: '선급금', [STANDARD_ACCOUNT.ADVANCE_RECEIVED]: '선수금' }[code] ?? '계정 미정'),
      normalBalance, opening, debit, credit, closing: round(opening + sign * (debit - credit)), rows: period };
  });
}
