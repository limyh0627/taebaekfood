import type { CashEntry, IssuedStatement, CompanyId } from './types';

/**
 * 회사 간 이체 — 한 회사 통장에서 **다른 회사 통장으로** 돈을 보내는 것.
 *
 * 태백푸드와 풍회유통은 별도 사업자다. 그런데 서로 거래도 한다(태백이 풍회에서 원료를 산다).
 * 그래서 돈을 보내면 **밀린 미지급금부터 털고**, 남는 것만 선급금이나 대여금이 된다.
 * 무턱대고 대여금으로 잡으면 미지급금이 영영 안 줄고 대여금만 쌓인다.
 *
 *   보낸 회사   (차) 251 외상매입금  상계분     (대) 103 보통예금  전액
 *               (차) 131 선급금      초과분              ← 물건을 받을 것이면
 *               (차) 137 대여금      초과분              ← 그냥 빌려준 것이면
 *
 *   받은 회사   (차) 103 보통예금  전액        (대) 108 외상매출금  상계분
 *                                              (대) 259 선수금      초과분
 *                                              (대) 267 차입금      초과분
 *
 * 두 장부에 **대칭으로** 서야 한다. 한쪽만 적으면 어긋나고, 그건 눈으로 못 잡는다.
 * 그래서 한 번에 두 건을 같이 만든다.
 */
export const AR = '108';         // 외상매출금 — 받을 쪽 채권
export const AP = '251';         // 외상매입금 — 보낼 쪽 채무
export const PREPAID = '131';    // 선급금 — 미리 준 물건값
export const ADVANCE_IN = '259'; // 선수금 — 미리 받은 물건값
export const LOAN_OUT = '137';   // 관계회사대여금 — 빌려준 것(자산)
export const LOAN_IN = '267';    // 관계회사차입금 — 빌린 것(부채)

/** 미지급을 넘는 돈의 성격 — 물건을 받을 것이면 선급금, 그냥 빌려준 것이면 대여금 */
export type OverKind = '선급금' | '대여금';

export interface TransferInput {
  from: CompanyId;
  to: CompanyId;
  date: string;
  amount: number;
  /** 보낸 회사가 받은 회사에 지고 있던 미지급 잔액 — 이만큼 먼저 턴다 */
  payableToTarget: number;
  /** 미지급을 넘는 몫의 성격 */
  overKind?: OverKind;
  fromAccountId?: string;
  toAccountId?: string;
  /** 상대 회사를 가리키는 거래처 id — 채권·채무가 그 거래처로 잡혀야 잔액이 준다 */
  fromPartnerId?: string;
  fromPartnerName?: string;
  toPartnerId?: string;
  toPartnerName?: string;
  note?: string;
}

export interface TransferSplit {
  /** 미지급 상계분 */
  offset: number;
  /** 넘는 몫 */
  over: number;
  overKind: OverKind;
}

/** 보낸 돈을 미지급 상계분과 초과분으로 가른다 */
export function splitTransfer(amount: number, payable: number, overKind: OverKind = '선급금'): TransferSplit {
  const offset = Math.max(0, Math.min(amount, payable));
  return { offset, over: Math.max(0, amount - offset), overKind };
}

export interface TransferResult {
  out: CashEntry;
  in: CashEntry;
  split: TransferSplit;
}

/** 회사 간 이체 두 건. 같은 stamp를 쓰므로 id로 짝을 찾을 수 있다. */
export function buildTransfer(t: TransferInput): TransferResult {
  const split = splitTransfer(t.amount, t.payableToTarget, t.overKind);
  const stamp = `ico-${Date.now()}`;
  const memo = t.note?.trim() || '회사 간 이체';
  const overOut = split.overKind === '선급금' ? PREPAID : LOAN_OUT;
  const overIn = split.overKind === '선급금' ? ADVANCE_IN : LOAN_IN;

  // 줄이 둘이면 lines로 적는다(한 줄이면 accountCode 하나). 합계는 언제나 보낸 금액.
  const outLines = [
    ...(split.offset > 0 ? [{ accountCode: AP, amount: split.offset, note: '미지급 상계' }] : []),
    ...(split.over > 0 ? [{ accountCode: overOut, amount: split.over, note: split.overKind }] : []),
  ];
  const inLines = [
    ...(split.offset > 0 ? [{ accountCode: AR, amount: split.offset, note: '미수 상계' }] : []),
    ...(split.over > 0 ? [{ accountCode: overIn, amount: split.over, note: split.overKind === '선급금' ? '선수금' : '차입금' }] : []),
  ];

  const base = { date: t.date, amount: t.amount, createdAt: new Date().toISOString() };
  return {
    split,
    out: {
      ...base,
      id: `${stamp}-out`,
      companyId: t.from,
      cashAccountId: t.fromAccountId ?? '',
      dir: '출금',
      ...(outLines.length > 1 ? { lines: outLines } : { accountCode: outLines[0]?.accountCode ?? overOut }),
      ...(t.fromPartnerId ? { partnerId: t.fromPartnerId, partnerName: t.fromPartnerName ?? '' } : {}),
      note: `${memo} · 보냄`,
    } as CashEntry,
    in: {
      ...base,
      id: `${stamp}-in`,
      companyId: t.to,
      cashAccountId: t.toAccountId ?? '',
      dir: '입금',
      ...(inLines.length > 1 ? { lines: inLines } : { accountCode: inLines[0]?.accountCode ?? overIn }),
      ...(t.toPartnerId ? { partnerId: t.toPartnerId, partnerName: t.toPartnerName ?? '' } : {}),
      note: `${memo} · 받음`,
    } as CashEntry,
  };
}

/**
 * 두 회사 사이 대여·차입 잔액. **같아야 정상이고, 다르면 한쪽이 빠진 것이다.**
 * (미지급 상계분은 거래처 잔액에서 따로 본다 — 여기서는 대여·차입만 센다.)
 */
export function interCompanyBalance(companyId: CompanyId, cashEntries: CashEntry[]): number {
  const want = companyId === 'taebaek' ? LOAN_OUT : LOAN_IN;
  const plus = want === LOAN_OUT ? '출금' : '입금';
  return cashEntries
    .filter(e => (e.companyId ?? 'taebaek') === companyId)
    .reduce((a, e) => {
      const parts = (e.lines ?? []).filter(l => l.accountCode === want);
      const v = parts.length ? parts.reduce((b, l) => b + l.amount, 0) : (e.accountCode === want ? e.amount : 0);
      return v ? a + (e.dir === plus ? v : -v) : a;
    }, 0);
}
