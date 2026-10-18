import { executeItemEditorSteps, type ItemEditorProgress, type ItemEditorSaveResult, type ItemEditorSaveStep } from '../application/itemEditorSave';
import { baseRawName } from '../../../constants/formula';
import type { PartnerItem } from '../../../shared/types';
interface ItemFormulaIdentity {
  type: string;
  name: string;
  품목?: string;
}
export interface SaveItemEditorRelationsInput {
  formData: ItemFormulaIdentity & {
    inPartnerIds: string[];
  };
  initialData?: ItemFormulaIdentity;
  formulaRows: {
    child_name: string;
    yield_pct: number;
  }[];
  itemId: string;
  /** 편집 화면이 Direction='in'으로 좁힌 연결만 전달한다. */
  partnerIn: PartnerItem[];
  onSaveItemFormula?: (parentKey: string, rows: {
    child_name: string;
    yield_rate: number;
    ratio: number;
  }[], prevKey?: string) => Promise<void>;
  onUpsertPartnerItem?: (ps: PartnerItem) => Promise<void>;
  onDeletePartnerItem?: (id: string) => Promise<void>;
}

/** 품목·사진 저장이 성공한 뒤 실행하던 후속 순서를 유지한다. */
export async function saveItemEditorRelations({
  formData,
  initialData,
  formulaRows,
  itemId,
  partnerIn,
  onSaveItemFormula,
  onUpsertPartnerItem,
  onDeletePartnerItem
}: SaveItemEditorRelationsInput, progress: ItemEditorProgress, isCurrent: () => boolean): Promise<ItemEditorSaveResult> {
  const steps: ItemEditorSaveStep[] = [];
  if (!progress.confirmedStageIds.includes('primary')) return {
    progress,
    outcome: {
      status: 'rejected',
      message: '품목 주 저장의 완료 응답이 없어 후속 연결을 시작하지 않았습니다.',
      nextAction: '품목 저장 결과를 먼저 확인해 주세요.'
    }
  };
  const needsFormula = ['wip', 'raw'].includes(formData.type);
  const previous = partnerIn.filter(pi => pi.itemId === itemId);
  const needsUpsert = formData.inPartnerIds.length > 0;
  const needsDelete = previous.some(pi => pi.partnerId && !formData.inPartnerIds.includes(pi.partnerId));
  if (needsFormula && !onSaveItemFormula || needsUpsert && !onUpsertPartnerItem || needsDelete && (!onUpsertPartnerItem || !onDeletePartnerItem)) return {
    progress,
    outcome: {
      status: 'partial',
      reason: 'followup-unconfirmed',
      committedIds: [itemId],
      unconfirmedIds: [],
      message: '품목은 저장됐지만 필요한 후속 저장 연결이 없어 배합·거래처 단계를 시작하지 않았습니다.',
      nextAction: '저장 연결을 확인한 뒤 아직 시작하지 않은 후속 단계만 이어가세요.'
    }
  };
  // 완제품 배합은 BOM이 정한다. 품목 키의 원료식을 덮어쓰면 다른 완제품까지 바뀐다.
  if (onSaveItemFormula && ['wip', 'raw'].includes(formData.type)) {
    const keyOf = (cat: string, pumok: string, nm: string) => cat === 'product' ? pumok || nm : baseRawName(nm);
    const parentKey = keyOf(formData.type, formData.품목 || '', formData.name);
    const prevKey = initialData ? keyOf(initialData.type, initialData.품목 || '', initialData.name) : undefined;
    const rows = formulaRows.filter(r => r.child_name).map(r => ({
      child_name: r.child_name,
      yield_rate: (r.yield_pct || 0) / 100,
      ratio: 1
    }));
    steps.push({
      id: 'formula',
      label: '배합과 배합 후 원가 반영',
      run: () => onSaveItemFormula(parentKey, rows, prevKey && prevKey !== parentKey ? prevKey : undefined)
    });
  }

  // 선택 순서와 기존 단가·세금을 보존하되 각 연결의 실제 완료 응답을 기다린다.
  if (onUpsertPartnerItem) {
    const prevIn = partnerIn.filter(pi => pi.itemId === itemId);
    for (const partnerId of formData.inPartnerIds) {
      const existing = prevIn.find(pi => pi.partnerId === partnerId);
      const row: PartnerItem = {
        id: existing?.id ?? `${itemId}_${partnerId}_in`,
        partnerId: partnerId,
        itemId: itemId,
        Direction: 'in',
        price: existing?.price,
        taxType: existing?.taxType
      };
      steps.push({
        id: 'partner-upsert:' + row.id,
        label: '매입 거래처 연결 ' + partnerId,
        run: () => onUpsertPartnerItem(row)
      });
    }
    if (onDeletePartnerItem) {
      for (const pi of prevIn) {
        const pid = pi.partnerId;
        if (pid && !formData.inPartnerIds.includes(pid)) steps.push({
          id: 'partner-delete:' + pi.id,
          label: '해제한 매입 거래처 연결 정리',
          run: () => onDeletePartnerItem(pi.id)
        });
      }
    }
  }
  return executeItemEditorSteps(itemId, steps, progress, isCurrent);
}
