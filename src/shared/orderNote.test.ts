import { describe, it, expect } from 'vitest';
import { clampNote, orderNotesForDisplay, migrateOrderItemNotes, noteEditLimit, NOTE_MAX } from './orderNote';

/** 카드·리스트·메모창이 같은 수를 봐야 한다(2026-09-15 사장님). */
describe('비고 길이', () => {
  it('50자까지만 남긴다', () => {
    expect(NOTE_MAX).toBe(50);
    expect(clampNote('가'.repeat(80))).toHaveLength(50);
    expect(clampNote('짧은 메모')).toBe('짧은 메모');
  });

  it('빈 값·없는 값도 받는다 — 붙여넣기로 들어오는 길이 여럿이다', () => {
    expect(clampNote('')).toBe('');
    expect(clampNote(undefined as unknown as string)).toBe('');
  });
});

describe('주문 비고 읽기', () => {
  it('활성 화면은 주문 비고 하나만 표시한다', () => {
    expect(orderNotesForDisplay({
      note: '공통 전달', noteImportant: true,
    })).toEqual([
      { text: '공통 전달', important: true },
    ]);
  });
});

describe('품목 비고 이관', () => {
  it('품목 문맥·긴 원문·중요를 합치고 원래 작성자와 재고 상태는 그대로 둔다', () => {
    const original = { note: '기존 주문 비고', noteBy: '원 작성자', noteAt: '2026-09-01', status: 'SHIPPED', stock: 3,
      items: [{ name: '참기름', quantity: 2, note: '가'.repeat(70), noteImportant: true, noteBy: '직원', noteAt: '2026-09-02' }, { name: '들기름', quantity: 4, note: '급함' }] };
    const result = migrateOrderItemNotes(original);
    expect(result.note).toBe(`기존 주문 비고\n참기름: ${'가'.repeat(70)}\n들기름: 급함`);
    expect(result.noteImportant).toBe(true);
    expect(result.noteBy).toBe('원 작성자');
    expect(result.noteAt).toBe('2026-09-01');
    expect(result.status).toBe('SHIPPED');
    expect(result.stock).toBe(3);
    expect(result.items).toEqual([{ name: '참기름', quantity: 2 }, { name: '들기름', quantity: 4 }]);
    expect(original.items[0].noteBy).toBe('직원');
    expect(migrateOrderItemNotes(result)).toBe(result);
  });
  it('빈 품목 메모의 작성 메타만 정리하고 기존 중요와 원문 공백을 보존한다', () => {
    const result = migrateOrderItemNotes({ note: '  원문  ', noteImportant: true, items: [{ name: '참기름', note: ' ', noteBy: '직원' }] });
    expect(result.note).toBe('  원문  ');
    expect(result.noteImportant).toBe(true);
    expect(result.items).toEqual([{ name: '참기름' }]);
  });
  it('이관 장문 편집은 50자로 강제 잘리지 않는다', () => {
    const original = '가'.repeat(90);
    expect(noteEditLimit(original)).toBe(90);
    expect(clampNote(original, original)).toBe(original);
    expect(clampNote('나' + original.slice(1), original)).toHaveLength(90);
    expect(clampNote('가'.repeat(80))).toHaveLength(50);
  });
  it('주문의 false 리터럴 중요표시도 품목의 true에 의해 바뀐다', () => {
    const result = migrateOrderItemNotes({ noteImportant: false as const, items: [{ name: '참기름', note: '급함', noteImportant: true }] });
    const important: boolean | undefined = result.noteImportant;
    expect(important).toBe(true);
    // @ts-expect-error 이관된 품목에는 note 속성이 더는 없다.
    expect(result.items[0].note).toBeUndefined();
  });
});
