import { describe, expect, it } from 'vitest';
import { primaryCommitted, saveOutcomeMessage, type SaveOutcome } from './saveOutcome';

describe('원 업무 저장 결과', () => {
  it('saved만 조건 없이 원 업무 완료이며 취소·거절·미확정은 완료가 아니다', () => {
    expect(primaryCommitted({ status: 'saved' }, 'order-1')).toBe(true);
    const outcomes: SaveOutcome[] = [
      { status: 'cancelled', message: '사용자가 취소했습니다.' },
      { status: 'rejected', message: '완료된 품목입니다.', nextAction: '작업을 되돌린 뒤 수정해 주세요.' },
      { status: 'unknown', message: '저장 결과를 확인하지 못했습니다.', nextAction: '현재 주문을 확인해 주세요.' },
    ];
    for (const outcome of outcomes) expect(primaryCommitted(outcome, 'order-1')).toBe(false);
  });

  it.each(['followup-unconfirmed', 'batch-incomplete'] as const)('%s의 완료 여부는 정확한 원 업무 ID별로 판정한다', reason => {
    const outcome: SaveOutcome = { status: 'partial', reason, message: '일부 처리를 확인했습니다.', nextAction: '남은 업무를 확인해 주세요.', committedIds: ['order-1'], unconfirmedIds: ['order-2'] };
    const before = structuredClone(outcome);
    expect(primaryCommitted(outcome, 'order-1')).toBe(true);
    expect(primaryCommitted(outcome, 'order-2')).toBe(false);
    expect(primaryCommitted(outcome, 'order')).toBe(false);
    expect(primaryCommitted(outcome, 'other')).toBe(false);
    expect(outcome).toEqual(before);
  });

  it('같은 ID가 완료·미확정 양쪽에 있으면 확정 완료로 취급하지 않는다', () => {
    const outcome: SaveOutcome = { status: 'partial', reason: 'batch-incomplete', message: '결과 확인 필요', nextAction: '원 업무를 확인해 주세요.', committedIds: ['order-1'], unconfirmedIds: ['order-1'] };
    expect(primaryCommitted(outcome, 'order-1')).toBe(false);
    expect(outcome.status).toBe('partial');
  });

  it('주문 ACK 뒤 감사 응답 미확정은 원 주문 완료를 유지하고 감사 미저장으로 추측하지 않는다', () => {
    const outcome: SaveOutcome = { status: 'partial', reason: 'followup-unconfirmed', message: '주문은 저장했지만 수정 이력을 확인하지 못했습니다.', nextAction: '주문을 다시 저장하지 말고 이력을 확인해 주세요.', committedIds: ['order-1'], unconfirmedIds: [] };
    expect(primaryCommitted(outcome, 'order-1')).toBe(true);
    expect(primaryCommitted(outcome, 'audit-1')).toBe(false);
    expect(outcome.unconfirmedIds).toEqual([]);
  });
});

describe('저장 결과 안내', () => {
  it('saved에는 실패 안내를 만들지 않고 원인과 다음 행동은 원문 순서로 전달한다', () => {
    expect(saveOutcomeMessage({ status: 'saved' })).toBe('');
    expect(saveOutcomeMessage({ status: 'rejected', message: '수정할 수 없는 품목입니다.', nextAction: '해당 품목의 작업을 먼저 되돌려 주세요.' })).toBe('수정할 수 없는 품목입니다.\n해당 품목의 작업을 먼저 되돌려 주세요.');
    expect(saveOutcomeMessage({ status: 'cancelled', message: '저장을 취소했습니다.' })).toBe('저장을 취소했습니다.');
    expect(saveOutcomeMessage({ status: 'unknown', message: '저장 결과 미확정', nextAction: '현재 주문 확인' })).toBe('저장 결과 미확정\n현재 주문 확인');
  });
});
