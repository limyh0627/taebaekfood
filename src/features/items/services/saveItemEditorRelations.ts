import type { ItemEditorDraft } from '../../../shared/itemEditorCommand';
export interface ItemEditorRelationDraftInput {
  formulaRows: readonly {
    child_name: string;
    yield_pct: number;
  }[];
  inPartnerIds: readonly string[];
  includeFormula: boolean;
}
/** UI 원문만 담는다. 배합·연결 쓰기와 수율·단가 계산은 서버의 단일 정본이 담당한다. */
export function prepareItemEditorRelations(input: ItemEditorRelationDraftInput): Pick<ItemEditorDraft, 'formulaRows' | 'inPartnerIds'> {
  return {
    inPartnerIds: [...input.inPartnerIds],
    ...(input.includeFormula ? {
      formulaRows: input.formulaRows.map(row => ({
        child_name: row.child_name,
        yield_pct: row.yield_pct
      }))
    } : {})
  };
}
import { itemEditorPurchaseNoticeText, itemEditorPurchaseNoticeMessage, buildPurchaseNotices } from '../../../shared/itemEditorCommand';
import type { ItemEditorOpening } from '../infrastructure/itemEditorWrites';
/** 안내를 실제로 확인한 동일 원문만 해시로 연결하며 품목·단가 계산은 공용 정본을 재사용한다. */
export async function confirmItemEditorPurchaseNotices(opening: ItemEditorOpening, draft: ItemEditorDraft, notice: (message: string) => Promise<void>, isCurrent: () => boolean): Promise<string | undefined> {
  if (!isCurrent()) throw Error('회사·계정 또는 작성창이 바뀌었습니다.');
  const text = itemEditorPurchaseNoticeText(opening.companyId, opening.targetId, opening.documents, draft);
  if (text === null) return undefined;
  const pending = notice(itemEditorPurchaseNoticeMessage(buildPurchaseNotices(opening.documents, draft, opening.targetId)));
  if (!pending || typeof pending.then !== 'function') throw Error('안내 확인 기능이 완료 응답을 반환하지 않았습니다.');
  await pending;
  if (!isCurrent()) throw Error('안내를 확인하는 중 회사·계정 또는 작성창이 바뀌었습니다.');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  if (!isCurrent()) throw Error('회사·계정 또는 작성창이 바뀌었습니다.');
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
}
