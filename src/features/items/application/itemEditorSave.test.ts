import { expect, it } from 'vitest';
import { applyItemEditorResult, createItemEditorProgress } from './itemEditorSave';
import { ITEM_EDITOR_STAGES, normalizeItemEditorResult, type ItemEditorResult } from '../../../shared/itemEditorCommand';
const ref = {
    companyId: 'taebaek' as const,
    planId: 'plan',
    targetId: 'item'
  },
  hash = 'a'.repeat(64);
const response = (status: ItemEditorResult['status'], count: number): ItemEditorResult => normalizeItemEditorResult({
  ...ref,
  actorUid: 'actor',
  requestHash: status === 'unknown' ? null : hash,
  status,
  confirmedStageIds: ITEM_EDITOR_STAGES.slice(0, count),
  message: '서버 원인'
}, ref, 'actor', hash);
it('전체 다섯 단계 영수증만 저장 완료로 표시한다', () => {
  const progress = createItemEditorProgress('item');
  expect(applyItemEditorResult(response('active', 1), progress).outcome.status).toBe('partial');
  expect(progress.confirmedStageIds).toEqual(['primary']);
  expect(applyItemEditorResult(response('completed', 5), progress).outcome.status).toBe('saved');
  expect(progress.confirmedStageIds).toEqual([...ITEM_EDITOR_STAGES]);
});
it('응답 미확정은 이미 확인한 ACK를 잃지 않고 남은 단계의 결과 확인을 요구한다', () => {
  const progress = createItemEditorProgress('item');
  applyItemEditorResult(response('active', 2), progress);
  const result = applyItemEditorResult(response('unknown', 0), progress);
  expect(result.outcome).toMatchObject({
    status: 'partial',
    committedIds: ['item'],
    unconfirmedIds: []
  });
  expect(progress.confirmedStageIds).toEqual(['primary', 'bom-cost']);
  expect(progress.unknownStageId).toBe('formula');
});
it('취소는 완료분을 롤백했다고 안내하지 않고 남은 단계만 종결한다', () => {
  const progress = createItemEditorProgress('item');
  const result = applyItemEditorResult(response('cancelled', 2), progress);
  expect(result.outcome.status).toBe('cancelled');
  expect(result.outcome).toMatchObject({
    message: expect.stringContaining('완료된 단계는 유지')
  });
  expect(progress.confirmedStageIds).toEqual(['primary', 'bom-cost']);
  expect(progress.terminalStatus).toBe('cancelled');
});
it('주 저장 이전 거절과 이후 거절의 부분 결과를 구분하고 원인을 보존한다', () => {
  expect(applyItemEditorResult(response('rejected', 0), createItemEditorProgress('item')).outcome).toMatchObject({
    status: 'rejected',
    message: '서버 원인'
  });
  expect(applyItemEditorResult(response('rejected', 1), createItemEditorProgress('item')).outcome).toMatchObject({
    status: 'partial',
    message: '서버 원인',
    committedIds: ['item']
  });
});
it('다른 계획 또는 이미 확인한 단계보다 줄어든 결과로 원문을 해제하지 않는다', () => {
  const progress = createItemEditorProgress('item');
  applyItemEditorResult(response('active', 3), progress);
  expect(applyItemEditorResult(response('active', 1), progress).outcome.status).toBe('partial');
  expect(progress.confirmedStageIds).toEqual(['primary', 'bom-cost', 'formula']);
  expect(progress.unknownStageId).toBe('formula-cost');
  const other = {
    ...response('completed', 5),
    planId: 'other'
  };
  expect(applyItemEditorResult(other, progress).outcome.status).toBe('partial');
  expect(progress.terminalStatus).toBe('active');
});
