import { OrderStatus, type Order, type Partner, type PalletStock, type PalletTransaction } from '../../../shared/types';

export function buildPartnerPalletHistory(selectedClientIdForDetail: string | null, palletTransactions: PalletTransaction[], orders: Order[], pallets: PalletStock[], historyDateFilter: string, palletNameOf: (type: string) => string) {
    if (!selectedClientIdForDetail) return [];

    const history: { id: string; type: 'in' | 'out'; quantity: number; date: string; note: string; palletName: string; txId?: string }[] = [];

    // From manual transactions (이동전표는 거래처 이력에서 제외 — 전체 이력에서만 조회)
    palletTransactions
      .filter(t => t.partnerId === selectedClientIdForDetail && !t.isTransfer)
      .forEach(t => {
        const pallet = pallets.find(p => p.id === t.palletId);
        history.push({
          id: t.id,
          type: t.type,
          quantity: t.quantity,
          date: t.date,
          note: t.note || (t.type === 'in' ? '수동 입고' : '수동 출고'),
          palletName: pallet?.name || '기타',
          txId: t.id,
        });
      });

    // From orders
    orders
      .filter(o => o.partnerId === selectedClientIdForDetail && o.pallets && o.pallets.length > 0 && (o.status === OrderStatus.SHIPPED || o.status === OrderStatus.DISPATCHED))
      .forEach(o => {
        o.pallets?.forEach((p, idx) => {
          history.push({
            id: `${o.id}-${idx}`,
            type: 'out',
            quantity: p.quantity,
            date: o.deliveryDate.split('T')[0],
            note: `주문 출고 (${o.id})`,
            palletName: palletNameOf(p.type)
          });
        });
      });

    return history
      .filter(item => !historyDateFilter || item.date.includes(historyDateFilter))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function buildAvailablePalletMonths(palletTransactions: PalletTransaction[], orders: Order[], currentMonth: string, monthFilter: string) {
    const set = new Set<string>();
    set.add(currentMonth); // 거래가 없는 새달도 다시 렌더되면 선택할 수 있어야 한다.
    if (monthFilter) set.add(monthFilter); // 조회 중인 옛 달은 옵션에서 빠져 선택 표시가 바뀌지 않게 한다.
    palletTransactions.forEach(t => { if (t.date) set.add(t.date.slice(0, 7)); });
    orders.forEach(o => {
      if (o.pallets && o.pallets.length > 0 && (o.status === OrderStatus.SHIPPED || o.status === OrderStatus.DELIVERED)) {
        const m = (o.deliveryDate || '').slice(0, 7);
        if (m) set.add(m);
      }
    });
    return Array.from(set).filter(Boolean).sort((a, b) => b.localeCompare(a));
}

export function buildPalletSummary(palletTransactions: PalletTransaction[], orders: Order[], monthFilter: string) {
    let totalOut = 0, totalIn = 0, exchanging = 0;
    const inMonth = (d?: string) => !monthFilter || (d ?? '').startsWith(monthFilter);
    palletTransactions.forEach(t => {
      if (!inMonth(t.date)) return;
      if (t.isTransfer) return; // 이동전표는 실제 입출고가 아니므로 합계에서 제외
      if (t.type === 'out') totalOut += t.quantity;
      else if (t.type === 'in') totalIn += t.quantity;
      if (t.status === '교체중') exchanging += t.quantity;
    });
    orders
      .filter(o => o.pallets && o.pallets.length > 0 && (o.status === OrderStatus.SHIPPED || o.status === OrderStatus.DELIVERED))
      .forEach(o => { if (inMonth(o.deliveryDate)) o.pallets?.filter(p => !p.isExchange).forEach(p => { totalOut += p.quantity || 0; }); });
    return { 입고: totalIn, 지급: totalOut, 교체중: exchanging };
}

export function buildAllPalletHistory(palletTransactions: PalletTransaction[], orders: Order[], partners: Partner[], pallets: PalletStock[], monthFilter: string, historySearch: string, palletNameOf: (type: string) => string) {
    const pName = (id: string) => partners.find(p => p.id === id)?.name || '알 수 없음';
    type Row = { id: string; date: string; partner: string; pallet: string; type: 'in' | 'out'; quantity: number; status?: string; note: string; txId?: string };
    const rows: Row[] = palletTransactions.map(t => ({
      id: t.id, date: t.date, partner: pName(t.partnerId),
      pallet: pallets.find(p => p.id === t.palletId)?.name || '기타',
      type: t.type, quantity: t.quantity,
      status: t.isTransfer ? (t.type === 'in' ? '이동입고' : '이동지급') : t.status,
      note: t.note || '', txId: t.id,
    }));
    orders
      .filter(o => o.pallets && o.pallets.length > 0 && (o.status === OrderStatus.SHIPPED || o.status === OrderStatus.DELIVERED))
      .forEach(o => o.pallets?.filter(p => !p.isExchange).forEach((p, i) => rows.push({
        id: `${o.id}-pl-${i}`, date: (o.deliveryDate || '').split('T')[0], partner: o.partnerName,
        pallet: palletNameOf(p.type), type: 'out', quantity: p.quantity || 0, note: `주문 출고 (${o.id})`,
      })));
    // 같은 날짜 안에서는 등록 시각(수동 거래 id의 timestamp)이 최신인 것부터
    const tsOf = (r: Row) => { const m = /^ptrans-(\d+)/.exec(r.txId ?? ''); return m ? Number(m[1]) : 0; };
    const q = historySearch.trim().toLowerCase();
    return rows
      .filter(r => !monthFilter || (r.date ?? '').startsWith(monthFilter))
      .filter(r => !q || r.partner.toLowerCase().includes(q))
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || tsOf(b) - tsOf(a));
}
