import { describe, it, expect } from 'vitest';
import { nextOrderNo, nextPoNo, cardNoLabel } from './cardNo';

/**
 * **카드번호는 전표번호와 같은 규칙이다** — `nextDocNo`(그날 최대 + 1).
 * 개수로 매기면 하나 지웠을 때 번호를 다시 쓴다 — 전표에서 이미 겪은 함정이다
 * (`2026-08-0216` 이 두 전표에 붙어 있었다).
 */
describe('주문 카드번호', () => {
  it('그날 첫 주문은 01', () => {
    expect(nextOrderNo('2026-09-01', [])).toBe('ORD-260901-001');
  });

  it('그날 쓰인 가장 큰 번호 + 1', () => {
    expect(nextOrderNo('2026-09-01', [{ cardNo: 'ORD-260901-01' }, { cardNo: 'ORD-260901-02' }]))
      .toBe('ORD-260901-003');
  });

  it('**지운 번호를 다시 안 쓴다** — 개수로 매기면 02 가 두 번 나온다', () => {
    //  01 과 03 만 남은 상태(02 를 지웠다)
    expect(nextOrderNo('2026-09-01', [{ cardNo: 'ORD-260901-01' }, { cardNo: 'ORD-260901-03' }]))
      .toBe('ORD-260901-004');
  });

  it('다른 날 번호는 안 본다 — 날짜가 접두사라 겹칠 수 없다', () => {
    expect(nextOrderNo('2026-09-02', [{ cardNo: 'ORD-260901-07' }])).toBe('ORD-260902-001');
  });

  it('번호가 없는 옛 카드는 세지 않는다', () => {
    expect(nextOrderNo('2026-09-01', [{}, { cardNo: undefined }])).toBe('ORD-260901-001');
  });

  it('발주는 PO- 로 — 주문과 번호가 안 섞인다', () => {
    expect(nextPoNo('2026-09-01', [])).toBe('PO-260901-001');
    expect(nextPoNo('2026-09-01', [{ cardNo: 'ORD-260901-05' }])).toBe('PO-260901-001');
  });

  it('아흔아홉을 넘어도 센다', () => {
    expect(nextOrderNo('2026-09-01', [{ cardNo: 'ORD-260901-99' }])).toBe('ORD-260901-100');
  });
});

describe('화면에 찍을 카드번호', () => {
  it('번호가 있으면 그대로', () => {
    expect(cardNoLabel({ id: 'ORD-1785712782954', cardNo: 'ORD-260901-01' })).toBe('ORD-260901-01');
  });

  it('**옛 카드는 id 뒤 여섯 자리로 물러선다** — 가리킬 이름은 있어야 한다', () => {
    expect(cardNoLabel({ id: 'ORD-1785712782954' })).toBe('#782954');
  });

  it('옛 카드도 그 여섯 자리로 찾힌다 — 목록 검색이 id 부분일치다', () => {
    const id = 'ORD-1785712782954';
    expect(id.includes(cardNoLabel({ id }).slice(1))).toBe(true);
  });

  it('아무것도 없으면 빈 글자 — 자리를 안 만든다', () => {
    expect(cardNoLabel(undefined)).toBe('');
    expect(cardNoLabel({ id: '' })).toBe('');
  });
});
