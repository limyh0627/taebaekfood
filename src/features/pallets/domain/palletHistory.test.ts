import { describe, expect, it } from 'vitest';
import { OrderStatus, type Order, type PalletStock, type PalletTransaction, type Partner } from '../../../shared/types';
import { buildPartnerPalletHistory, buildAvailablePalletMonths, buildPalletSummary, buildAllPalletHistory } from './palletHistory';
const order = (id: string, status: OrderStatus, extra: Partial<Order> = {}): Order => ({ id, partnerId: 'a', partnerName: '주문 거래처', items: [], totalAmount: 0, status, createdAt: '2026-10-01', deliveryDate: '2026-10-02T03:00:00Z', email: '', source: '일반', pallets: [{ type: 'p', quantity: 1.5 }], ...extra });
const tx = (id: string, extra: Partial<PalletTransaction> = {}): PalletTransaction => ({ id, partnerId: 'a', palletId: 'p', type: 'out', quantity: 2.5, date: '2026-10-02', ...extra });
const pallets: PalletStock[] = [{ id: 'p', name: '팔레트', total: 10, inUse: 0, damaged: 0 }];
const partners: Partner[] = [{ id: 'a', name: 'Alpha 거래처', type: '일반' }];
const nameOf = (type: string) => pallets.find(p => p.id === type || p.name === type)?.name || type;

