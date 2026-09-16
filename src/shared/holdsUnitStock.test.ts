import { describe, it, expect } from 'vitest';
import { holdsUnitStock } from './itemTaxonomy';

/**
 * **캔을 반제품으로 옮기면서 생긴 판정**(2026-09-16 사장님: "나머지 캔 제품들은 그냥
 * 그대로 반제품으로 서브타입만 바꾸면 돼").
 *
 * `type === 'product'` 만 보고 가르던 자리가 넷 있었다 — 생산 처리·출고 차감·원료 부족
 * 경고·제조일 점검. 캔을 `wip` 으로 바꾸면 그 넷이 조용히 캔을 빼서 **주문에 넣어 팔아도
 * 재고가 안 움직인다.** 그 판정을 여기 하나로 모았다.
 */

const 것 = (o: Record<string, unknown>) => o as { type?: string; unit?: string; subtype?: string };

describe('제 재고를 개수로 드는 품목인가', () => {
  it('완제품은 든다', () => {
    expect(holdsUnitStock(것({ type: 'product', unit: '개' }))).toBe(true);
    expect(holdsUnitStock(것({ type: 'product', unit: '병' }))).toBe(true);
  });

  it('**캔 반제품도 든다** — 여기가 이 판정을 만든 까닭이다', () => {
    expect(holdsUnitStock(것({ type: 'wip', subtype: '캔', unit: '개' }))).toBe(true);
  });

  it('**단위가 `캔`이어도 든다** — 단위 글자로 가르면 안 된다', () => {
    //  `시골향참기름1-캔/16.5kg` 은 단위가 '캔'이다. 엔진 한 곳이 `unit === '개'` 로만
    //  보고 있어서, 그대로 뒀으면 이 품목만 재고가 안 움직였다.
    expect(holdsUnitStock(것({ type: 'wip', subtype: '캔', unit: '캔' }))).toBe(true);
    expect(holdsUnitStock(것({ type: 'product', unit: '캔' }))).toBe(true);
  });

  it('subtype 이 안 박힌 옛 캔도 든다 — 풍회 것이 그렇다', () => {
    expect(holdsUnitStock(것({ type: 'wip', unit: '개' }))).toBe(true);
  });

  it('**벌크는 안 든다** — 로트가 재고를 들고 셈도 다른 길로 간다', () => {
    expect(holdsUnitStock(것({ type: 'wip', subtype: '벌크', unit: 'L' }))).toBe(false);
    expect(holdsUnitStock(것({ type: 'raw', subtype: '벌크', unit: 'kg' }))).toBe(false);
  });

  it('subtype 이 없어도 kg·L 이면 안 든다 — 옛 품목 대비', () => {
    expect(holdsUnitStock(것({ type: 'wip', unit: 'L' }))).toBe(false);
    expect(holdsUnitStock(것({ type: 'wip', unit: 'kg' }))).toBe(false);
  });

  it('원료·부자재는 안 든다 — 주문에 넣어 파는 것이 아니다', () => {
    expect(holdsUnitStock(것({ type: 'raw', unit: '개' }))).toBe(false);
    expect(holdsUnitStock(것({ type: 'submaterial', unit: '개' }))).toBe(false);
  });

  it('품목이 없어도 안 죽는다', () => {
    expect(holdsUnitStock(undefined)).toBe(false);
  });

  it('운영 데이터 그대로 — 캔 다섯이 전부 든다', () => {
    const 캔들 = [
      { type: 'product', subtype: '낱개', unit: '개' },    // 시골향들기름2-캔
      { type: 'product', subtype: '낱개', unit: '캔' },    // 시골향참기름1-캔
      { type: 'product', subtype: '낱개', unit: '개' },    // 시골향참기름3-캔
      { type: 'wip', subtype: '캔', unit: '개' },          // 깨분참기름/16.5kg (태백)
      { type: 'wip', subtype: '', unit: '개' },            // 깨분참기름/16.5kg (풍회)
    ];
    expect(캔들.every(c => holdsUnitStock(것(c)))).toBe(true);
  });
});
