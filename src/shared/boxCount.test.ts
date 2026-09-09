import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

/**
 * **"몇 박스인가"는 한 곳만 답한다** — [orderUnits.boxCountOf](./orderUnits.ts).
 *
 * 2026-09-09 사장님: "서류나 전표 쪽에서 박스품목 낱개로 풀때는 안쓰고?"
 * 쓰고 있었고, **재고 쪽과 똑같은 모양으로 어긋나 있었다.**
 *
 *     const boxCount = item.isBoxUnit && item.boxQuantity ? item.boxQuantity : item.quantity;
 *
 * 재고(`stockUnits`)와 전표(`resolveOrderItem`)가 이 줄을 따로 갖고 있었다.
 * 한쪽만 고치면 **전표에 찍힌 낱개 수와 재고에서 빠진 양이 갈린다** —
 * 무경유통에서 전표는 200낱개로 맞게 끊기고 재고만 2,000kg 빠진 게 그 꼴이다.
 *
 * ---
 * **향미유·고춧가루는 이 규칙 밖이다.** 그 상품은 재고가 낱개라 `isBoxUnit` 이 진짜 정보고,
 * 박스 수는 `quantity / 개입수` 로 낸다. 그래서 아래 봐주는것에 들어 있다.
 */
const 파일들 = globSync('{components,src}/**/*.{ts,tsx}')
  .map(f => f.replace(/\\/g, '/'))
  .filter(f => !f.includes('.test.'));

/** 이 줄이 바로 그 판단이다 — `isBoxUnit` 을 보고 `boxQuantity` 냐 `quantity` 냐를 고른다 */
const 그판단 = /isBoxUnit[\s\S]{0,40}?boxQuantity[\s\S]{0,60}?boxQuantity[\s\S]{0,40}?quantity/;

/**
 * 봐주는 것 — **이유를 같이 적는다.**
 *
 * `orderUnits.ts`      규칙이 사는 집이다.
 * `AdminApp.tsx`       향미유 겉박스 자재 소요량. 재고가 낱개인 상품이라 규칙이 다르다
 *                      (`quantity / 개입수`). 박스 품목이 아니다.
 * `rollbackSummary.ts` 되돌리기 안내문에 "몇 박스라고 말했는지"만 적는다. 숫자를 안 움직인다.
 */
const 봐주는것 = new Set([
  'src/shared/orderUnits.ts',
  'src/features/admin/AdminApp.tsx',
  'src/features/admin/rollbackSummary.ts',
  //  goodsShipQty — 향미유·고춧가루의 **낱개** 출고량을 낸다(`박스수 × 개입수`).
  //  박스 수를 내는 게 아니라 낱개 수를 내는 것이라 규칙 자체가 다르다.
  'src/features/admin/orderStockEngine.ts',
  //  주문카드의 향미유·고춧가루 칸에 `2B` 냐 `24개` 냐를 적는다. 숫자를 안 움직인다.
  //  그 상품은 재고가 낱개라 isBoxUnit 이 진짜 정보다.
  'components/OrdersList.tsx',
]);

describe('몇 박스인가는 한 곳만 답한다', () => {
  it('boxCountOf 말고 따로 판단하는 곳이 없다', () => {
    const 걸림: string[] = [];
    for (const f of 파일들) {
      if (봐주는것.has(f)) continue;
      const src = readFileSync(f, 'utf8');
      src.split('\n').forEach((l, i) => {
        if (그판단.test(l)) 걸림.push(`  ${f}:${i + 1}  ${l.trim().slice(0, 90)}`);
      });
    }
    expect(걸림, `'몇 박스인가'를 따로 판단하는 곳:\n${걸림.join('\n')}\n\n` +
      `orderUnits.boxCountOf 를 써라. 두 벌이면 재고와 전표가 갈린다.`).toEqual([]);
  });

  it('봐주는 파일이 실제로 있다 — 옮겨졌으면 목록에서 빼라', () => {
    const 없는것 = [...봐주는것].filter(f => !파일들.includes(f));
    expect(없는것, `봐주는 목록에 없는 파일이 있다:\n${없는것.join('\n')}`).toEqual([]);
  });
});
