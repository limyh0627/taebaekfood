import { companyOf, type CompanyId, type Item, type PurchaseOrder } from '../../shared/types';
import { itemKg } from '../../shared/orderUnits';

/** 조회용 대조. 차이는 실측 손실이 아니며 원료별 소비량을 추정하지 않는다. */
export function reconcileOemBatch(po: PurchaseOrder, items: readonly Item[], companyId: CompanyId) {
  if (po.poType !== 'oem' || companyOf(po) !== companyId) return undefined;

  const issues: string[] = [];
  const sent = (po.oemSent ?? []).reduce<{ material: string; kg: number; rawItemId?: string }[]>((rows, row) => {
    const previous = rows.find(candidate => candidate.material === row.material);
    if (previous) previous.kg += row.kg;
    else rows.push({ material: row.material, kg: row.kg, rawItemId: row.rawItemId });
    return rows;
  }, []);
  if (!sent.length) issues.push('송출 원료 기록 없음');
  if (po.status === 'received' && !po.items?.length && !po.oemReceivedBulk?.length) issues.push('회수 세부 기록 없음');
  const products = (po.status === 'received' ? po.items ?? [] : []).map(row => {
    const item = items.find(candidate => candidate.id === row.itemId && companyOf(candidate) === companyId);
    const unitKg = item ? itemKg(item) : 0;
    const name = row.name || item?.name || row.itemId;
    if (!item || !Number.isFinite(unitKg) || unitKg <= 0) issues.push(`제품 단위 환산 불명: ${name} (${row.itemId})`);
    return { itemId: row.itemId, name, quantity: row.quantity, unit: row.unit, kg: unitKg > 0 ? row.quantity * unitKg : undefined };
  });
  const bulk = po.status === 'received' ? po.oemReceivedBulk ?? [] : [];
  const bulkKnown = po.status === 'received' && (po.oemReceivedBulk !== undefined || !!po.oemReceiptOperationId);
  if (po.status === 'received' && !bulkKnown) issues.push('벌크 회수 자료 없음');
  const materials = sent.map(row => {
    const returnedBulkKg = bulkKnown ? bulk.filter(b => b.material === row.material).reduce((sum, b) => sum + b.kg, 0) : undefined;
    return { ...row, returnedBulkKg, unresolvedKg: returnedBulkKg === undefined ? undefined : row.kg - returnedBulkKg,
      confirmedLossKg: undefined as number | undefined };
  });
  if (bulk.some(row => !sent.some(source => source.material === row.material))) issues.push('송출 원료와 벌크 명칭 불일치');
  const productKg = products.length && products.every(row => row.kg !== undefined)
    ? products.reduce((sum, row) => sum + row.kg!, 0) : undefined;
  if (materials.length !== 1 && products.length) issues.push('다중 원료 제품 귀속 불명');
  if (po.status === 'received' && bulkKnown && po.oemReceivedKg !== undefined && productKg !== undefined) {
    const bulkKg = bulk.reduce((sum, row) => sum + row.kg, 0);
    if (Math.abs(po.oemReceivedKg - productKg - bulkKg) > 0.001) issues.push('저장된 회수 중량과 제품·벌크 단위 불일치');
  }
  return {
    poId: po.id, companyId, status: po.status, materials, products, bulk,
    unallocatedProductKg: productKg,
    /** 단일 원료도 제품 소비 확증이 없으므로 산술 차이만 표시한다. */
    unresolvedBatchKg: po.status === 'received' && materials.length === 1 && productKg !== undefined && materials[0]!.unresolvedKg !== undefined
      ? materials[0]!.unresolvedKg - productKg : undefined,
    feeStatus: po.status !== 'received' ? 'not-received' : po.linkedStatementId ? 'linked' : 'unissued',
    issues,
  };
}
