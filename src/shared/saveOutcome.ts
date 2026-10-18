/** 저장 결과는 업무 응답을 받은 호출자가 명시한다. 오류만 보고 저장 여부를 추측하지 않는다. */
export type SaveOutcome =
  | { status: 'saved' }
  | { status: 'cancelled'; message: string; nextAction?: string }
  | { status: 'rejected'; message: string; nextAction?: string }
  | { status: 'unknown'; message: string; nextAction: string }
  | {
      status: 'partial';
      reason: 'followup-unconfirmed' | 'batch-incomplete';
      message: string;
      nextAction: string;
      /** 확인된 원 업무 ID만 둔다. 감사·알림 등 후속 기록의 ID를 섞지 않는다. */
      committedIds: string[];
      /** 저장 결과를 확인하지 못한 원 업무 ID이며, 미저장 확정 목록이 아니다. */
      unconfirmedIds: string[];
    };

/** 부분 완료에서 다른 업무의 성공이나 모순된 ID 목록을 확정 ACK로 해석하지 않는다. */
export function primaryCommitted(outcome: SaveOutcome, id: string): boolean {
  return outcome.status === 'saved'
    || outcome.status === 'partial' && outcome.committedIds.includes(id) && !outcome.unconfirmedIds.includes(id);
}

/** 화면마다 원인과 다음 행동 중 하나를 빠뜨리지 않도록 같은 순서로 연결한다. */
export function saveOutcomeMessage(outcome: SaveOutcome): string {
  if (outcome.status === 'saved') return '';
  return [outcome.message, outcome.nextAction].filter(Boolean).join('\n');
}
