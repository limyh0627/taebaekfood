import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { isSaleTaxExempt } from './partnerPrice';
import type { PartnerItem } from './types';

const 줄 = (partnerId: string, price: number, taxType?: '과세' | '면세'): PartnerItem =>
  ({ id: `${partnerId}`, itemId: 'A', partnerId, price, taxType, Direction: 'out' } as PartnerItem);

/**
 * **과세·면세는 거래처–품목 연결이 안다.**
 *
 * 품목에도 `taxType` 이 있었다(2026-09-06 사장님: "품목에 과세 면세 정보가 없는게 맞는거
 * 같다니까"). 원가에서 ×1.1을 걷어낸 뒤로 할 일이 없어졌고, 남은 쓰임은 전부
 * "이 판매가에 부가세가 붙어 있나"였다 — 그건 거래처마다 다르다.
 * 화면들이 거래처 단가를 보여주면서 면세 여부만 품목에서 읽어 어긋나 있었다.
 */
describe('판매가가 면세인가', () => {
  it('거래처를 짚으면 그 연결을 본다', () => {
    const ps = [줄('동우', 1000, '면세'), 줄('한성', 1200, '과세')];
    expect(isSaleTaxExempt(ps, 'A', '동우')).toBe(true);
    expect(isSaleTaxExempt(ps, 'A', '한성')).toBe(false);
  });

  it('거래처를 안 짚으면 가장 싼 단가의 줄을 본다 — 마진을 제일 나쁜 경우로 잡는 것과 짝이다', () => {
    expect(isSaleTaxExempt([줄('동우', 1000, '면세'), 줄('한성', 1200, '과세')], 'A')).toBe(true);
    expect(isSaleTaxExempt([줄('동우', 1400, '면세'), 줄('한성', 1200, '과세')], 'A')).toBe(false);
  });

  it('안 정했으면 과세로 본다 — 면세로 보면 세금이 조용히 빠진다', () => {
    expect(isSaleTaxExempt([줄('동우', 1000)], 'A')).toBe(false);
    expect(isSaleTaxExempt([], 'A')).toBe(false);
    expect(isSaleTaxExempt(undefined, 'A')).toBe(false);
  });

  it('매입 줄은 안 본다 — 판매가 이야기다', () => {
    const 매입 = { id: 'i', itemId: 'A', partnerId: '농협', price: 900, taxType: '면세', Direction: 'in' } as PartnerItem;
    expect(isSaleTaxExempt([매입], 'A')).toBe(false);
  });
});

const 볼파일 = globSync('{components,src}/**/*.{ts,tsx}')
  .filter(f => !f.includes('.test.'));

describe('품목에서 과세·면세를 읽지 않는다', () => {
  it('items 의 taxType 을 보는 곳이 없다', () => {
    const 걸림: string[] = [];
    for (const file of 볼파일) {
      readFileSync(file, 'utf8').split('\n').forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('//') || t.startsWith('*')) return;
        //  **품목**에서 읽는 모양만 잡는다 — `item.taxType` · `product.taxType`.
        //  이름이 `p`·`x` 인 것까지 잡았더니 비용 프리셋(택배비·상차비)의 제 필드가 걸렸다.
        //  연결(pc·ps·psOut·partnerItem…)에서 읽는 건 옳은 자리라 안 잡는다.
        if (/\b(?:item|product|prod)\.taxType\b/.test(l)) {
          걸림.push(`  ${file}:${i + 1}  ${t.slice(0, 90)}`);
        }
      });
    }
    expect(걸림, `품목에서 과세·면세를 읽는 곳:\n${걸림.join('\n')}\n\n` +
      `shared/partnerPrice 의 isSaleTaxExempt 를 써라 — 거래처–품목 연결이 안다.`).toEqual([]);
  });
});
