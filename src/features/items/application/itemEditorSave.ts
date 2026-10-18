import type { SaveOutcome } from '../../../shared/saveOutcome';
/** 이 진행표는 현재 작성 세션의 ACK 기록이며 서버 영수증이나 취소 봉쇄가 아니다. */
export interface ItemEditorProgress {
  itemId: string;
  confirmedStageIds: string[];
  unknownStageId?: string;
  unknownMessage?: string;
}
export interface ItemEditorSaveResult {
  outcome: SaveOutcome;
  progress: ItemEditorProgress;
}
export interface ItemEditorSaveStep {
  id: string;
  label: string;
  run: () => Promise<void>;
}
export const createItemEditorProgress = (itemId: string): ItemEditorProgress => ({
  itemId,
  confirmedStageIds: []
});
function interrupted(progress: ItemEditorProgress, message: string, nextAction: string): SaveOutcome {
  return progress.confirmedStageIds.includes('primary') ? {
    status: 'partial',
    reason: 'followup-unconfirmed',
    committedIds: [progress.itemId],
    unconfirmedIds: [],
    message,
    nextAction
  } : {
    status: 'unknown',
    message,
    nextAction
  };
}
/** 이전 ACK 단계는 건너뛰되 응답 유실 단계는 현재값이나 오류 종류로 재실행 가능하다고 추정하지 않는다. */
export async function executeItemEditorSteps(itemId: string, steps: readonly ItemEditorSaveStep[], progress: ItemEditorProgress, isCurrent: () => boolean, preflight?: () => null): Promise<ItemEditorSaveResult> {
  const result = (outcome: SaveOutcome): ItemEditorSaveResult => ({
    outcome,
    progress
  });
  if (progress.itemId !== itemId || new Set(steps.map(step => step.id)).size !== steps.length || steps.some(step => !step.id || !step.label)) return result({
    status: 'rejected',
    message: '품목 또는 저장 단계의 최초 작성 정보가 다릅니다.',
    nextAction: '현재 작성 내용을 유지하고 저장 연결을 확인해 주세요.'
  });
  if (progress.unknownStageId) return result(interrupted(progress, progress.unknownMessage || '이전 저장 단계의 결과를 확인하지 못했습니다.', '같은 요청을 다시 보내지 마세요. 확인된 단계와 미확정 단계를 관리자에게 확인해 주세요.'));
  if (!progress.confirmedStageIds.includes('primary') && steps[0]?.id !== 'primary') return result({
    status: 'rejected',
    message: '품목 주 저장보다 후속 단계를 먼저 실행할 수 없습니다.',
    nextAction: '아직 전송하지 않았습니다. 저장 단계 연결을 확인해 주세요.'
  });
  if (preflight) {
    try {
      if (preflight() !== null) throw Error('저장 전 검증 결과를 확인하지 못했습니다.');
    } catch (error) {
      const message = error instanceof Error ? error.message : '입력과 저장 단계를 확인해 주세요.';
      return result(progress.confirmedStageIds.includes('primary') ? {
        status: 'partial',
        reason: 'followup-unconfirmed',
        committedIds: [itemId],
        unconfirmedIds: [],
        message: '품목은 저장됐지만 후속 단계를 시작하지 않았습니다. ' + message,
        nextAction: '입력과 저장 연결을 확인한 뒤 아직 시작하지 않은 단계만 이어가세요.'
      } : {
        status: 'rejected',
        message,
        nextAction: '아직 저장을 시작하지 않았습니다. 입력을 확인하고 다시 처리해 주세요.'
      });
    }
  }
  for (const step of steps) {
    if (progress.confirmedStageIds.includes(step.id)) continue;
    let current = false;
    try {
      current = isCurrent();
    } catch {}
    if (!current) return result(progress.confirmedStageIds.includes('primary') ? interrupted(progress, '품목 저장은 완료됐지만 회사·계정 또는 작성창이 바뀌어 다음 단계를 시작하지 않았습니다.', '원래 계정과 작성창에서 아직 시작하지 않은 후속 단계만 명시적으로 이어갈 수 있습니다.') : {
      status: 'cancelled',
      message: '회사·계정 또는 작성창이 바뀌어 저장을 시작하지 않았습니다.'
    });
    try {
      const pending = step.run();
      if (!pending || typeof pending.then !== 'function') throw Error('저장 연결이 실제 완료 응답을 반환하지 않았습니다.');
      await pending;
      progress.confirmedStageIds.push(step.id);
    } catch (error) {
      progress.unknownStageId = step.id;
      progress.unknownMessage = `${step.label} 결과를 확인하지 못했습니다.${error instanceof Error && error.message ? ' ' + error.message : ''}`;
      return result(interrupted(progress, progress.unknownMessage, '이미 확인된 단계는 다시 저장하지 않습니다. 미확정 단계는 관리자에게 확인한 뒤 처리해 주세요.'));
    }
  }
  return result({
    status: 'saved'
  });
}
