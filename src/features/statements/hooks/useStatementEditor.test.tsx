/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import type { IssuedStatement } from '../../../shared/types';
import type { StatementEditWriter } from '../application/statementEditor';
const runtime = vi.hoisted(() => ({ auth: { currentUser: { uid: 'actor' } }, changed: (_user: {
        uid: string;
    }) => { } }));
vi.mock('../../../shared/firebase', () => ({ auth: runtime.auth }));
vi.mock('../../../shared/services/firebaseService', () => ({ activeReleaseId: async () => 'release', stripUndefined: (value: unknown) => JSON.parse(JSON.stringify(value)) }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: typeof runtime.changed) => { runtime.changed = callback; return () => { }; } }));
import { useStatementEditor } from './useStatementEditor';
import { createStatementEditWrites, type StatementEditBindings, type StatementEditPort, type StatementEditFollowupPlan } from '../../../shared/services/statementEditWrites';
const original = { id: 'statement', companyId: 'taebaek', mutationRevision: 0, items: [], type: '매출' } as unknown as IssuedStatement;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { runtime.auth.currentUser = { uid: 'actor' }; vi.stubGlobal('crypto', webcrypto); localStorage.clear(); });
function setup(save = vi.fn<StatementEditWriter>(async () => undefined)) {
    const onCommitted = vi.fn();
    const hook = renderHook(({ fingerprint, companyId }: {
        fingerprint: string;
        companyId: 'taebaek' | 'punghoe';
    }) => useStatementEditor({ companyId, actorUid: 'actor', original, draftFingerprint: fingerprint, save, onCommitted }), { initialProps: { fingerprint: 'A', companyId: 'taebaek' as 'taebaek' | 'punghoe' } });
    return { ...hook, save, onCommitted };
}
it('확인 대기 전 동기 잠금으로 중복 클릭을 막고 최초 r0를 전달한다', async () => {
    const wait = deferred<boolean>();
    const view = setup();
    let first!: Promise<unknown>;
    act(() => { first = view.result.current.saveEdit({ patch: { memo: 'A' }, confirm: () => wait.promise }); void view.result.current.saveEdit({ patch: { memo: 'A' } }); });
    expect(view.result.current.busy).toBe(true);
    expect(view.save).not.toHaveBeenCalled();
    await act(async () => { wait.resolve(true); await first; });
    expect(view.save).toHaveBeenCalledTimes(1);
    expect(view.save.mock.calls[0][2]).toMatchObject({ mutationRevision: 0 });
    expect(view.onCommitted).toHaveBeenCalledTimes(1);
});
it('확인 중 전체 초안이 바뀌면 전송하지 않는다', async () => {
    const wait = deferred<boolean>();
    const view = setup();
    let task!: Promise<unknown>;
    act(() => { task = view.result.current.saveEdit({ patch: { memo: 'A' }, confirm: () => wait.promise }); });
    view.rerender({ fingerprint: 'B', companyId: 'taebaek' });
    await act(async () => { wait.resolve(true); await task; });
    expect(view.save).not.toHaveBeenCalled();
    expect(view.onCommitted).not.toHaveBeenCalled();
});
it('옛 ACK와 finally는 새 초안의 busy와 창을 바꾸지 않는다', async () => {
    const old = deferred<void>(), fresh = deferred<void>();
    const save = vi.fn<StatementEditWriter>().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const view = setup(save);
    let a!: Promise<unknown>, b!: Promise<unknown>;
    act(() => { a = view.result.current.saveEdit({ patch: { memo: 'A' } }); });
    view.rerender({ fingerprint: 'B', companyId: 'taebaek' });
    act(() => { b = view.result.current.saveEdit({ patch: { memo: 'B' } }); });
    await act(async () => { old.resolve(); await a; });
    expect(view.result.current.busy).toBe(true);
    expect(view.onCommitted).not.toHaveBeenCalled();
    await act(async () => { fresh.resolve(); await b; });
    expect(view.onCommitted).toHaveBeenCalledTimes(1);
});
it('UID가 확인 중 바뀌었다 돌아와도 옛 전송을 재개하지 않는다', async () => {
    const wait = deferred<boolean>();
    const view = setup();
    let task!: Promise<unknown>;
    act(() => { task = view.result.current.saveEdit({ patch: {}, confirm: () => wait.promise }); runtime.auth.currentUser = { uid: 'other' }; runtime.changed(runtime.auth.currentUser); runtime.auth.currentUser = { uid: 'actor' }; runtime.changed(runtime.auth.currentUser); });
    await act(async () => { wait.resolve(true); await task; });
    expect(view.save).not.toHaveBeenCalled();
});
it('저장 실패는 원문을 유지하고 같은 초안 자동 재송신을 막는다', async () => {
    const save = vi.fn<StatementEditWriter>(async () => { throw Error('연결 끊김'); });
    const view = setup(save);
    await act(async () => { await view.result.current.saveEdit({ patch: { memo: 'A' } }); });
    expect(view.result.current.error).toContain('연결 끊김');
    expect(view.result.current.locked).toBe(true);
    expect(view.onCommitted).not.toHaveBeenCalled();
    await act(async () => { await view.result.current.saveEdit({ patch: { memo: 'A' } }); });
    expect(save).toHaveBeenCalledTimes(1);
});
it('후속 처리 실패는 부분 완료를 표시하고 창을 유지한다', async () => {
    const view = setup();
    await act(async () => { await view.result.current.saveEdit({ patch: {}, afterSave: async () => { throw Error('가격 실패'); } }); });
    expect(view.result.current.error).toContain('수정은 완료');
    expect(view.result.current.locked).toBe(true);
    expect(view.onCommitted).not.toHaveBeenCalled();
});
it('날짜 확인 중 회사 변경은 전송하지 않고 새 회사 잠금을 해제한다', async () => {
    const wait = deferred<boolean>();
    const view = setup();
    let task!: Promise<unknown>;
    act(() => { task = view.result.current.updateDate(original, '2026-10-22', () => wait.promise); });
    view.rerender({ fingerprint: 'A', companyId: 'punghoe' });
    await act(async () => { wait.resolve(true); await task; });
    expect(view.save).not.toHaveBeenCalled();
    expect(view.result.current.busy).toBe(false);
});
it('초안 변경 뒤에도 미확정 근거를 보존하고 같은 원문 재전송은 막는다', async () => {
    const save = vi.fn<StatementEditWriter>(async () => { throw Error('응답 없음'); });
    const view = setup(save);
    await act(async () => { await view.result.current.saveEdit({ patch: { memo: 'A' } }); });
    view.rerender({ fingerprint: 'B', companyId: 'taebaek' });
    expect(view.result.current.notice).toContain('안전한 재시도가 아닙니다');
    expect(view.result.current.locked).toBe(false);
    view.rerender({ fingerprint: 'A', companyId: 'taebaek' });
    await act(async () => { await view.result.current.saveEdit({ patch: { memo: 'A' } }); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(view.result.current.error).toContain('실제 내용');
});
it('확인 중 외부 patch 객체가 바뀌어도 클릭한 원문만 송신한다', async () => {
    const wait = deferred<boolean>(), view = setup();
    const patch = { memo: '첫 입력' };
    let task!: Promise<unknown>;
    act(() => { task = view.result.current.saveEdit({ patch, confirm: () => wait.promise }); });
    patch.memo = '교체';
    await act(async () => { wait.resolve(true); await task; });
    expect(view.save.mock.calls[0][1]).toMatchObject({ memo: '첫 입력' });
});
it('증빙 실패도 실제 결과를 반환하고 현재 편집창을 닫지 않는다', async () => {
    const save = vi.fn<StatementEditWriter>(async () => { throw Error('증빙 연결 오류'); });
    const view = setup(save);
    let outcome: unknown;
    await act(async () => { outcome = await view.result.current.updateEvidence(original, '세금계산서'); });
    expect(outcome).toMatchObject({ status: 'unknown' });
    expect(view.result.current.error).toContain('증빙 연결 오류');
    expect(view.onCommitted).not.toHaveBeenCalled();
});
function recoverySetup() {
    let number = 0;
    const call = vi.fn<StatementEditPort['call']>();
    const port: StatementEditPort = { storage: localStorage, check: async (_scope, current) => { if (!current())
            throw Error('현재 계정 아님'); }, exclusive: async (_scope, work) => work(), call, release: async () => 'release', id: () => `operation-${++number}`, now: () => '2026-10-21T00:00:00Z' };
    const bindings = createStatementEditWrites(port), onCommitted = vi.fn();
    const scope = { companyId: 'taebaek' as const, actorUid: 'actor' };
    const applied = async () => { const entry = (await bindings.readPending(scope))[0]; return { version: 1, reference: entry.reference, actorUid: 'actor', status: 'applied', requestHash: entry.retained?.requestHash, revision: 1, message: '본문 반영' }; };
    const mount = (ports: StatementEditBindings = bindings) => renderHook(() => useStatementEditor({ ...scope, original, draftFingerprint: 'A', bindings: ports, onCommitted }));
    return { bindings, call, scope, applied, mount, onCommitted, port };
}
it('영속 원문 ACK 뒤에만 현재 폼을 닫고 완료 사본을 정리한다', async () => {
    const setup = recoverySetup();
    setup.call.mockImplementation(setup.applied);
    const view = setup.mount();
    await waitFor(() => expect(view.result.current.readLoading).toBe(false));
    await act(async () => { await view.result.current.saveEdit({ patch: { memo: '원문' } }); });
    expect(setup.onCommitted).toHaveBeenCalledOnce();
    expect(await setup.bindings.readPending(setup.scope)).toHaveLength(0);
    expect(setup.call).toHaveBeenCalledTimes(2);
});
it('응답 유실 뒤 reload는 원문과 원인을 읽고 조회만으로 새 폼을 닫지 않는다', async () => {
    const setup = recoverySetup();
    setup.call.mockRejectedValueOnce(Error('요청 시간 초과'));
    let view = setup.mount();
    await waitFor(() => expect(view.result.current.readLoading).toBe(false));
    await act(async () => { await view.result.current.saveEdit({ patch: { memo: '원문' } }); });
    expect(view.result.current.failureCount).toBe(1);
    view.unmount();
    view = setup.mount();
    await waitFor(() => expect(view.result.current.failureCount).toBe(1));
    expect(view.result.current.failureRows[0].cause).toContain('시간 초과');
    expect(setup.call).toHaveBeenCalledTimes(1);
    setup.call.mockImplementation(setup.applied);
    await act(async () => { await view.result.current.inspect(view.result.current.failureRows[0].entry); });
    expect(setup.call.mock.calls[1][0]).toMatchObject({ mode: 'inspect' });
    expect(setup.onCommitted).not.toHaveBeenCalled();
});
it('본문 ACK 마커 저장 실패는 부분 완료로 남기고 후속을 시작하지 않는다', async () => {
    const setup = recoverySetup();
    setup.call.mockImplementation(setup.applied);
    const afterSave = vi.fn();
    const view = setup.mount({ ...setup.bindings, markFollowup: vi.fn(async () => { throw Error('마커 보관 실패'); }) });
    await waitFor(() => expect(view.result.current.readLoading).toBe(false));
    let result: unknown;
    await act(async () => { result = await view.result.current.saveEdit({ patch: {}, afterSave }); });
    expect(result).toMatchObject({ status: 'partial', acknowledged: true });
    expect(afterSave).not.toHaveBeenCalled();
    expect(setup.onCommitted).not.toHaveBeenCalled();
    expect(view.result.current.failureCount).toBe(1);
});
it('고정 후속 계획은 running과 응답 뒤 완료를 보관하고 재시작 때 자동 실행하지 않는다', async () => {
    const setup = recoverySetup();
    setup.call.mockImplementation(setup.applied);
    const cost = vi.fn();
    const plan: StatementEditFollowupPlan = { upserts: [], openings: [], costUpdates: [{ itemId: 'item', price: 20 }], skipIds: [], isLatest: true };
    const view = setup.mount();
    await waitFor(() => expect(view.result.current.readLoading).toBe(false));
    await act(async () => { await view.result.current.saveEdit({ patch: {}, getFollowupPlan: () => plan, afterSave: async (_current, report) => { await report({ stage: 'cost', index: 0, status: 'running' }); await cost(); throw Error('원가 응답 유실'); } }); });
    const retained = (await setup.bindings.readPending(setup.scope))[0];
    expect(retained.retained?.bodyAcknowledged).toBe(true);
    expect(retained.retained?.progress).toEqual([{ stage: 'cost', index: 0, status: 'running' }]);
    expect(cost).toHaveBeenCalledOnce();
    view.unmount();
    const reloaded = setup.mount();
    await waitFor(() => expect(reloaded.result.current.failureCount).toBe(1));
    expect(cost).toHaveBeenCalledOnce();
    expect(reloaded.result.current.failureRows[0].nextAction).toContain('후속');
});
it('빈 처리기록 페이지도 다음 cursor를 유지하며 과거 완료를 실패로 세지 않는다', async () => {
    const setup = recoverySetup();
    setup.call.mockResolvedValueOnce({ version: 1, companyId: 'taebaek', actorUid: 'actor', entries: [], nextCursor: 'next-page' });
    const view = setup.mount();
    await waitFor(() => expect(view.result.current.readLoading).toBe(false));
    await act(async () => { await view.result.current.loadHistory(); });
    expect(view.result.current.historyMore).toBe(true);
    expect(view.result.current.failureCount).toBe(0);
    setup.call.mockResolvedValueOnce({ version: 1, companyId: 'taebaek', actorUid: 'actor', entries: [{ result: { version: 1, reference: { companyId: 'taebaek', operationId: 'operation-old', statementId: 'old' }, actorUid: 'actor', status: 'applied', requestHash: 'a'.repeat(64), revision: 1, message: '옛 수정 완료' }, createdAt: '2026-10-20' }], nextCursor: null });
    await act(async () => { await view.result.current.nextHistory(); });
    expect(view.result.current.historyRows).toHaveLength(1);
    expect(view.result.current.failureCount).toBe(0);
    expect(setup.onCommitted).not.toHaveBeenCalled();
});
it('중단 확정 뒤 같은 요청 정보를 정리하면 현재 입력 잠금을 풀고 옛 오류를 지운다', async () => {
    const setup = recoverySetup(); setup.call.mockRejectedValueOnce(Error('응답 없음')); const view = setup.mount();
    await waitFor(() => expect(view.result.current.readLoading).toBe(false));
    await act(async () => { await view.result.current.saveEdit({ patch: { memo: '현재 원문' } }); }); expect(view.result.current.locked).toBe(true);
    const entry = view.result.current.failureRows[0].entry;
    setup.call.mockResolvedValue({ version: 1, reference: entry.reference, actorUid: 'actor', status: 'cancelled', requestHash: null, message: '미처리 중단 완료' });
    await act(async () => { await view.result.current.stop(entry); }); expect(view.result.current.locked).toBe(true); expect(view.result.current.canStop(view.result.current.failureRows[0].entry)).toBe(false);
    await act(async () => { await view.result.current.discardCopy(view.result.current.failureRows[0].entry); });
    expect(view.result.current.failureCount).toBe(0); expect(view.result.current.locked).toBe(false); expect(view.result.current.error).toBe(''); expect(setup.onCommitted).not.toHaveBeenCalled();
});
it('복구 재시도 응답도 유실되면 최신 관측값을 다시 읽어 다음 재시도를 이어간다', async () => {
    const setup = recoverySetup(); setup.call.mockRejectedValueOnce(Error('첫 응답 유실')).mockRejectedValueOnce(Error('다음 응답 유실'));
    const view = setup.mount(); await waitFor(() => expect(view.result.current.readLoading).toBe(false));
    await act(async () => { await view.result.current.saveEdit({ patch: { memo: '최초 원문' } }); });
    const previousRaw = view.result.current.failureRows[0].entry.observedLocalText;
    await act(async () => { await view.result.current.retry(view.result.current.failureRows[0].entry); });
    expect(view.result.current.readError).toContain('다음 응답 유실');
    expect(view.result.current.failureRows[0].entry.observedLocalText).not.toBe(previousRaw);
    setup.call.mockImplementation(setup.applied);
    await act(async () => { await view.result.current.retry(view.result.current.failureRows[0].entry); });
    expect(setup.call).toHaveBeenCalledTimes(3); expect(view.result.current.readError).toBe('');
    expect(view.result.current.failureRows[0].currentState).toContain('처리 완료'); expect(setup.onCommitted).not.toHaveBeenCalled();
});
it('회사설정 lease가 확인 대기 중 바뀌면 송신0·입력보존과 자기 busy 해제를 지킨다',async()=>{
 const wait=deferred<boolean>();let current=true;const view=setup();let task!:Promise<unknown>;
 act(()=>{task=view.result.current.saveEdit({patch:{memo:'A'},confirm:()=>wait.promise,isCurrent:()=>current});});
 current=false;await act(async()=>{wait.resolve(true);await task;});
 expect(view.save).not.toHaveBeenCalled();expect(view.onCommitted).not.toHaveBeenCalled();expect(view.result.current.busy).toBe(false);
});
it('영속 prepare 대기 뒤 회사설정 lease가 바뀌면 apply하지 않고 보관원문은 남긴다',async()=>{
 const setup=recoverySetup();const wait=deferred<Awaited<ReturnType<StatementEditBindings['prepare']>>>();let current=true;
 const prepare=vi.fn(async(...args:Parameters<StatementEditBindings['prepare']>)=>{const entry=await setup.bindings.prepare(...args);await wait.promise;return entry;});
 const apply=vi.fn(setup.bindings.apply);const view=setup.mount({...setup.bindings,prepare,apply});await waitFor(()=>expect(view.result.current.readLoading).toBe(false));let task!:Promise<unknown>;
 act(()=>{task=view.result.current.saveEdit({patch:{memo:'A'},isCurrent:()=>current});});await waitFor(()=>expect(prepare).toHaveBeenCalledOnce());
 const entries=await setup.bindings.readPending(setup.scope);await waitFor(()=>expect(entries).toHaveLength(1));current=false;
 await act(async()=>{wait.resolve(entries[0]);await task;});expect(apply).not.toHaveBeenCalled();expect(view.result.current.busy).toBe(false);expect(setup.onCommitted).not.toHaveBeenCalled();expect(await setup.bindings.readPending(setup.scope)).toHaveLength(1);
});


it('실서비스 권한 await 뒤 lease가 바뀌면 최종 callable을 보내지 않는다',async()=>{
 const fixture=recoverySetup(),gate=deferred<void>();let current=true,hold=false,waiting=false;
 const ports=createStatementEditWrites({...fixture.port,check:async(_scope,isCurrent)=>{if(hold){waiting=true;await gate.promise;}if(!isCurrent())throw Error('현재 설정 관측이 바뀜');}});
 const prepare=ports.prepare;
 const view=fixture.mount({...ports,prepare:async(...args)=>{const entry=await prepare(...args);hold=true;return entry;}});
 await waitFor(()=>expect(view.result.current.readLoading).toBe(false));let task!:Promise<unknown>;
 act(()=>{task=view.result.current.saveEdit({patch:{memo:'A'},isCurrent:()=>current});});await waitFor(()=>expect(waiting).toBe(true));
 current=false;await act(async()=>{gate.resolve();await task;});expect(fixture.call).not.toHaveBeenCalled();expect(fixture.onCommitted).not.toHaveBeenCalled();expect(view.result.current.busy).toBe(false);
});
