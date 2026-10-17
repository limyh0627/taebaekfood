import { projectCashLines } from '../../../../functions/src/shared/cashLineProjection';
import type { CashEntry, IssuedStatement, JournalEntry, JournalLine } from '../../../shared/types';
import { r, sum, sourceTimestamp, BANK, AR, isPayableCode } from './journalSupport';

/**
 * 자금원장 CashEntry → 분개. 현금계정 ↔ 성격계정(accountCode).
 *   입금: (차) 보통예금  (대) accountCode [거래처]
 *   출금: (차) accountCode [거래처]  (대) 보통예금
 * cashAccountMap: cashAccountId → 계정코드(통장별). 없으면 BANK.
 * accountCode 미지정이면 분개 못 만듦(null).
 */
export function journalizeCashEntry(e: CashEntry, cashAccountMap: Record<string, string> = {}): JournalEntry | null {
  const amt = r(e.amount ?? 0);
  /*
   * 쪼갠 줄이 있으면 그쪽이 우선 — 대출상환이면 원금(차입금)·이자(비용)가 각각 선다.
   *   급여 지급: 총급여 3,000,000(차변) / 예수금 300,000(대변) → 통장에서 나간 건 2,700,000
   *     (차) 급여 3,000,000  (대) 예수금 300,000 + 보통예금 2,700,000
   *   이게 없으면 급여를 전표 두 건(출금·입금)으로 쪼개야 해서 목록에 두 줄로 보인다.
   *
   * **차·대를 읽는 길이 둘이다.**
   *   `side`가 있으면 그게 답이다(새로 쓰는 줄).
   *   없으면 옛 규칙 — 부호가 곧 차·대다. 양수면 통장 반대편, 음수면 통장과 같은 편.
   *
   * 옛 규칙은 뜻이 `dir`에 매달려 있어서, 같은 +3,000,000이 출금이면 차변 입금이면
   * 대변이었다. `dir`을 바꾸면 모든 줄이 조용히 뒤집힌다. 그래서 `side`로 옮긴다.
   * 아래 계산은 전부 **부호 있는 값**으로 돌므로, side를 부호로 한 번 바꿔 놓고 시작한다.
   */
  const { parts, total } = projectCashLines(e);
  if (!parts.length || (!e.lines?.some(line => line.accountCode && line.amount !== 0) && (!amt || !e.accountCode))) return null;
  if (!total && e.dir !== '대체') return null;
  const partner = e.partnerId ? { partnerId: e.partnerId } : {};
  // 대체(상계) — 돈이 안 움직였으니 **통장 줄을 세우지 않는다.**
  //   줄 부호가 차·대를 정한다: 양수 = 차변, 음수 = 대변.
  //   (차) 251 미지급금 / (대) 108 미수금 — 채권·채무끼리만 턴다.
  if (e.dir === '대체') {
    const tl: JournalLine[] = parts.map(p => ({
      accountCode: p.accountCode, ...partner,
      debit: p.amount > 0 ? p.amount : 0,
      credit: p.amount < 0 ? -p.amount : 0,
      ...(p.note ? { note: p.note } : {}),
    }));
    const dr = sum(tl.map(l => l.debit)), cr = sum(tl.map(l => l.credit));
    if (!dr || dr !== cr) return null;      // 차·대가 안 맞으면 안 만든다 — 반쪽 분개가 더 나쁘다
    return {
      id: `je-cash-${e.id}`, date: e.date, lines: tl,
      memo: `상계 ${e.partnerName ?? ''} ${e.note ?? ''}`.trim(),
      sourceType: '자금', sourceId: e.id, createdAt: sourceTimestamp(e.date, e.createdAt),
    };
  }
  const cash = cashAccountMap[e.cashAccountId] ?? BANK;
  // 입금이면 계정이 대변, 출금이면 차변. 음수 줄은 그 반대편으로 넘긴다.
  const side = (p: { accountCode: string; amount: number; note?: string }) => {
    const a = Math.abs(p.amount);
    const normal = e.dir === '입금' ? p.amount > 0 : p.amount > 0;   // 부호가 양수면 제자리
    const asCredit = e.dir === '입금' ? normal : !normal;
    return { accountCode: p.accountCode, ...partner, debit: asCredit ? 0 : a, credit: asCredit ? a : 0,
      ...(p.note ? { note: p.note } : {}) };
  };
  const bankNote = e.note ? { note: e.note } : {};
  const lines: JournalLine[] = e.dir === '입금'
    ? [{ accountCode: cash, debit: total, credit: 0, ...bankNote }, ...parts.map(side)]
    : [...parts.map(side), { accountCode: cash, debit: 0, credit: total, ...bankNote }];
  return {
    id: `je-cash-${e.id}`, date: e.date, lines,
    memo: `${e.dir} ${e.partnerName ?? ''} ${e.note ?? ''}`.trim(), sourceType: '자금', sourceId: e.id,
    createdAt: sourceTimestamp(e.date, e.createdAt),
  };
}

