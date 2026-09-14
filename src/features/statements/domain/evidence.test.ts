import { describe, it, expect } from 'vitest';
import { evidenceChoices, evidenceDefault, evidenceOf, evidenceMissing, EVIDENCE_SALE, EVIDENCE_BUY } from './evidence';

/**
 * 세무 증빙(2026-09-15 사장님) — 매출은 우리가 끊는 것이라 셋뿐이고,
 * 매입은 상대가 주는 것이라 카드전표·간이영수증까지 들어온다.
 */
const 전표 = (over: Record<string, unknown> = {}) => ({ type: '매출', ...over } as never);

describe('고를 수 있는 증빙', () => {
  it('매출은 미발행·세금계산서·현금영수증 셋', () => {
    expect(evidenceChoices('매출')).toEqual(EVIDENCE_SALE);
    expect(EVIDENCE_SALE).toEqual(['미발행', '세금계산서', '현금영수증']);
  });

  it('매입은 계산서·카드·간이영수증까지 — 우리가 못 끊는 것도 받는다', () => {
    expect(evidenceChoices('매입')).toEqual(EVIDENCE_BUY);
    expect(EVIDENCE_BUY).toContain('간이영수증');
    expect(EVIDENCE_BUY).toContain('계산서(면세)');
  });

  it('매출·매입이 아닌 전표는 고를 것이 없다 — 대체·비용은 증빙을 주고받지 않는다', () => {
    expect(evidenceChoices('대체')).toEqual([]);
    expect(evidenceChoices(undefined)).toEqual([]);
  });

  it('안 골랐을 때 — 매출은 미발행, 매입은 미수취', () => {
    expect(evidenceDefault('매출')).toBe('미발행');
    expect(evidenceDefault('매입')).toBe('미수취');
  });
});

describe('지금 이 전표의 증빙', () => {
  it('손으로 고른 것이 먼저다', () => {
    expect(evidenceOf(전표({ evidence: '현금영수증' }))).toBe('현금영수증');
  });

  it('**이미 세금계산서를 끊었으면 미발행이라 하지 않는다** — 제일 나쁜 거짓말이다', () => {
    expect(evidenceOf(전표({ taxIssuedAt: '2026-09-10T01:00:00.000Z' }))).toBe('세금계산서');
  });

  it('고른 것이 그 갈래에 없는 값이면 무시한다 — 매출에 간이영수증은 못 온다', () => {
    expect(evidenceOf(전표({ evidence: '간이영수증' }))).toBe('미발행');
    expect(evidenceOf(전표({ type: '매입', evidence: '간이영수증' }))).toBe('간이영수증');
  });

  it('아무것도 없으면 갈래별 기본값', () => {
    expect(evidenceOf(전표())).toBe('미발행');
    expect(evidenceOf(전표({ type: '매입' }))).toBe('미수취');
  });
});

describe('증빙 누락', () => {
  it('미발행·미수취만 누락이다', () => {
    expect(evidenceMissing(전표())).toBe(true);
    expect(evidenceMissing(전표({ type: '매입' }))).toBe(true);
    expect(evidenceMissing(전표({ evidence: '세금계산서' }))).toBe(false);
    expect(evidenceMissing(전표({ taxIssuedAt: '2026-09-10T01:00:00.000Z' }))).toBe(false);
  });
});
