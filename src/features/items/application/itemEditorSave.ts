import { ITEM_EDITOR_STAGES, itemEditorStageLabel, type ItemEditorReference, type ItemEditorResult } from '../../../shared/itemEditorCommand';
import type { SaveOutcome } from '../../../shared/saveOutcome';
export interface ItemEditorProgress {
  itemId: string;
  confirmedStageIds: string[];
  unknownStageId?: string;
  unknownMessage?: string;
  durableVersion?: 1;
  reference?: ItemEditorReference;
  terminalStatus?: ItemEditorResult['status'];
}
export interface ItemEditorSaveResult {
  outcome: SaveOutcome;
  progress: ItemEditorProgress;
  serverStatus?: ItemEditorResult['status'];
}
export const createItemEditorProgress = (itemId: string): ItemEditorProgress => ({
  itemId,
  confirmedStageIds: []
});
export function itemEditorUnknown(progress: ItemEditorProgress, message = '품목 저장 결과를 확인하지 못했습니다.'): ItemEditorSaveResult {
  progress.unknownStageId = ITEM_EDITOR_STAGES[progress.confirmedStageIds.length] ?? 'server-result';
  progress.unknownMessage = message;
  return {
    progress,
    outcome: progress.confirmedStageIds.includes('primary') ? {
      status: 'partial',
      reason: 'followup-unconfirmed',
      committedIds: [progress.itemId],
      unconfirmedIds: [],
      message,
      nextAction: '같은 요청의 결과 확인 또는 요청 중단을 선택해 주세요. 확인된 단계는 다시 보내지 않습니다.'
    } : {
      status: 'unknown',
      message,
      nextAction: '최초 작성 내용과 사진을 유지했습니다. 같은 요청의 결과 확인 또는 요청 중단을 선택해 주세요.'
    }
  };
}
/** 현재값을 ACK로 삼지 않고 검증된 서버 영수증의 순서 있는 단계만 표시한다. */
export function applyItemEditorResult(result: ItemEditorResult, progress: ItemEditorProgress): ItemEditorSaveResult {
  if (progress.itemId !== result.targetId || progress.reference && (progress.reference.companyId !== result.companyId || progress.reference.planId !== result.planId || progress.reference.targetId !== result.targetId)) return itemEditorUnknown(progress, '품목 저장 결과의 대상 계획이 다릅니다.');
  if (result.status === 'unknown') return itemEditorUnknown(progress, result.message);
  if (result.confirmedStageIds.length < progress.confirmedStageIds.length || progress.confirmedStageIds.some((stage, i) => stage !== result.confirmedStageIds[i])) return itemEditorUnknown(progress, '이미 확인한 저장 단계와 서버 응답이 다릅니다.');
  progress.confirmedStageIds = [...result.confirmedStageIds];
  progress.durableVersion = 1;
  progress.reference = {
    companyId: result.companyId,
    planId: result.planId,
    targetId: result.targetId
  };
  progress.terminalStatus = result.status;
  delete progress.unknownStageId;
  delete progress.unknownMessage;
  const completed = progress.confirmedStageIds.map(stage => itemEditorStageLabel(stage as typeof ITEM_EDITOR_STAGES[number])).join(', ');
  if (result.status === 'completed') return {
    progress,
    outcome: {
      status: 'saved'
    }
  };
  if (result.status === 'cancelled') return {
    progress,
    outcome: {
      status: 'cancelled',
      message: result.message + (completed ? '\n완료된 단계는 유지했습니다: ' + completed : ''),
      nextAction: '필요한 경우 현재 자료를 새로 열어 새 요청을 작성해 주세요.'
    }
  };
  if (result.status === 'rejected' && !progress.confirmedStageIds.length) return {
    progress,
    outcome: {
      status: 'rejected',
      message: result.message,
      nextAction: '현재 품목을 다시 열어 내용을 확인한 뒤 새 요청을 작성해 주세요.'
    }
  };
  return {
    progress,
    outcome: {
      status: 'partial',
      reason: 'followup-unconfirmed',
      committedIds: [result.targetId],
      unconfirmedIds: [],
      message: result.message || '품목 저장의 일부 단계가 완료됐습니다.',
      nextAction: result.status === 'active' ? '미완료 단계 이어하기를 명시적으로 선택해 주세요.' : '완료된 단계는 유지했습니다. 현재 품목을 다시 열어 남은 내용을 확인해 주세요.'
    }
  };
}
