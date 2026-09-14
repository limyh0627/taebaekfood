import { describe, it, expect } from 'vitest';
import { clampNote, noteChip, NOTE_MAX, NOTE_CHIP_CHARS } from './orderNote';

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

describe('카드에 얹을 비고 딱지', () => {
  it('다섯 글자를 넘으면 … 로 줄인다 — 줄이 접히면 카드가 길어진다', () => {
    expect(NOTE_CHIP_CHARS).toBe(5);
    expect(noteChip('비고테스트입니다')).toBe('비고테스트…');
  });

  it('다섯 글자까지는 그대로 둔다', () => {
    expect(noteChip('비고테스트')).toBe('비고테스트');
    expect(noteChip('급함')).toBe('급함');
  });

  it('앞뒤 빈칸은 떼고 센다 — 빈칸 때문에 … 가 붙으면 거짓말이 된다', () => {
    expect(noteChip('  급함  ')).toBe('급함');
  });

  it('비어 있으면 빈 글자', () => {
    expect(noteChip(undefined)).toBe('');
    expect(noteChip('   ')).toBe('');
  });
});
