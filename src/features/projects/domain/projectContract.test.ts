import { describe, expect, it } from 'vitest';
import { deriveChecklistProgress, normalizeProjectRequest, validateProjectTransition } from './projectContract';

describe('프로젝트 체크리스트 진행률', () => {
  it('빈 목록은 진행률이 없다', () => {
    expect(deriveChecklistProgress({})).toEqual({ done: 0, total: 0, percent: null });
  });
  it('활성 항목만 실제 체크 상태로 계산하며 입력을 바꾸지 않는다', () => {
    const rows = Object.freeze({ a: Object.freeze({ title: '완료', checked: true }), b: Object.freeze({ title: '남음', checked: false }) });
    expect(deriveChecklistProgress(rows)).toEqual({ done: 1, total: 2, percent: 50 });
    expect(rows.b.checked).toBe(false);
  });
  it('체크나 삭제 상태가 불명인 원문을 정상 항목으로 추정하지 않는다', () => {
    expect(() => deriveChecklistProgress({ a: { checked: true } } as never)).toThrow();
    expect(() => deriveChecklistProgress({ a: { title: '항목', checked: undefined } } as never)).toThrow();
  });
});

it('업무 완료 상태 변경은 체크리스트를 자동으로 바꾸지 않는다', () => {
  const project = { companyId: 'taebaek', epoch: 'epoch', status: 'active', revision: 1, ownerEmployeeId: 'employee', participantIds: ['employee'] }, task = { projectEpoch: 'epoch', revision: 3, deletedAt: null, checklist: { first: { title: '검사', checked: false } }, assigneeEmployeeId: null };
  const request = { version: 1, companyId: 'taebaek', projectId: 'p', projectEpoch: 'epoch', operationId: 'op', actorUid: 'uid', actorEmployeeId: 'employee', action: 'task.edit', target: { kind: 'task', id: 'task' }, expectedProjectRevision: 1, expectedTargetRevision: 3, input: { title: '업무', description: '', status: 'done', assigneeEmployeeId: null, startDate: null, endDate: null, priority: 'normal', tags: [] } };
  const next = validateProjectTransition({ project, target: task }, request, { companyId: 'taebaek', actorUid: 'uid', employeeId: 'employee', admin: false }, 'now');
  expect(next.target?.status).toBe('done');
  expect(next.target?.checklist).toEqual({ first: { title: '검사', checked: false } });
  expect(task.checklist.first.checked).toBe(false);
});

describe('프로젝트 요청 원문', () => {
  const base = { version: 1, companyId: 'taebaek', projectId: 'p', projectEpoch: 'epoch', operationId: 'op', actorUid: 'uid', actorEmployeeId: 'employee', action: 'task.create', target: { kind: 'task', id: 'task' }, expectedProjectRevision: 1, expectedTargetRevision: null, input: { title: '업무', description: '', status: 'todo', assigneeEmployeeId: null, startDate: '2026-11-02', endDate: null, priority: 'normal', tags: ['중요'] } };
  it('업무 날짜와 원문을 유지하고 입력 객체와 분리한다', () => {
    const value = normalizeProjectRequest(base);
    expect(value).toEqual(base);
    expect(value.input).not.toBe(base.input);
  });
  it('알 수 없는 입력, 잘못된 날짜, 교차된 대상, 비정상 버전을 거절한다', () => {
    expect(() => normalizeProjectRequest({ ...base, extra: true })).toThrow();
    expect(() => normalizeProjectRequest({ ...base, input: { ...base.input, startDate: '2026-02-30' } })).toThrow();
    expect(() => normalizeProjectRequest({ ...base, target: { kind: 'project', id: 'p' } })).toThrow();
    expect(() => normalizeProjectRequest({ ...base, expectedProjectRevision: NaN })).toThrow();
  });
  it('체크리스트 생성은 물리 대상인 업무의 기존 revision을 요구한다', () => {
    const request = { ...base, action: 'checklist.create', target: { kind: 'checklist', id: 'check', taskId: 'task' }, expectedTargetRevision: 2, input: { title: '확인', checked: false } };
    expect(normalizeProjectRequest(request)).toEqual(request);
    expect(() => normalizeProjectRequest({ ...request, expectedTargetRevision: null })).toThrow();
  });
});
