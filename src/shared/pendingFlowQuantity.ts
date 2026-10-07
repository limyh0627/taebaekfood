import { companyOf, poLines, type CompanyId, type PurchaseOrder, type ReturnRequest } from './types';

export const flowItemsChanged = (opened: string[], current: string[]) =>
  opened.length !== current.length || opened.some((id, index) => id !== current[index]);

/** 대기 기록의 수량만 바꾼다. 연결 전표는 별도 수정 대상이다. */
export function pendingFlowQuantityPatch(
  type: '입고' | '반품', record: PurchaseOrder | ReturnRequest, updates: { itemId: string; previousQuantity: number; quantity: number }[], companyId: CompanyId,
) {
  if (!updates.length || updates.some(({ quantity: qty }) => !Number.isFinite(qty) || qty <= 0 || Math.abs(Math.round(qty * 1000) - qty * 1000) > 1e-6)) {
    throw new Error('수량은 0보다 큰 숫자로 소수 셋째 자리까지 입력해야 합니다.');
  }
  if (companyOf(record as { companyId?: CompanyId }) !== companyId) throw new Error('다른 회사의 기록은 수정할 수 없습니다.');
  if (type === '입고') {
    const po = record as PurchaseOrder;
    if (po.status !== 'invoiced') throw new Error('입고 대기 상태에서만 수량을 수정할 수 있습니다.');
    const lines = poLines(po);
    if (lines.length !== updates.length || lines.some((line, index) => line.itemId !== updates[index].itemId || line.quantity !== updates[index].previousQuantity)) throw new Error('품목이나 수량이 바뀌었습니다. 상세창을 다시 열어주세요.');
    return po.items?.length
      ? { items: po.items.map((line, index) => ({ ...line, quantity: updates[index].quantity })) }
      : { quantity: updates[0].quantity };
  }
  const request = record as ReturnRequest;
  if (request.status !== 'pending') throw new Error('반품 대기 상태에서만 수량을 수정할 수 있습니다.');
  if (request.items.length !== updates.length || request.items.some((line, index) => line.itemId !== updates[index].itemId || line.quantity !== updates[index].previousQuantity)) throw new Error('품목이나 수량이 바뀌었습니다. 상세창을 다시 열어주세요.');
  const items = request.items.map((line, index) => ({ ...line, quantity: updates[index].quantity }));
  return { items, totalAmount: items.reduce((sum, line) => sum + line.quantity * line.price, 0) };
}
