import { describe, it, expect } from 'vitest';
import { colorOfName, subChipClass, CHIP_NEUTRAL } from './submaterialStyle';

/** 실제 DB에 있는 부자재 이름으로 검증한다 — 색 판정이 이름에 기대므로 오탐이 제일 무섭다. */
describe('colorOfName — 구분자 뒤의 색만 인정', () => {
  it('마개·테이프·페트병', () => {
    expect(colorOfName('물엿캡-빨강')).toBe('빨강');
    expect(colorOfName('물엿캡-골드')).toBe('골드');
    expect(colorOfName('물엿캡-연두')).toBe('연두');
    expect(colorOfName('병캡-주황')).toBe('주황');
    expect(colorOfName('이중캡-골드')).toBe('골드');
    expect(colorOfName('180ml캡-골드')).toBe('골드');
    expect(colorOfName('테이프-투명')).toBe('투명');
    expect(colorOfName('테이프-하양')).toBe('하양');
    expect(colorOfName('테이프-검정')).toBe('검정');
    expect(colorOfName('1800ML-페트병-노랑D')).toBe('노랑');
    expect(colorOfName('1800ML-페트병-빨강n')).toBe('빨강');
    expect(colorOfName('1500ML-페트병-노랑')).toBe('노랑');
  });

  it('괄호 안의 색도 인정 — 라벨', () => {
    expect(colorOfName('스마트스토어(골드)/1.8L')).toBe('골드');
    expect(colorOfName('스마트스토어(빨강)/1.8L')).toBe('빨강');
    expect(colorOfName('스마트스토어(갈색)/1.8L')).toBe('갈색');
    expect(colorOfName('스마트스토어(초록)/1.8L')).toBe('초록');
    expect(colorOfName('시골향 참3(검정)')).toBe('검정');
  });

  it('품목 이름에 색 글자가 들어간 것은 색이 아니다 ← 오탐 방지', () => {
    // '검정참깨'는 깨 이름이지 색이 아니다. 구분자 없이 붙어 있으면 안 잡힌다.
    expect(colorOfName('모란 검정참깨')).toBeNull();
    expect(colorOfName('시골향 볶음검정참깨')).toBeNull();
    expect(colorOfName('1KG-볶음검정깨')).toBeNull();
  });

  it('색이 없는 이름은 null', () => {
    expect(colorOfName('6호박스')).toBeNull();
    expect(colorOfName('1750ML-페트병')).toBeNull();
    expect(colorOfName('시골향 참① 1.8L')).toBeNull();
    expect(colorOfName(undefined)).toBeNull();
  });
});

describe('subChipClass', () => {
  it('박스는 색이 이름에 있어도 회색 통일', () => {
    expect(subChipClass({ subtype: '박스', name: '6호박스' })).toBe(CHIP_NEUTRAL);
    expect(subChipClass({ category: 'box', name: '테이프-빨강' })).toBe(CHIP_NEUTRAL);
  });

  it('색이 있으면 그 색, 없으면 회색', () => {
    expect(subChipClass({ subtype: '마개', name: '물엿캡-빨강' })).toContain('red');
    expect(subChipClass({ subtype: '테이프', name: '테이프-초록' })).toContain('green');
    expect(subChipClass({ subtype: '라벨', name: '시골향 참① 1.8L' })).toBe(CHIP_NEUTRAL);
  });
});
