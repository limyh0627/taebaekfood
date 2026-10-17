import { OrderStatus, type Order, type Partner, type PalletTransaction, type PalletStock } from '../../../shared/types';

export function buildPartnerPalletStats(orders: Order[], partners: Partner[], palletTransactions: PalletTransaction[], pallets: PalletStock[], palletNameOf: (type?: string) => string) {
    const stats: Record<string, { name: string; pallets: Record<string, number> }> = {};
    
    // Initialize with all partners
    partners.forEach(partner => {
      stats[partner.id] = { name: partner.name, pallets: {} };
    });

    // Add from orders
    orders
      .filter(o => o.pallets && o.pallets.length > 0 && (o.status === OrderStatus.SHIPPED || o.status === OrderStatus.DELIVERED))
      .forEach(order => {
        const partnerId = order.partnerId || 'unknown';
        if (!stats[partnerId]) stats[partnerId] = { name: order.partnerName, pallets: {} };
        
        order.pallets?.filter(p => !p.isExchange).forEach(p => {
          const pType = palletNameOf(p.type);
          const qty = p.quantity || 0;
          if (!stats[partnerId].pallets[pType]) stats[partnerId].pallets[pType] = 0;
          stats[partnerId].pallets[pType] -= qty; // Outbound -> balance down (-)
        });
      });

    // Add/Subtract from manual transactions
    palletTransactions.forEach(trans => {
      // 이동전표는 거래처 잔량과 무관 — 회사 보유 총량만 증감(전체 이력에서만 확인)
      if (trans.isTransfer) return;
      const partnerId = trans.partnerId;
      if (!stats[partnerId]) {
        const partner = partners.find(c => c.id === partnerId);
        stats[partnerId] = { name: partner?.name || '알 수 없는 거래처', pallets: {} };
      }
      
      const pallet = pallets.find(p => p.id === trans.palletId);
      const pType = pallet?.name || '기타';
      
      if (!stats[partnerId].pallets[pType]) stats[partnerId].pallets[pType] = 0;
      
      if (trans.type === 'in') {
        stats[partnerId].pallets[pType] += trans.quantity; // Inbound -> balance up (+)
      } else {
        stats[partnerId].pallets[pType] -= trans.quantity; // Outbound -> balance down (-)
      }
    });
      
    return Object.entries(stats)
      .map(([id, data]) => {
        const total = Object.values(data.pallets).reduce((a, b) => a + b, 0);
        return {
          id,
          name: data.name,
          pallets: data.pallets,
          total
        };
      });
}

export function filterPartnerPalletStatus(partnerPalletStatsRaw: ReturnType<typeof buildPartnerPalletStats>, searchTerm: string) {
    return partnerPalletStatsRaw
      .filter(item => {
        if (!item.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
        // 검색어 없을 때는 잔량 있는 거래처만 표시
        if (!searchTerm.trim()) {
          return Object.values(item.pallets).some(v => v !== 0);
        }
        return true;
      })
      .sort((a, b) => {
        // Non-zero totals first
        if (a.total !== 0 && b.total === 0) return -1;
        if (a.total === 0 && b.total !== 0) return 1;
        // Then by total magnitude (most negative/positive first)
        return Math.abs(b.total) - Math.abs(a.total);
      });
}

export function buildOutstandingByPallet(partnerPalletStatsRaw: ReturnType<typeof buildPartnerPalletStats>) {
    const m = new Map<string, number>();
    partnerPalletStatsRaw.forEach(s => {
      Object.entries(s.pallets).forEach(([pName, q]) => {
        if (q < 0) m.set(pName, (m.get(pName) ?? 0) - q);
      });
    });
    return m;
}
