import type { CompanyId } from './types';

export type ReturnStockMovement = {
  itemId: string; companyId: CompanyId; partnerId: string; operationId: string;
  quantityDelta: number; date: string; createdAt: string;
};
export type ReturnStockOperation = {
  id: string; companyId: CompanyId; partnerId?: string; sourceStatementId: string;
  returnRequestId: string; journalId: string; createdAt: string;
  stockMovements?: ReturnStockMovement[];
};

/** 서버 소유 operation에 기록된 일반재고 출고만 원장에 반영한다. */
export function validReturnStockMovements(operation: ReturnStockOperation): ReturnStockMovement[] | null {
  const rows = operation.stockMovements;
  if (rows === undefined) return [];
  if (!Array.isArray(rows) || new Set(rows.map(row => row?.itemId)).size !== rows.length) return null;
  if (rows.some(row => !row || !row.itemId || !row.partnerId || row.companyId !== operation.companyId
    || row.operationId !== operation.id || !Number.isFinite(row.quantityDelta) || row.quantityDelta >= 0
    || !Number.isSafeInteger(Math.round(row.quantityDelta * 1000))
    || Math.abs(Math.round(row.quantityDelta * 1000) / 1000 - row.quantityDelta) > 1e-9
    || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Date.parse(row.createdAt)))) return null;
  return rows;
}
