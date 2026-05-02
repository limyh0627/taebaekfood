/**
 * useAdminData — 관리자 전용 Firebase 구독 훅
 *
 * ─ 목적 ─
 * 일반 직원은 이 훅을 사용하지 않습니다.
 * App.tsx에서 isAdmin 또는 isAdminAuthenticated 가 true일 때만 호출합니다.
 * 이렇게 하면 일반 직원 화면에서는 비용관리·생산실적 데이터가
 * Firebase에서 전혀 내려오지 않아 보안과 속도 모두 개선됩니다.
 *
 * ─ 포함 데이터 ─
 *   fixedCosts       → 비용관리 (CostManager, ProfitAnalysis)
 *   productionRecords → 생산 실적 (ProductionManager, ProfitAnalysis)
 */

import { useState, useEffect } from 'react';
import { FixedCostEntry, ProductionRecord } from '../../types';
import { subscribeToCollection } from '../services/firebaseService';
import { authReady } from '../shared/firebase';

export interface AdminData {
  fixedCosts: FixedCostEntry[];
  productionRecords: ProductionRecord[];
}

/**
 * @param enabled  true일 때만 Firebase 구독을 시작합니다.
 *                 false면 빈 배열을 반환하고 Firebase 요청을 보내지 않습니다.
 */
export function useAdminData(enabled: boolean): AdminData {
  const [fixedCosts, setFixedCosts] = useState<FixedCostEntry[]>([]);
  const [productionRecords, setProductionRecords] = useState<ProductionRecord[]>([]);

  useEffect(() => {
    if (!enabled) return;

    let unsubscribes: (() => void)[] = [];
    let cancelled = false;

    authReady.then(() => {
      if (cancelled) return;
      unsubscribes = [
        subscribeToCollection<FixedCostEntry>('fixedCosts', setFixedCosts),
        subscribeToCollection<ProductionRecord>('productionRecords', setProductionRecords),
      ];
    });

    return () => {
      cancelled = true;
      unsubscribes.forEach(u => u());
    };
  }, [enabled]);

  return { fixedCosts, productionRecords };
}
