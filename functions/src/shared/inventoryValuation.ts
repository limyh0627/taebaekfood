export interface InventoryValuationItem {
  id: string;
  companyId?: string;
  type?: string;
  stock?: number | null;
  cost?: number | null;
}

export interface InventoryValuationLine {
  id: string;
  stock: number;
  cost: number;
  value: number;
}

export interface CompanyInventoryValuation {
  basis: string;
  companyId: string;
  rawValue: number;
  value: number;
  lines: InventoryValuationLine[];
}

/** 월말 장부 범위: 저장 원가가 있는 모든 품목(용역 포함), 음수 재고 포함. */
export function valueInventory(items: readonly InventoryValuationItem[], basis: string): CompanyInventoryValuation[] {
  const companies = new Map<string, CompanyInventoryValuation>();
  const getCompany = (companyId: string) => {
    let result = companies.get(companyId);
    if (!result) {
      result = { basis, companyId, rawValue: 0, value: 0, lines: [] };
      companies.set(companyId, result);
    }
    return result;
  };
  // 태백은 재고 0원이어도 기존 월말 문서를 만든다.
  getCompany('taebaek');

  for (const item of items) {
    const companyId = item.companyId ?? 'taebaek';
    const stock = Number(item.stock ?? 0);
    const cost = Number(item.cost ?? 0);
    if (!companyId || !Number.isFinite(stock) || !Number.isFinite(cost)) {
      throw new Error(`재고평가 입력 오류: ${item.id}`);
    }
    if (stock === 0 || cost === 0) continue;
    const value = stock * cost;
    if (!Number.isFinite(value)) throw new Error(`재고평가 금액 오류: ${item.id}`);
    const company = getCompany(companyId);
    company.rawValue += value;
    if (!Number.isFinite(company.rawValue)) throw new Error(`재고평가 회사 합계 오류: ${companyId}`);
    company.lines.push({ id: item.id, stock, cost, value });
  }
  for (const company of companies.values()) company.value = Math.round(company.rawValue);
  return [...companies.values()];
}

/** 회사별 화면에서는 다른 회사의 오류 입력이 현재 회사 기록을 막지 않도록 한다. */
export function valueInventoryForCompany(items: readonly InventoryValuationItem[], basis: string, companyId: string): CompanyInventoryValuation | undefined {
  return valueInventory(items.filter(item => (item.companyId ?? 'taebaek') === companyId), basis)
    .find(result => result.companyId === companyId);
}
