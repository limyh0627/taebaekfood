import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { STATUS_LABEL, STATUS_COLOR, STATUS_HEAD, statusColor, statusLabel, statusChip } from './orderStatusStyle';
import { OrderStatus } from './types';

const 상태들 = [
  OrderStatus.PENDING, OrderStatus.PROCESSING, OrderStatus.DISPATCHED,
  OrderStatus.SHIPPED, OrderStatus.DELIVERED,
];

describe('주문 상태 색·이름', () => {
  it('다섯 상태가 이름·딱지색·머리색을 다 갖는다', () => {
    for (const s of 상태들) {
      expect(STATUS_LABEL[s], `${s} 이름`).toBeTruthy();
      expect(STATUS_COLOR[s], `${s} 딱지색`).toBeTruthy();
      expect(STATUS_HEAD[s], `${s} 머리색`).toBeTruthy();
    }
  });

  it('바탕과 글자 색이 같은 계열이다 — 하늘 배경에 분홍 글씨 같은 게 있었다', () => {
    for (const s of 상태들) {
      const 바탕 = /bg-([a-z]+)-/.exec(STATUS_COLOR[s])?.[1];
      const 글자 = /text-([a-z]+)-/.exec(STATUS_COLOR[s])?.[1];
      expect(글자, `${s}: ${STATUS_COLOR[s]}`).toBe(바탕);
    }
  });

  it('작업완료는 초록, 예전 주문은 회색 — 주문 화면 기준이다(2026-09-06 사장님)', () => {
    expect(STATUS_COLOR[OrderStatus.DISPATCHED]).toContain('emerald');
    expect(STATUS_COLOR[OrderStatus.DELIVERED]).toContain('slate');
    expect(STATUS_LABEL[OrderStatus.DELIVERED]).toBe('예전 주문');
  });

  it('모르는 상태는 회색으로 물러선다', () => {
    expect(statusColor('없는상태')).toContain('slate');
    expect(statusLabel(undefined)).toBe('');
    expect(statusChip('없는상태')).toContain('border-slate-200');
  });
});

/**
 * **상태 색을 화면마다 다시 적지 않는다.**
 *
 * 네 곳에 따로 있었고 **셋이 서로 달랐다**(2026-09-06) — 작업완료가 전표에선 하늘색,
 * 달력에선 보라, 배송관리에선 초록이었다. 같은 주문을 화면마다 다른 색으로 보게 된다.
 */
const 볼파일 = globSync('{components,src}/**/*.{ts,tsx}')
  .filter(f => !f.includes('.test.') && !f.replace(/\\/g, '/').endsWith('src/shared/orderStatusStyle.ts'));

describe('상태 색을 손으로 적지 않는다', () => {
  it('OrderStatus 에 색을 직접 붙인 곳이 없다', () => {
    const 걸림: string[] = [];
    for (const file of 볼파일) {
      readFileSync(file, 'utf8').split('\n').forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith('//') || t.startsWith('*')) return;
        //  `OrderStatus.X` 와 색 글자가 **같은 줄에 있으면** 잡는다 — switch·표·삼항 다.
        //  (처음엔 `X: 'bg-...'` 모양만 봤는데 삼항으로 쓴 걸 놓쳤다, 2026-09-06)
        if (/OrderStatus\.\w+/.test(l) && /'(?:bg-|text-)[a-z]+-\d/.test(l)) {
          걸림.push(`  ${file}:${i + 1}  ${t.slice(0, 80)}`);
        }
      });
    }
    expect(걸림, `상태 색을 손으로 적은 곳:\n${걸림.join('\n')}\n\n` +
      `shared/orderStatusStyle 의 statusColor · statusChip · STATUS_COLOR 를 써라.`).toEqual([]);
  });
});
