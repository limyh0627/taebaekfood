import { useEffect, useState } from 'react';
import type { CompanyId, IssuedStatement } from '../types';
import type { ReturnStockOperation } from '../returnStockMovement';
export type ReturnAllocationOperation = ReturnStockOperation & {
  applications?: { id: string; statementId: string; amount: number }[];
  amount?: number; sourcePresence?: Readonly<Record<string, boolean>>;
};
export function useReturnAllocationSources(companyId: CompanyId, enabled: boolean,
  operations: ReturnAllocationOperation[] | undefined, statements: IssuedStatement[],
  load: (ids: string[], companyId: CompanyId) => Promise<IssuedStatement[]>, uid: string | undefined,
  currentUid: () => string | undefined, refreshToken = 0): ReturnAllocationOperation[] | undefined {
  const [state, setState] = useState<{ companyId: CompanyId; uid?: string; refreshToken: number; operations: ReturnAllocationOperation[]; statements: IssuedStatement[]; rows: ReturnAllocationOperation[] }>();
  useEffect(() => {
    if (!enabled || operations === undefined) return;
    let cancelled = false;
    const ids = [...new Set(operations.flatMap(row => row.applications?.map(app => app.statementId) ?? []))];
    void load(ids, companyId).then(rows => {
      if (cancelled || currentUid() !== uid) return;
      const present = new Set(rows.filter(row => (row.companyId ?? 'taebaek') === companyId).map(row => row.id));
      const sourcePresence = Object.fromEntries(ids.map(id => [id, present.has(id)]));
      setState({ companyId, uid, refreshToken, operations, statements, rows: operations.map(row => ({ ...row, sourcePresence })) });
    }).catch(() => { /* Unresolved reads remain pending; never infer deletion from a failed query. */ });
    return () => { cancelled = true; };
  }, [companyId, enabled, operations, statements, load, uid, currentUid, refreshToken]);
  return enabled && state?.companyId === companyId && state.uid === uid && state.refreshToken === refreshToken && state.operations === operations && state.statements === statements ? state.rows : undefined;
}
