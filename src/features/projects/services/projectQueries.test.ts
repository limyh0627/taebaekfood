import { beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({ next: undefined as ((snapshot: any) => void) | undefined, fail: undefined as ((error: Error) => void) | undefined, stop: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path }),
  doc: (_db: unknown, ...path: string[]) => ({ path }),
  where: (...args: unknown[]) => ({ kind: 'where', args }),
  orderBy: (...args: unknown[]) => ({ kind: 'orderBy', args }),
  startAfter: (...args: unknown[]) => ({ kind: 'startAfter', args }),
  limit: (count: number) => ({ kind: 'limit', count }),
  query: (ref: unknown, ...constraints: unknown[]) => ({ ref, constraints }),
  onSnapshot: vi.fn((_query, _options, next, fail) => { transport.next = next; transport.fail = fail; return transport.stop; }),
}));
import { onSnapshot } from 'firebase/firestore';
import { createProjectQueries } from './projectQueries';
import type { ProjectScope } from '../domain/projectContract';

const scope: ProjectScope = { companyId: 'taebaek', actorUid: 'uid', employeeId: 'employee', sessionGeneration: 1 };
const handlers = () => ({ next: vi.fn(), error: vi.fn(), invalidated: vi.fn() });

describe('프로젝트 조회 경계', () => {
  beforeEach(() => { vi.clearAllMocks(); transport.next = undefined; transport.fail = undefined; });
  it('참여자 목록은 회사와 직원 ID 조건을 둘 다 적용하고 한 번에 50건만 읽는다', () => {
    const h = handlers();
    createProjectQueries({ db: {} as never, current: () => true }).subscribeProjects(scope, { adminView: false, status: 'active' }, h);
    const observed = vi.mocked(onSnapshot).mock.calls[0][0] as any;
    expect(observed.ref.path).toEqual(['workProjectsV1']);
    expect(observed.constraints).toContainEqual({ kind: 'where', args: ['companyId', '==', 'taebaek'] });
    expect(observed.constraints).toContainEqual({ kind: 'where', args: ['participantIds', 'array-contains', 'employee'] });
    expect(observed.constraints).toContainEqual({ kind: 'limit', count: 50 });
    transport.next!({ docs: [{ id: 'one', data: () => ({ title: '작업' }) }], metadata: { fromCache: true, hasPendingWrites: false } });
    expect(h.next).toHaveBeenCalledWith(expect.objectContaining({ fromCache: true, hasPendingWrites: false, value: expect.objectContaining({ rows: [{ id: 'one', data: { title: '작업' } }] }) }));
  });
  it('회사 또는 로그인 세대가 바뀐 뒤 늦은 응답과 오류를 전달하지 않는다', () => {
    let current = true;
    const h = handlers(), stop = createProjectQueries({ db: {} as never, current: () => current }).subscribeProjects(scope, { adminView: true, status: 'active' }, h);
    current = false;
    transport.next!({ docs: [], metadata: { fromCache: false, hasPendingWrites: false } });
    transport.fail!(new Error('late'));
    expect(h.next).not.toHaveBeenCalled();
    expect(h.error).not.toHaveBeenCalled();
    expect(h.invalidated).toHaveBeenCalledTimes(1);
    stop();
    expect(transport.stop).toHaveBeenCalledOnce();
  });
  it('선택한 epoch과 다른 문서를 같은 프로젝트로 표시하지 않는다', () => {
    const h = handlers();
    createProjectQueries({ db: {} as never, current: () => true }).subscribeProject(scope, 'project', 'epoch', h);
    transport.next!({ id: 'project', exists: () => true, data: () => ({ companyId: 'taebaek', epoch: 'other' }), metadata: { fromCache: false, hasPendingWrites: false } });
    expect(h.error).toHaveBeenCalledOnce();
    expect(h.next).not.toHaveBeenCalled();
  });
  it('슬래시가 든 경로를 거절하고 업무 하위 목록도 상위 경로에 묶는다', () => {
    const api = createProjectQueries({ db: {} as never, current: () => true }), h = handlers();
    expect(() => api.subscribeTasks(scope, 'p/other', {}, h)).toThrow();
    api.subscribeChecklist(scope, 'project', 'task', 'epoch', h);
    expect((vi.mocked(onSnapshot).mock.calls[0][0] as any).path).toEqual(['workProjectsV1', 'project', 'tasks', 'task']);
    transport.next!({ exists: () => true, data: () => ({ projectEpoch: 'epoch', deletedAt: null, checklist: { a: { title: '항목', checked: false } } }), metadata: { fromCache: false, hasPendingWrites: false } });
    expect(h.next).toHaveBeenCalledWith(expect.objectContaining({ value: { a: { title: '항목', checked: false } } }));
  });
});
