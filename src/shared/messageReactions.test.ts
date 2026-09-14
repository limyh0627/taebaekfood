import { describe, it, expect } from 'vitest';
import { toggleReaction, reactionChips, reactionTitle } from './messageReactions';

describe('toggleReaction — 눌렀다 뗐다', () => {
  it('없던 이모지를 누르면 생긴다', () => {
    expect(toggleReaction(undefined, '👍', 'e1')).toEqual({ '👍': ['e1'] });
  });

  it('같은 이모지를 다시 누르면 뗀다 — 그리고 **빈 줄은 아예 지운다**', () => {
    expect(toggleReaction({ '👍': ['e1'] }, '👍', 'e1')).toEqual({});
  });

  it('남이 눌러 둔 것에 얹힌다', () => {
    expect(toggleReaction({ '👍': ['e1'] }, '👍', 'e2')).toEqual({ '👍': ['e1', 'e2'] });
  });

  it('내가 뗘도 남의 것은 남는다', () => {
    expect(toggleReaction({ '👍': ['e1', 'e2'] }, '👍', 'e1')).toEqual({ '👍': ['e2'] });
  });

  it('한 사람이 여러 이모지를 남길 수 있다', () => {
    const 한번 = toggleReaction(undefined, '👍', 'e1');
    expect(toggleReaction(한번, '😂', 'e1')).toEqual({ '👍': ['e1'], '😂': ['e1'] });
  });

  it('원래 값을 건드리지 않는다 — 순수 함수다', () => {
    const 원본 = { '👍': ['e1'] };
    toggleReaction(원본, '👍', 'e2');
    expect(원본).toEqual({ '👍': ['e1'] });
  });
});

describe('reactionChips — 화면에 그릴 줄', () => {
  it('많이 눌린 것부터, 같으면 고르개 차례대로', () => {
    const r = { '😂': ['e1'], '👍': ['e1', 'e2'], '❤️': ['e3'] };
    expect(reactionChips(r, 'e1').map(c => c.emoji)).toEqual(['👍', '❤️', '😂']);
  });

  it('내가 눌렀는지 표시한다 — 칩 색이 갈린다', () => {
    const r = { '👍': ['e2'], '😂': ['e1'] };
    expect(reactionChips(r, 'e1')).toEqual([
      { emoji: '👍', count: 1, mine: false },
      { emoji: '😂', count: 1, mine: true },
    ]);
  });

  it('아무도 안 남긴 말은 빈 줄이다', () => {
    expect(reactionChips(undefined, 'e1')).toEqual([]);
    expect(reactionChips({ '👍': [] }, 'e1')).toEqual([]);
  });
});

describe('reactionTitle — 누가 눌렀나', () => {
  const 이름 = (id: string) => ({ e1: '남명숙', e2: '박은지' }[id]);

  it('사람 이름으로 이어 붙인다', () => {
    expect(reactionTitle({ '👍': ['e1', 'e2'] }, '👍', 이름)).toBe('남명숙, 박은지');
  });

  it('나간 직원은 건너뛴다 — 빈칸이 끼면 ", ," 가 된다', () => {
    expect(reactionTitle({ '👍': ['e1', '없는사람'] }, '👍', 이름)).toBe('남명숙');
  });
});
