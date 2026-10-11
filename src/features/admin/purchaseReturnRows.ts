import type { IssuedStatement, Item, ReturnRequest } from '../../shared/types';
export interface PurchaseReturnRow { itemId: string; name: string; qty: string; unit: string; sourceLineIndex?: number; unitKg?: number; originalQty?: number; remainingQty?: number }
/** 같은 품목을 다른 중량 포대로 샀어도 원전표 줄을 합치지 않는다. */
export function purchaseReturnRows(source: IssuedStatement | undefined, items: readonly Item[], returns: readonly ReturnRequest[]): PurchaseReturnRow[] {
  return (source?.items ?? []).flatMap((row, sourceLineIndex) => {
    if (!row.itemId) return [];
    const processed = returns.filter(request => request.companyId === source!.companyId && request.linkedStatementId === source!.id && request.returnType === '매입' && request.status === 'processed').flatMap(request => request.items).filter(line => line.itemId === row.itemId && (line.sourceLineIndex === sourceLineIndex || line.sourceLineIndex === undefined && source!.items.filter(candidate => candidate.itemId === row.itemId).length === 1)).reduce((sum, line) => sum + line.quantity, 0);
    return [{ itemId: row.itemId, name: row.name, qty: '', unit: row.purchaseUnit || items.find(item => item.id === row.itemId)?.unit || '', sourceLineIndex, ...(row.unitKg !== undefined ? { unitKg: row.unitKg } : {}), originalQty: row.qty, remainingQty: Math.max(0, Math.round((row.qty - processed) * 1000) / 1000) }];
  });
}
