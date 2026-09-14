import type { IssuedStatement } from '../../../shared/types';

/**
 * **세무 증빙을 무엇으로 했나** — 전표 목록에서 바로 고른다.
 *
 * 2026-09-15 사장님:
 *   "증빙 상태 (세금계산서 발행 / 미발행 / 현금영수증) … 매출에 대한 세무 증빙 처리 여부를
 *    즉시 확인하여 누락을 방지합니다. 이것도 열하나 넣어줘"
 *   "매입 증빙 유형: 세금계산서, 계산서(면세), 신용카드, 현금영수증, 간이영수증 등 증빙 종류 구분"
 *
 * **매출과 매입은 고를 것이 다르다.** 파는 쪽은 우리가 끊는 것이라 세 가지뿐이고,
 * 사는 쪽은 상대가 주는 것이라 카드전표·간이영수증까지 들어온다. 한 목록으로 뭉치면
 * 매출에 '간이영수증' 같은, 우리가 끊을 수 없는 것이 뜬다.
 */
export const EVIDENCE_SALE = ['미발행', '세금계산서', '현금영수증'] as const;
export const EVIDENCE_BUY = ['미수취', '세금계산서', '계산서(면세)', '신용카드', '현금영수증', '간이영수증'] as const;

export type EvidenceType = typeof EVIDENCE_SALE[number] | typeof EVIDENCE_BUY[number];

/** 이 전표에서 고를 수 있는 증빙. 매출·매입이 아닌 전표(대체·비용)는 고를 것이 없다. */
export function evidenceChoices(type: string | undefined): readonly EvidenceType[] {
  if (type === '매출') return EVIDENCE_SALE;
  if (type === '매입') return EVIDENCE_BUY;
  return [];
}

/** 안 골랐을 때의 값 — 매출은 '미발행', 매입은 '미수취'. 우리가 끊는 것과 받는 것의 차이다. */
export const evidenceDefault = (type: string | undefined): EvidenceType =>
  type === '매입' ? '미수취' : '미발행';

/**
 * 지금 이 전표의 증빙.
 *
 * **손으로 고른 것이 먼저다.** 안 골랐으면 `taxIssuedAt`(세금계산서를 실제로 끊은 시각)을
 * 본다 — 이미 끊어 놓고 '미발행'으로 보이면 그게 제일 나쁜 거짓말이다.
 */
export function evidenceOf(stmt: Pick<IssuedStatement, 'type' | 'taxIssuedAt'> & { evidence?: string }): EvidenceType {
  const 고른것 = (stmt.evidence ?? '').trim();
  const 목록 = evidenceChoices(stmt.type);
  if (고른것 && 목록.includes(고른것 as EvidenceType)) return 고른것 as EvidenceType;
  if (stmt.taxIssuedAt) return '세금계산서';
  return evidenceDefault(stmt.type);
}

/** 아직 증빙이 없는가 — 누락을 찾을 때 쓴다. */
export const evidenceMissing = (stmt: Parameters<typeof evidenceOf>[0]): boolean => {
  const 지금 = evidenceOf(stmt);
  return 지금 === '미발행' || 지금 === '미수취';
};
