import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * **주문 목록과 전표 양식은 정반대로 뜬다.**
 *
 * 문지기가 네 곳에 흩어져 있다 — 목록 하나([OrderPicker](../../components/OrderPicker.tsx)),
 * 양식 셋([TradeStatement](../../components/TradeStatement.tsx)). **한쪽만 고치면
 * 둘이 같이 뜨거나 둘 다 안 뜬다.**
 *
 * 2026-09-07 사장님: "박스 누르려고 해도 그냥 직접입력으로 가버리네".
 * 문지기가 `selectedOrderId` 를 보고 있었는데 그건 `selectedOrderIds[0]` 이라
 * **체크를 하나 넣는 순간 값이 생겨** 목록이 닫혔다. 한 건만 고르던 시절의 찌꺼기다.
 *
 * 지금 규칙 — 고르는 동안은 목록에 남고, **'전표 작성 →'(`goCompose`)** 를 눌러야 넘어간다.
 */
const 목록 = readFileSync('components/OrderPicker.tsx', 'utf8');
const 양식 = readFileSync('components/TradeStatement.tsx', 'utf8');

describe('고르는 동안 목록에 남는다', () => {
  it('문지기가 selectedOrderId 를 안 본다', () => {
    const 걸림: string[] = [];
    for (const [이름, src] of [['OrderPicker', 목록], ['TradeStatement', 양식]] as const) {
      src.split('\n').forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('//') || t.startsWith('*')) return;
        if (/selectedOrderId\s*\|\|\s*manualMode/.test(l)) {
          걸림.push(`  ${이름}:${i + 1}  ${t.slice(0, 80)}`);
        }
      });
    }
    expect(걸림, `문지기가 selectedOrderId 를 보는 곳:\n${걸림.join('\n')}\n\n` +
      `selectedOrderId 는 selectedOrderIds[0] 라 첫 체크에 값이 생긴다 — 목록이 닫힌다.`)
      .toEqual([]);
  });

  it('목록과 양식의 문지기 수가 맞는다 — 짝이 어긋나면 둘이 같이 뜬다', () => {
    const 목록문 = (목록.match(/!\(manualMode \|\| editingStmt\)/g) ?? []).length;
    const 양식문 = (양식.match(/\(manualMode \|\| editingStmt\)/g) ?? []).length;
    expect(목록문, 'OrderPicker 의 목록 문지기가 없다').toBeGreaterThan(0);
    expect(양식문, 'TradeStatement 의 양식 문지기가 없다').toBeGreaterThan(0);
  });

  it("'전표 작성' 으로 넘어가는 길이 있다 — 없으면 고르고도 못 넘어간다", () => {
    expect(목록).toContain('goCompose');
    expect(양식).toContain('const goCompose = () => setManualMode(true)');
  });
});
