import { baseRawName } from '../../../constants/formula';
import type { PartnerItem } from '../../../shared/types';

interface ItemFormulaIdentity {
  type: string;
  name: string;
  품목?: string;
}

export interface SaveItemEditorRelationsInput {
  formData: ItemFormulaIdentity & { inPartnerIds: string[] };
  initialData?: ItemFormulaIdentity;
  formulaRows: { child_name: string; yield_pct: number }[];
  itemId: string;
  /** 편집 화면이 Direction='in'으로 좁힌 연결만 전달한다. */
  partnerIn: PartnerItem[];
  onSaveItemFormula?: (parentKey: string, rows: { child_name: string; yield_rate: number; ratio: number }[], prevKey?: string) => Promise<void>;
  onUpsertPartnerItem?: (ps: PartnerItem) => void;
  onDeletePartnerItem?: (id: string) => void;
}

/** 품목·사진 저장이 성공한 뒤 실행하던 후속 순서를 유지한다. */
export async function saveItemEditorRelations({ formData, initialData, formulaRows, itemId, partnerIn, onSaveItemFormula, onUpsertPartnerItem, onDeletePartnerItem }: SaveItemEditorRelationsInput): Promise<void> {
  // 완제품 배합은 BOM이 정한다. 품목 키의 원료식을 덮어쓰면 다른 완제품까지 바뀐다.
  if (onSaveItemFormula && ['wip', 'raw'].includes(formData.type)) {
    const keyOf = (cat: string, pumok: string, nm: string) => cat === 'product' ? (pumok || nm) : baseRawName(nm);
    const parentKey = keyOf(formData.type, formData.품목 || '', formData.name);
    const prevKey = initialData ? keyOf(initialData.type, initialData.품목 || '', initialData.name) : undefined;
    const rows = formulaRows
      .filter(r => r.child_name)
      .map(r => ({ child_name: r.child_name, yield_rate: (r.yield_pct || 0) / 100, ratio: 1 }));
    await onSaveItemFormula(parentKey, rows, prevKey && prevKey !== parentKey ? prevKey : undefined);
  }

  // 기존 void 콜백의 호출 순서와 단가·세금 보존을 그대로 유지한다.
  if (onUpsertPartnerItem) {
    const prevIn = partnerIn.filter(pi => pi.itemId === itemId);
    for (const partnerId of formData.inPartnerIds) {
      const existing = prevIn.find(pi => (pi.partnerId) === partnerId);
      onUpsertPartnerItem({ id: existing?.id ?? `${itemId}_${partnerId}_in`, partnerId: partnerId, itemId: itemId, Direction: 'in', price: existing?.price, taxType: existing?.taxType });
    }
    if (onDeletePartnerItem) {
      for (const pi of prevIn) {
        const pid = pi.partnerId;
        if (pid && !formData.inPartnerIds.includes(pid)) onDeletePartnerItem(pi.id);
      }
    }
  }
}
