import { useEffect, useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { companyOf, type CompanyId, type ProductionSalesLog } from '../../shared/types';
import { today } from '../../shared/day';
import { fetchDateRange } from '../../shared/services/firebaseService';

/** 과거 24개월 이력과 현재 구독을 회사별로 합친다. 같은 ID는 최신 구독을 우선한다. */
export function useProductionSalesHistory(companyId: CompanyId, liveLogs: ProductionSalesLog[]): ProductionSalesLog[] {
  const [history, setHistory] = useState<{ companyId: CompanyId; rows: ProductionSalesLog[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    const fromDate = new Date(); fromDate.setMonth(fromDate.getMonth() - 24);
    void fetchDateRange<ProductionSalesLog>('productionSalesLogs', 'date', fromDate.toISOString().slice(0, 10), today(),
      [where('companyId', '==', companyId)])
      .then(rows => { if (!cancelled) setHistory({ companyId, rows }); })
      .catch(error => { if (!cancelled) console.error('[AdminApp] 과거 생산판매기록 로드 실패:', error); });
    return () => { cancelled = true; };
  }, [companyId]);
  return useMemo(() => {
    const map = new Map<string, ProductionSalesLog>();
    for (const row of history?.companyId === companyId ? history.rows : []) if (companyOf(row) === companyId) map.set(row.id, row);
    for (const row of liveLogs) if (companyOf(row) === companyId) map.set(row.id, row);
    return Array.from(map.values());
  }, [companyId, history, liveLogs]);
}
