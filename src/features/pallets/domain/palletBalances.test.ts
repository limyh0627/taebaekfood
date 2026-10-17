import { expect, it } from 'vitest';
import { OrderStatus, type Order, type Partner, type PalletStock, type PalletTransaction } from '../../../shared/types';
import { buildPartnerPalletStats, filterPartnerPalletStatus, buildOutstandingByPallet } from './palletBalances';
const pallets: PalletStock[] = [{ id: 'id', name: 'KPP', total: 100, inUse: 999, damaged: 0 }];
const partners: Partner[] = [{ id: 'p', name: '거래처', type: '일반' }, { id: 'zero', name: '빈거래처', type: '일반' }];
const nameOf = (type?: string) => type ? pallets.find(p => p.id === type)?.name ?? type : '기타';
const order = (id: string, status: OrderStatus): Order => ({ id, partnerId: 'p', partnerName: '거래처옛이름', items: [], totalAmount: 0, status, createdAt: '', deliveryDate: '2026-10-18', email: '', source: '일반', pallets: [{ type: 'id', quantity: 2.5 }, { type: 'KPP', quantity: 9, isExchange: true }] });
const tx = (id: string, type: 'in' | 'out', quantity: number, extra: Partial<PalletTransaction> = {}): PalletTransaction => ({ id, partnerId: 'p', palletId: 'id', type, quantity, date: '2026-10-18', ...extra });
it('출고·배송완료만 잔량에 반영하며 교체와 이동은 제외하고 소수·이름/ID를 보존한다', () => {
 const orders = [order('s', OrderStatus.SHIPPED), order('d', OrderStatus.DELIVERED), order('dispatch', OrderStatus.DISPATCHED)];
 const transactions = [tx('in', 'in', 1.25), tx('out', 'out', .5), tx('transfer', 'out', 100, { isTransfer: true }), tx('missing', 'out', 2, { partnerId: 'missing', palletId: 'absent' })];
 const before = JSON.stringify({ orders, transactions, partners, pallets });
 const stats = buildPartnerPalletStats(orders, partners, transactions, pallets, nameOf);
 expect(stats).toEqual([{ id: 'p', name: '거래처', pallets: { KPP: -4.25 }, total: -4.25 }, { id: 'zero', name: '빈거래처', pallets: {}, total: 0 }, { id: 'missing', name: '알 수 없는 거래처', pallets: { 기타: -2 }, total: -2 }]);
 expect([...buildOutstandingByPallet(stats)]).toEqual([['KPP', 4.25], ['기타', 2]]);
 expect(JSON.stringify({ orders, transactions, partners, pallets })).toBe(before);
});
it('빈 검색은 팔레트별 비영 잔량을 보이며 공백 검색을 trim하여 바꾸지 않고 총량 절댓값 정렬한다', () => {
 const stats: ReturnType<typeof buildPartnerPalletStats> = [{ id: 'zero', name: 'ABC', pallets: {}, total: 0 }, { id: 'cancel', name: 'abc', pallets: { KPP: -2, 기타: 2 }, total: 0 }, { id: 'positive', name: 'ABC', pallets: { KPP: 3 }, total: 3 }, { id: 'negative', name: 'ABC', pallets: { KPP: -5 }, total: -5 }];
 expect(filterPartnerPalletStatus(stats, '').map(s => s.id)).toEqual(['negative', 'positive', 'cancel']);
 expect(filterPartnerPalletStatus(stats, 'aBc').map(s => s.id)).toEqual(['negative', 'positive', 'zero', 'cancel']);
 expect(filterPartnerPalletStatus(stats, ' ')).toEqual([]);
 expect([...buildOutstandingByPallet(stats)]).toEqual([['KPP', 7]]);
 expect(stats.map(s => s.id)).toEqual(['zero', 'cancel', 'positive', 'negative']);
});
it('없는 주문 거래처와 빈 팔레트는 원문 fallback으로 누적한다', () => {
 const o = { ...order('unknown', OrderStatus.SHIPPED), partnerId: undefined, pallets: [{ type: '', quantity: 0 }, { type: '옛이름', quantity: 1.5 }] };
 expect(buildPartnerPalletStats([o], [], [], pallets, nameOf)).toEqual([{ id: 'unknown', name: '거래처옛이름', pallets: { 기타: 0, 옛이름: -1.5 }, total: -1.5 }]);
});
