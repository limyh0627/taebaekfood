import { expect, it, vi } from 'vitest';
import { createItemEditorProgress, executeItemEditorSteps, type ItemEditorSaveStep } from './itemEditorSave';
it('주 저장과 각 후속 Promise ACK 순서를 기록하며 전부 완료해야 saved다', async () => {
  const progress = createItemEditorProgress('item');
  let finish!: () => void;
  const primary = vi.fn(() => new Promise<void>(r => finish = r)),
    cost = vi.fn(async () => {});
  const task = executeItemEditorSteps('item', [{
    id: 'primary',
    label: '품목·박스·BOM',
    run: primary
  }, {
    id: 'cost:item',
    label: '원가',
    run: cost
  }], progress, () => true);
  expect(cost).not.toHaveBeenCalled();
  finish();
  expect((await task).outcome.status).toBe('saved');
  expect(progress.confirmedStageIds).toEqual(['primary', 'cost:item']);
});
it('후속 ACK 일부 뒤 실패는 정확 단계의 미확정 partial이며 어떤 단계도 자동 재전송하지 않는다', async () => {
  const progress = createItemEditorProgress('item'),
    primary = vi.fn(async () => {}),
    first = vi.fn(async () => {}),
    second = vi.fn(async () => {
      throw Error('응답 유실');
    });
  const steps = [{
    id: 'primary',
    label: '품목',
    run: primary
  }, {
    id: 'cost:a',
    label: '첫 원가',
    run: first
  }, {
    id: 'cost:b',
    label: '둘째 원가',
    run: second
  }];
  const result = await executeItemEditorSteps('item', steps, progress, () => true);
  expect(result.outcome).toMatchObject({
    status: 'partial',
    committedIds: ['item'],
    unconfirmedIds: [],
    message: expect.stringContaining('둘째 원가')
  });
  expect(progress.confirmedStageIds).toEqual(['primary', 'cost:a']);
  expect(progress.unknownStageId).toBe('cost:b');
  await executeItemEditorSteps('item', steps, progress, () => true);
  expect(primary).toHaveBeenCalledOnce();
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
});
it('주 저장 응답 유실은 unknown이고 후속 쓰기와 새 재시도를 막는다', async () => {
  const progress = createItemEditorProgress('item'),
    primary = vi.fn(async () => {
      throw Error('network');
    }),
    follow = vi.fn(async () => {});
  const steps = [{
    id: 'primary',
    label: '품목',
    run: primary
  }, {
    id: 'formula',
    label: '배합',
    run: follow
  }];
  expect((await executeItemEditorSteps('item', steps, progress, () => true)).outcome.status).toBe('unknown');
  await executeItemEditorSteps('item', steps, progress, () => true);
  expect(primary).toHaveBeenCalledOnce();
  expect(follow).not.toHaveBeenCalled();
});
it('회사 전환은 다음 단계를 시작하지 않고 원래 세션의 명시 이어하기는 ACK 단계를 건너뛴다', async () => {
  let current = true;
  const progress = createItemEditorProgress('item'),
    primary = vi.fn(async () => {
      current = false;
    }),
    follow = vi.fn(async () => {});
  const steps = [{
    id: 'primary',
    label: '품목',
    run: primary
  }, {
    id: 'formula',
    label: '배합',
    run: follow
  }];
  expect((await executeItemEditorSteps('item', steps, progress, () => current)).outcome.status).toBe('partial');
  expect(follow).not.toHaveBeenCalled();
  expect(progress.unknownStageId).toBeUndefined();
  current = true;
  expect((await executeItemEditorSteps('item', steps, progress, () => current)).outcome.status).toBe('saved');
  expect(primary).toHaveBeenCalledOnce();
  expect(follow).toHaveBeenCalledOnce();
});
it('다른 품목 진행표와 중복 단계는 쓰기 전에 거절한다', async () => {
  const run = vi.fn(async () => {}),
    step = {
      id: 'primary',
      label: '품목',
      run
    };
  expect((await executeItemEditorSteps('other', [step], createItemEditorProgress('item'), () => true)).outcome.status).toBe('rejected');
  expect((await executeItemEditorSteps('item', [step, step], createItemEditorProgress('item'), () => true)).outcome.status).toBe('rejected');
  expect(run).not.toHaveBeenCalled();
});
it('Promise 없는 잘못된 runtime 포트는 ACK로 추정하지 않는다', async () => {
  const run = vi.fn(() => undefined) as unknown as ItemEditorSaveStep['run'];
  const progress = createItemEditorProgress('item');
  expect((await executeItemEditorSteps('item', [{
    id: 'primary',
    label: '품목',
    run
  }], progress, () => true)).outcome.status).toBe('unknown');
  expect(progress.confirmedStageIds).toEqual([]);
});
it('순수 사전검증 실패는 전송 전 rejected이며 unknown 함정을 남기지 않는다', async () => {
  const progress = createItemEditorProgress('item'),
    run = vi.fn(async () => {});
  const steps = [{
    id: 'primary',
    label: '품목',
    run
  }];
  expect((await executeItemEditorSteps('item', steps, progress, () => true, () => {
    throw Error('500개 초과');
  })).outcome).toMatchObject({
    status: 'rejected',
    message: '500개 초과'
  });
  expect(progress.unknownStageId).toBeUndefined();
  expect(run).not.toHaveBeenCalled();
  expect((await executeItemEditorSteps('item', steps, progress, () => true, () => null)).outcome.status).toBe('saved');
  expect(run).toHaveBeenCalledOnce();
});
it('이미 전송된 미확정은 나중 사전검증 실패로 미저장 거절로 바뀌지 않는다', async () => {
  const progress = createItemEditorProgress('item');
  progress.unknownStageId = 'primary';
  progress.unknownMessage = '앞선 저장 응답 미확인';
  const run = vi.fn(async () => {}),
    preflight = vi.fn(() => {
      throw Error('순수 검증 실패');
    });
  expect((await executeItemEditorSteps('item', [{
    id: 'primary',
    label: '품목',
    run
  }], progress, () => true, preflight)).outcome).toMatchObject({
    status: 'unknown',
    message: '앞선 저장 응답 미확인'
  });
  expect(preflight).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});
it('주 저장 ACK 없이 후속 단계만 주어진 경우 성공으로 표시하거나 쓰지 않는다', async () => {
  const run = vi.fn(async () => {});
  expect((await executeItemEditorSteps('item', [{
    id: 'cost',
    label: '원가',
    run
  }], createItemEditorProgress('item'), () => true)).outcome.status).toBe('rejected');
  expect(run).not.toHaveBeenCalled();
});