/**
 * 대체전표('비용' 타입) → 분개. 현금도 세금계산서도 없는 내부 대체 — 감가상각·퇴직급여충당 등.
 *
 * 전표는 줄마다 계정 하나만 들고 있으므로 차/대는 **계정의 정상방향(normalBalance)**으로 정한다.
 *   감가상각: (차) 818 감가상각비[비용=차변]      (대) 203 감가상각누계액[자산차감=대변]
 *   퇴직급여: (차) 535 퇴직급여충당금[비용=차변]   (대) 295 퇴직급여충당부채[부채=대변]
 *
 * 그래서 대체전표는 **양쪽을 다 적어야** 한다. 한쪽만 적으면 차·대가 안 맞아 분개를 만들지 않는다
 * (반쪽짜리를 분개로 만들면 시산표가 깨진다).
 */
export function journalizeTransfer(
  s: IssuedStatement,
  _normalOf?: (code: string) => 'debit' | 'credit',   // 더는 안 쓴다 — 차·대는 줄이 정한다
): JournalEntry | null {
  if (s.type !== '비용') return null;
  const items = s.items ?? [];
  if (items.some(it => !it.accountCode)) return null;
  const lines: JournalLine[] = [];
  let debit = 0, credit = 0;
  /*
   * 줄마다 **차·대를 그대로 읽는다.** 짐작하지 않는다.
   *
   * 실제 전표는 차변·대변 칸이 따로 있다. 전에는 칸이 없어서 계정의 정상 방향으로
   * 짐작했는데(감가상각비=차변, 충당금=대변), 자본을 차변에 세워야 하는 전표에서 어긋났다.
   *   기초 미지급  (차) 375 이월이익잉여금 / (대) 251 외상매입금
   * 375는 자본이라 정상이 대변이다. 짐작으로는 이 전표를 만들 수 없다.
   *
   * 차·대를 안 적은 줄이 있으면 **분개를 만들지 않는다.** 짐작으로 메우면 그 전표가
   * 조용히 틀린 방향으로 서고, 시산표는 맞아 보여서 못 찾는다.
   */
  for (const it of items) {
    if (it.side !== '차변' && it.side !== '대변') return null;
  }
  for (const it of items) {
    const amt = r(it.total ?? 0);
    if (!amt) continue;
    const code = it.accountCode!;
    // 채권·채무 줄에만 거래처를 붙인다 — 거래처별 잔액이 이 줄에서 나온다.
    // (감가상각처럼 상대가 없는 대체는 거래처가 없다)
    const who = (code === AR || isPayableCode(code)) && s.partnerId ? { partnerId: s.partnerId } : {};
    if (it.side === '차변') { lines.push({ accountCode: code, ...who, debit: amt, credit: 0 }); debit = r(debit + amt); }
    else { lines.push({ accountCode: code, ...who, debit: 0, credit: amt }); credit = r(credit + amt); }
  }
  if (lines.length < 2 || debit !== credit) return null;
  return {
    id: `je-${s.id}`, date: s.tradeDate, lines,
    memo: `대체 ${s.docNo ?? ''} ${s.partnerName ?? ''}`.trim(),
    sourceType: '대체', sourceId: s.id, createdAt: sourceTimestamp(s.tradeDate, s.issuedAt),
  };
}