describe('팔레트 조회 모델', () => {
  it('거래처 상세는 출고·배송중 주문의 교체까지 포함하고 배송완료·이동전표는 제외한다', () => {
    const orders = [order('출고', OrderStatus.SHIPPED), order('배송중', OrderStatus.DISPATCHED, { pallets: [{ type: '팔레트', quantity: 3.25, isExchange: true }] }), order('완료', OrderStatus.DELIVERED)];
    const transactions = [tx('수동'), tx('이동', { isTransfer: true }), tx('타사', { partnerId: 'b' })];
    const rows = buildPartnerPalletHistory('a', transactions, orders, pallets, '', nameOf);
    expect(rows.map(r => r.id)).toEqual(['수동', '출고-0', '배송중-0']);
    expect(rows[2]).toMatchObject({ palletName: '팔레트', quantity: 3.25, note: '주문 출고 (배송중)' });
    expect(rows[0]).toMatchObject({ note: '수동 출고', txId: '수동' });
    expect(buildPartnerPalletHistory(null, transactions, orders, pallets, '', nameOf)).toEqual([]);
  });
  it('상세 날짜는 부분 포함이고 최신 날짜 우선이며 같은 날짜 입력 순서와 수동 기본 문구를 보존한다', () => {
    const transactions = [tx('오래전', { date: '2025-10-02' }), tx('입고', { type: 'in', palletId: 'missing' }), tx('메모', { note: '직접 메모' }), tx('다른달', { date: '2026-11-02' })];
    const rows = buildPartnerPalletHistory('a', transactions, [], pallets, '10-02', nameOf);
    expect(rows.map(r => r.id)).toEqual(['입고', '메모', '오래전']);
    expect(rows[0]).toMatchObject({ note: '수동 입고', palletName: '기타' });
    expect(rows[1].note).toBe('직접 메모');
  });
  it('월 선택지는 현재월과 조회월을 유지하며 출고·완료 주문만 수집하고 중복 없이 내림차순이다', () => {
    const orders = [order('출고', OrderStatus.SHIPPED, { deliveryDate: '2026-08-01' }), order('완료', OrderStatus.DELIVERED, { deliveryDate: '2026-07-01' }), order('배송중', OrderStatus.DISPATCHED, { deliveryDate: '2026-09-01' }), order('빈팔레트', OrderStatus.SHIPPED, { deliveryDate: '2026-06-01', pallets: [] }), order('빈날짜', OrderStatus.SHIPPED, { deliveryDate: '' })];
    expect(buildAvailablePalletMonths([tx('수동'), tx('빈날짜', { date: '' })], orders, '2026-11', '2020-01')).toEqual(['2026-11', '2026-10', '2026-08', '2026-07', '2020-01']);
    expect(buildAvailablePalletMonths([], [], '2026-11', '')).toEqual(['2026-11']);
  });
  it('월 요약은 이동전표와 주문 교체를 제외하되 수동 교체중 소수 수량을 그대로 합산한다', () => {
    const transactions = [tx('출고', { status: '교체중' }), tx('입고', { type: 'in', quantity: 1.25 }), tx('이동', { quantity: 100, isTransfer: true, status: '교체중' }), tx('다른달', { date: '2026-09-01', quantity: 4 })];
    const orders = [order('출고', OrderStatus.SHIPPED, { pallets: [{ type: 'p', quantity: 0.5 }, { type: 'p', quantity: 99, isExchange: true }, { type: 'p', quantity: 0 }] }), order('완료', OrderStatus.DELIVERED), order('배송중', OrderStatus.DISPATCHED)];
    expect(buildPalletSummary(transactions, orders, '2026-10')).toEqual({ 입고: 1.25, 지급: 4.5, 교체중: 2.5 });
    expect(buildPalletSummary(transactions, orders, '').지급).toBe(8.5);
    expect(buildPalletSummary([], [], '')).toEqual({ 입고: 0, 지급: 0, 교체중: 0 });
  });
  it('전체 이력은 이동을 표시하고 출고·완료 주문의 일반 팔레트만 표시하며 거래처 이름 출처를 보존한다', () => {
    const rows = buildAllPalletHistory([tx('이동입', { type: 'in', isTransfer: true }), tx('이동출', { isTransfer: true }), tx('미상', { partnerId: 'missing', palletId: 'missing' })], [order('완료', OrderStatus.DELIVERED, { pallets: [{ type: 'p', quantity: 99, isExchange: true }, { type: '팔레트', quantity: 0 }] }), order('배송중', OrderStatus.DISPATCHED)], partners, pallets, '', '', nameOf);
    expect(rows.map(r => r.id)).toEqual(['이동입', '이동출', '미상', '완료-pl-0']);
    expect(rows[0]).toMatchObject({ partner: 'Alpha 거래처', status: '이동입고', txId: '이동입', note: '' });
    expect(rows[1].status).toBe('이동지급');
    expect(rows[2]).toMatchObject({ partner: '알 수 없음', pallet: '기타' });
    expect(rows[3]).toMatchObject({ partner: '주문 거래처', pallet: '팔레트', quantity: 0 });
  });
  it('전체 검색은 거래처 공백 제거·대소문자 무시, 월은 앞부분 일치이며 같은 날 등록시각 다음 안정 순서다', () => {
    const transactions = [tx('ptrans-10-a'), tx('기본'), tx('ptrans-20-a'), tx('ptrans-20-b'), tx('옛날', { date: '2025-10-02' }), tx('뒤에월', { date: 'x2026-10-02' })];
    const rows = buildAllPalletHistory(transactions, [], partners, pallets, '2026-10', ' ALPHA ', nameOf);
    expect(rows.map(r => r.id)).toEqual(['ptrans-20-a', 'ptrans-20-b', 'ptrans-10-a', '기본']);
    expect(buildAllPalletHistory(transactions, [], partners, pallets, '', '없음', nameOf)).toEqual([]);
  });
  it('모든 조회는 입력 배열과 주문·팔레트·거래처 원문을 바꾸지 않는다', () => {
    const inputs: [PalletTransaction[], Order[], PalletStock[], Partner[]] = [[tx('ptrans-2'), tx('ptrans-1')], [order('출고', OrderStatus.SHIPPED)], pallets, partners];
    const before = JSON.stringify(inputs);
    buildPartnerPalletHistory('a', inputs[0], inputs[1], pallets, '', nameOf);
    buildAvailablePalletMonths(inputs[0], inputs[1], '2026-10', '');
    buildPalletSummary(inputs[0], inputs[1], '');
    buildAllPalletHistory(inputs[0], inputs[1], partners, pallets, '', '', nameOf);
    expect(JSON.stringify(inputs)).toBe(before);
  });
});
