import type { CompanyId, IssuedStatement, Item, ReturnItem } from '../../shared/types';
import { returnStockKind } from '../../../functions/src/shared/returnStockKind';

export function purchaseReturnAvailable(companyId: CompanyId, release: any, returns: any, payment: any): boolean {
  return release?.status === 'active' && typeof release.releaseId === 'string' && !!release.releaseId
    && returns?.purchaseGeneralStockEnabled === true
    && [returns, payment].every(gate => gate?.companyId === companyId && gate.enabled === true
      && gate.auditPassed === true && gate.legacyWritersBlocked === true);
}

/** 화면 금액도 원전표 공급가/세액 비례로 계산한다. 최종 수량/잔액은 서버가 다시 검증한다. */
export function purchaseReturnRequest(companyId: CompanyId, partnerId: string, source: IssuedStatement | undefined,
  selected: { itemId: string; qty: string }[], allItems: Item[]) {
  const money = (value: number) => Number.isSafeInteger(value) && value >= 0;
  if (!source || source.companyId !== companyId || source.type !== '매입' || source.partnerId !== partnerId
    || !source.items.length || new Set(source.items.map(row => row.itemId)).size !== source.items.length
    || source.items.some(row => !row.itemId || !row.accountCode || !Number.isFinite(row.qty) || row.qty <= 0
      || !money(row.supply) || !money(row.tax) || row.total !== row.supply + row.tax)
    || source.items.reduce((sum, row) => sum + row.supply, 0) !== source.totalSupply
    || source.items.reduce((sum, row) => sum + row.tax, 0) !== source.totalTax
    || source.totalAmount !== source.totalSupply + source.totalTax) throw new Error('유효한 원매입 전표를 선택해주세요.');
  const quantities = selected.filter(row => row.qty !== '' && Number(row.qty) !== 0);
  if (!quantities.length || new Set(quantities.map(row => row.itemId)).size !== quantities.length)
    throw new Error('반품 수량을 입력해주세요.');
  let totalAmount = 0;
  const items: ReturnItem[] = quantities.map(row => {
    const original = source.items.find(line => line.itemId === row.itemId);
    const item = allItems.find(item => item.id === row.itemId);
    const quantity = Number(row.qty);
    if (!original || !item || returnStockKind(companyId, item, allItems) === 'unsupported' || !item.unit?.trim()
      || !Number.isFinite(quantity) || quantity <= 0 || quantity > original.qty
      || !Number.isSafeInteger(Math.round(quantity * 1000)) || Math.round(quantity * 1000) <= 0
      || Math.abs(Math.round(quantity * 1000) / 1000 - quantity) > 1e-9)
      throw new Error('품목의 반품 처리 경로와 원매입 수량·단위를 확인해주세요.');
    const supply = original.supply * quantity / original.qty, tax = original.tax * quantity / original.qty;
    if (!money(supply) || !money(tax) || supply + tax <= 0) throw new Error('공급가·세액을 정확히 나눌 수 없는 반품 수량입니다.');
    totalAmount += supply + tax;
    return { itemId: row.itemId, name: item.name, quantity, price: original.total / original.qty, reason: '기타', isResellable: false };
  });
  if (!money(totalAmount) || !totalAmount) throw new Error('반품 금액을 확인해주세요.');
  return { companyId, partnerId, linkedStatementId: source.id, returnType: '매입' as const,
    status: 'pending' as const, totalAmount, items };
}

/** 받은 반품은 원매출 전표의 금액·품목을 근거로만 접수한다. */
export function salesReturnRequest(companyId: CompanyId, partnerId: string, source: IssuedStatement | undefined,
  selected: { itemId: string; qty: string; isResellable?: boolean }[], allItems: Item[]) {
  const money = (value: number) => Number.isSafeInteger(value) && value >= 0;
  if (!source || source.companyId !== companyId || source.type !== '매출' || source.partnerId !== partnerId
    || !source.items.length || new Set(source.items.map(row => row.itemId)).size !== source.items.length
    || source.items.some(row => !row.itemId || !row.accountCode || !Number.isFinite(row.qty) || row.qty <= 0
      || !money(row.supply) || !money(row.tax) || row.total !== row.supply + row.tax)
    || source.items.reduce((sum, row) => sum + row.supply, 0) !== source.totalSupply
    || source.items.reduce((sum, row) => sum + row.tax, 0) !== source.totalTax
    || source.totalAmount !== source.totalSupply + source.totalTax) throw new Error('유효한 원매출 전표를 선택해주세요.');
  const quantities = selected.filter(row => row.qty !== '' && Number(row.qty) !== 0);
  if (!quantities.length || new Set(quantities.map(row => row.itemId)).size !== quantities.length)
    throw new Error('반품 수량을 입력해주세요.');
  let totalAmount = 0;
  const items: ReturnItem[] = quantities.map(row => {
    const original = source.items.find(line => line.itemId === row.itemId);
    const item = allItems.find(candidate => candidate.id === row.itemId);
    const quantity = Number(row.qty);
    const isResellable = row.isResellable ?? true;
    if (!original || !item || (item.companyId ?? 'taebaek') !== companyId || typeof isResellable !== 'boolean'
      || !Number.isFinite(quantity) || quantity <= 0 || quantity > original.qty
      || !Number.isSafeInteger(Math.round(quantity * 1000))
      || Math.abs(Math.round(quantity * 1000) / 1000 - quantity) > 1e-9)
      throw new Error('원전표 수량·품목·회사를 확인해주세요.');
    if (isResellable && (returnStockKind(companyId, item, allItems) === 'unsupported' || !item.unit?.trim()))
      throw new Error('품목의 반품 재입고 경로와 단위를 확인해주세요.');
    const supply = original.supply * quantity / original.qty;
    const tax = original.tax * quantity / original.qty;
    if (!money(supply) || !money(tax) || supply + tax <= 0) throw new Error('공급가·세액을 정확히 나눌 수 없는 반품 수량입니다.');
    totalAmount += supply + tax;
    return { itemId: item.id, name: item.name, quantity, price: original.total / original.qty,
      reason: '기타' as const, isResellable };
  });
  if (!money(totalAmount) || totalAmount <= 0) throw new Error('반품 금액을 확인해주세요.');
  return { companyId, partnerId, linkedStatementId: source.id, returnType: '매출' as const,
    status: 'pending' as const, totalAmount, items };
}
