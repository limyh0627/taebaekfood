import { describe, it, expect } from 'vitest';
import { toKg, unitToKg, baseRawName, parsePackageKg, unitOf } from './formula';

describe('toKg — 제품 용량 → 원료 kg 환산', () => {
  it('ml/L은 밀도 적용 (통깨참기름 0.916)', () => {
    expect(toKg('300ml', '통깨참기름', 100)).toBeCloseTo(0.3 * 0.916 * 100, 6); // 27.48
    expect(toKg('1.8L', '통들깨들기름', 1)).toBeCloseTo(1.8 * 0.924, 6);        // 1.6632
  });
  it('g/kg은 밀도 미적용', () => {
    expect(toKg('200g', '깨분', 5)).toBeCloseTo(1, 6);   // 0.2 * 5
    expect(toKg('16.5kg', '참깨', 2)).toBeCloseTo(33, 6); // 16.5 * 2
  });
  it('파싱 실패 시 0', () => {
    expect(toKg('N/A', '참깨', 10)).toBe(0);
    expect(toKg('', '참깨', 10)).toBe(0);
  });
});

describe('unitToKg — 운영단위 → kg (기름만 밀도)', () => {
  it('L 원료는 ×밀도', () => {
    expect(unitToKg(10, '통깨참기름')).toBeCloseTo(9.16, 6);
    expect(unitOf('통깨참기름')).toBe('L');
  });
  it('kg 원료는 그대로', () => {
    expect(unitToKg(10, '참깨')).toBe(10);
    expect(unitOf('참깨')).toBe('kg');
  });
});

describe('baseRawName / parsePackageKg', () => {
  it('규격 접미사 제거', () => {
    expect(baseRawName('깨분참기름/16.5kg')).toBe('깨분참기름');
    expect(baseRawName('볶음들깨')).toBe('볶음들깨');
  });
  it('포장 kg 파싱', () => {
    expect(parsePackageKg('16.5kg')).toBe(16.5);
    expect(parsePackageKg('20kg')).toBe(20);
    expect(parsePackageKg('300ml')).toBeUndefined();
    expect(parsePackageKg(undefined)).toBeUndefined();
  });
});
