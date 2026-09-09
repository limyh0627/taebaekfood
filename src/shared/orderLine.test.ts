import { describe, it, expect } from 'vitest';
import { lineOrdinal, lineCount, lineKeyAt, findLineIndex, lineSuffix } from './orderLine';

const 줄 = (itemId: string) => ({ itemId });
const 하나씩 = [줄('참기름'), 줄('들기름'), 줄('통깨')];
const 겹침 = [줄('참기름'), 줄('들기름'), 줄('참기름')];

describe('그 품목의 몇 번째 줄인가', () => {
  it('같은 품목끼리만 센다 — 주문 전체의 몇 번째가 아니다', () => {
    expect(lineOrdinal(겹침, 0)).toBe(1);   // 참기름 첫째
    expect(lineOrdinal(겹침, 1)).toBe(1);   // 들기름 첫째
    expect(lineOrdinal(겹침, 2)).toBe(2);   // 참기름 둘째
  });

  it('품목 id 가 없는 줄(택배비 같은 것)은 0', () => {
    expect(lineOrdinal([{ itemId: '' }], 0)).toBe(0);
  });

  it('몇 줄인지 센다', () => {
    expect(lineCount(겹침, '참기름')).toBe(2);
    expect(lineCount(겹침, '들기름')).toBe(1);
    expect(lineCount(겹침, '없는것')).toBe(0);
  });
});

describe('줄 이름표', () => {
  it('한 줄뿐이면 번째를 안 붙인다 — 대부분이 그렇다', () => {
    expect(lineKeyAt(하나씩, 0)).toBe('참기름');
    expect(lineKeyAt(하나씩, 1)).toBe('들기름');
  });

  it('두 줄이면 번째를 붙인다', () => {
    expect(lineKeyAt(겹침, 0)).toBe('참기름#1');
    expect(lineKeyAt(겹침, 2)).toBe('참기름#2');
    expect(lineKeyAt(겹침, 1)).toBe('들기름');      // 들기름은 한 줄뿐
  });

  it('품목 id 가 없으면 빈 이름표', () => {
    expect(lineKeyAt([{ itemId: '' }], 0)).toBe('');
  });
});

describe('이름표로 줄 되찾기', () => {
  it('번째가 붙은 이름표로 정확히 그 줄을 찾는다', () => {
    expect(findLineIndex(겹침, '참기름#1')).toBe(0);
    expect(findLineIndex(겹침, '참기름#2')).toBe(2);
    expect(findLineIndex(겹침, '들기름')).toBe(1);
  });

  it('**다른 품목을 지워도 안 밀린다** — 자리로 찾으면 여기서 틀린다', () => {
    const 들기름뺀뒤 = [줄('참기름'), 줄('참기름')];
    expect(findLineIndex(들기름뺀뒤, '참기름#2')).toBe(1);   // 자리로는 2번이었다
  });

  it('두 줄 중 하나를 지우면 남은 이름표는 못 찾는다 — 남은 줄로 체크가 옮겨 붙으면 안 된다', () => {
    const 하나지운뒤 = [줄('참기름'), 줄('들기름')];        // 참기름#2 가 사라졌다
    expect(findLineIndex(하나지운뒤, '참기름#2')).toBe(-1);
    expect(findLineIndex(하나지운뒤, '참기름#1')).toBe(0);
  });

  it('번째 없는 옛 이름표는 첫 줄로 본다 — 같은 품목이라 해롭지 않다', () => {
    expect(findLineIndex(겹침, '참기름')).toBe(0);
  });

  it('없는 품목·빈 이름표는 -1', () => {
    expect(findLineIndex(겹침, '없는것')).toBe(-1);
    expect(findLineIndex(겹침, '')).toBe(-1);
    expect(findLineIndex(겹침, undefined)).toBe(-1);
    expect(findLineIndex(겹침, '참기름#0')).toBe(-1);
    expect(findLineIndex(겹침, '참기름#9')).toBe(-1);
  });
});

describe('화면에 붙일 꼬리표', () => {
  it('두 줄일 때만 붙는다 — 주문카드와 작업순서가 같은 글자를 보여야 짝지어 볼 수 있다', () => {
    expect(lineSuffix(겹침, 0)).toBe('-1');
    expect(lineSuffix(겹침, 2)).toBe('-2');
    expect(lineSuffix(겹침, 1)).toBe('');       // 들기름은 한 줄
    expect(lineSuffix(하나씩, 0)).toBe('');
  });
});
