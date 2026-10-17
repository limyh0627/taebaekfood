import { expect, it, vi } from 'vitest';
import type { RawMaterialEntry, Order } from '../../../shared/types';
import { OrderStatus } from '../../../shared/types';
import { orderIndex } from '../../../shared/ledgerTrace';
import { DENSITY } from '../../../constants/formula';
import { buildRawLedgerRows } from './rawLedgerRows';
const row = (id: string, changes: Partial<RawMaterialEntry> = {}): RawMaterialEntry => ({ id, material: '참깨', date: '2026-10-18', createdAt: `2026-10-18T00:00:0${id}Z`, received: 0, used: 0, note: '', type: 'manual', ...changes });
it('전체 원장 누적을 유지하며 같은 날 정정 전·정정·정정 후 묶음을 분리한다', () => {
 const rows: RawMaterialEntry[] = [row('0', { date: '2026-10-17', received: 100 }), row('1', { received: 10 }), row('2', { type: 'correction', targetKg: 80 }), row('3', { used: 5 }), row('4', { type: 'correction', used: -2 }), row('5', { received: .125 })];
 const before = JSON.stringify(rows), remove = vi.fn();
 const result = buildRawLedgerRows(rows, [rows[5]], undefined, true, remove, new Map(), undefined);
 expect(result.map(g => ({ key: g.key, prev: g.prev, cur: g.cur, adj: g.adj, ids: g.rows.map(e => e.id), seq: g.seq }))).toEqual([
 { key: '참깨|2026-10-17#0', prev: 0, cur: 100, adj: 0, ids: ['0'], seq: 0 },
 { key: '참깨|2026-10-18#0', prev: 100, cur: 110, adj: 0, ids: ['1'], seq: 1 },
 { key: '참깨|2026-10-18#adj0', prev: 110, cur: 80, adj: -30, ids: ['2'], seq: 2 },
 { key: '참깨|2026-10-18#1', prev: 80, cur: 75, adj: 0, ids: ['3'], seq: 3 },
 { key: '참깨|2026-10-18#adj1', prev: 75, cur: 77, adj: 2, ids: ['4'], seq: 4 },
 { key: '참깨|2026-10-18#2', prev: 77, cur: 77.125, adj: 0, ids: ['5'], seq: 5 }]);
 expect(JSON.stringify(rows)).toBe(before); expect(remove).not.toHaveBeenCalled();
});
it('삭제 가능 ID·본인·주문 추적은 정본으로 계산하고 자동/취소정정은 삭제 대상에서 뺀다', () => {
 const order: Order = { id: 'o', cardNo: 'ORD-1', partnerName: '거래처', items: [], totalAmount: 0, status: OrderStatus.SHIPPED, createdAt: '', deliveryDate: '', email: '', source: '일반' };
 const rows = [row('1', { addedBy: '직원', note: '직접메모', received: 1 }), row('2', { type: 'auto', orderId: 'o', used: 1 }), row('3', { type: 'correction', kind: 'reverse', reversalOf: 'original', used: -1 })];
 const groups = buildRawLedgerRows(undefined, rows, '직원', true, vi.fn(), orderIndex([order]), () => []);
 expect(groups[0].delIds).toEqual(['1']); expect(groups[0].mine).toBe(true); expect([...groups[0].cards]).toEqual(['ORD-1']); expect([...groups[0].wheres]).toContain('거래처'); expect(groups[1].delIds).toEqual([]);
 expect(buildRawLedgerRows(undefined, rows, '다른직원', false, vi.fn(), orderIndex([order]), undefined).every(g => !g.mine && g.delIds.length === 0)).toBe(true);
 expect(buildRawLedgerRows(undefined, rows, undefined, true, undefined, new Map(), undefined).every(g => g.delIds.length === 0)).toBe(true);
});
it('옛 L 밀도와 업무 날짜 정렬을 재사용하고 처리시점 잔량으로 소급 계산을 덮지 않는다', () => {
 const material = '통깨참기름'; const density = DENSITY[material];
 const older = row('1', { material, received: 10, unit: 'L', balanceAfterKg: 999 });
 const newer = row('2', { material, used: 1, unit: 'L', recordedAt: '2026-10-18T01:00:00Z' });
 const [group] = buildRawLedgerRows(undefined, [newer, older], undefined, false, undefined, new Map(), undefined);
 expect(group.rows).toEqual([older, newer]); expect(group.received).toBe(Math.round(10 * density * 1000) / 1000); expect(group.used).toBe(density); expect(group.cur).toBe(Math.round(9 * density * 1000) / 1000);
});
