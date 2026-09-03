import type { CashEntry } from './types';
import { AR, AP } from './autoJournal';
import { stampFor } from './voucherStamp';

/**
 * **수금·지불 한 건을 만든다 — 셈은 여기 하나뿐이다.**
 *
 * 2026-09-03 에 세어 보니 같은 걸 짓는 자리가 셋이었다(거래처원장·반품처리·거래명세서).
 * 셋 다 "매출이면 108 입금, 매입이면 251 출금"을 손으로 적고 있었다.
 * 한 벌 더 적는 순간 갈릴 준비가 끝난다 — 그래서 여기로 모은다.
 *
 * **전표에 안 붙인다.** 받은 돈이 어느 청구서를 갚았는지는 배분(`allocatePartnerCash`)이
 * 오래된 것부터 알아서 맞춘다. 전표에 매다는 옛 경로(settlements)는 걷어냈다.
 *
 * 방향은 뜻이 정한다 —
 *
 *     매출 거래처에서 받는다   입금  108(외상매출금) 이 준다
 *     매입 거래처에 준다       출금  251(외상매입금) 이 준다
 *     그 되돌림(반품)          반대  부호가 아니라 방향을 뒤집는다
 */
export interface PaymentInput {
  partnerId: string;
  partnerName: string;
  /** 매출 거래처면 '매출'(받는다), 매입 거래처면 '매입'(준다) */
  type: '매출' | '매입';
  amount: number;
  date: string;
  note?: string;
  /** 되돌림(반품 등) — 방향을 뒤집는다 */
  reverse?: boolean;
  /** 안 주면 `cash-{지금}` */
  id?: string;
  /** 자금 전표번호. 없으면 비워 두지 말고 부르는 쪽이 `claimDocNo` 로 받아서 넘긴다 */
  docNo?: string;
  cashAccountId?: string;
}

export function buildPaymentEntry(input: PaymentInput): CashEntry {
  const { partnerId, partnerName, type, amount, date, note, reverse, id, docNo, cashAccountId } = input;
  const 매출 = type === '매출';
  //  매출이면 받는 것, 매입이면 주는 것. 되돌림이면 반대.
  const 입금 = reverse ? !매출 : 매출;
  return {
    id: id ?? `cash-${Date.now()}`,
    date,
    dir: 입금 ? '입금' : '출금',
    amount: Math.round(Number(amount) || 0),
    accountCode: 매출 ? AR : AP,
    cashAccountId: cashAccountId ?? '',
    partnerId,
    partnerName,
    note: note ?? `${partnerName} ${매출 ? '수금' : '지불'}`,
    ...(docNo ? { docNo } : {}),
    createdAt: stampFor(date),
  } as CashEntry;
}
