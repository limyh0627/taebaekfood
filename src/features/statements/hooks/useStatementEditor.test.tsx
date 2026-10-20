/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { IssuedStatement } from '../../../shared/types';
import type { StatementEditWriter } from '../application/statementEditor';
const runtime = vi.hoisted(() => ({ auth: { currentUser: { uid: 'actor' } }, changed: (_user: { uid: string }) => {} }));
vi.mock('../../../shared/firebase', () => ({ auth: runtime.auth }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: typeof runtime.changed) => { runtime.changed = callback; return () => {}; } }));
import { useStatementEditor } from './useStatementEditor';
const original = { id: 'statement', companyId: 'taebaek', mutationRevision: 0, items: [], type: '매출' } as unknown as IssuedStatement;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { runtime.auth.currentUser = { uid: 'actor' }; });
function setup(save = vi.fn<StatementEditWriter>(async () => undefined)) {
  const onCommitted = vi.fn();
  const hook = renderHook(({ fingerprint, companyId }: { fingerprint: string; companyId: 'taebaek' | 'punghoe' }) => useStatementEditor({ companyId, actorUid: 'actor', original, draftFingerprint: fingerprint, save, onCommitted }), { initialProps: { fingerprint: 'A', companyId: 'taebaek' as 'taebaek' | 'punghoe' } });
  return { ...hook, save, onCommitted };
}
it('확인 대기 전 동기 잠금으로 중복 클릭을 막고 최초 r0를 전달한다', async () => {
  const wait = deferred<boolean>(); const view = setup(); let first!: Promise<unknown>;
  act(() => { first = view.result.current.saveEdit({ patch: { memo: 'A' }, confirm: () => wait.promise }); void view.result.current.saveEdit({ patch: { memo: 'A' } }); });
  expect(view.result.current.busy).toBe(true); expect(view.save).not.toHaveBeenCalled();
  await act(async () => { wait.resolve(true); await first; });
  expect(view.save).toHaveBeenCalledTimes(1); expect(view.save.mock.calls[0][2]).toMatchObject({ mutationRevision: 0 }); expect(view.onCommitted).toHaveBeenCalledTimes(1);
});
it('확인 중 전체 초안이 바뀌면 전송하지 않는다', async () => {
  const wait = deferred<boolean>(); const view = setup(); let task!: Promise<unknown>;
  act(() => { task = view.result.current.saveEdit({ patch: { memo: 'A' }, confirm: () => wait.promise }); });
  view.rerender({ fingerprint: 'B', companyId: 'taebaek' });
  await act(async () => { wait.resolve(true); await task; }); expect(view.save).not.toHaveBeenCalled(); expect(view.onCommitted).not.toHaveBeenCalled();
});
it('옛 ACK와 finally는 새 초안의 busy와 창을 바꾸지 않는다', async () => {
  const old = deferred<void>(), fresh = deferred<void>(); const save = vi.fn<StatementEditWriter>().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise); const view = setup(save); let a!: Promise<unknown>, b!: Promise<unknown>;
  act(() => { a = view.result.current.saveEdit({ patch: { memo: 'A' } }); }); view.rerender({ fingerprint: 'B', companyId: 'taebaek' });
  act(() => { b = view.result.current.saveEdit({ patch: { memo: 'B' } }); });
  await act(async () => { old.resolve(); await a; }); expect(view.result.current.busy).toBe(true); expect(view.onCommitted).not.toHaveBeenCalled();
  await act(async () => { fresh.resolve(); await b; }); expect(view.onCommitted).toHaveBeenCalledTimes(1);
});
it('UID가 확인 중 바뀌었다 돌아와도 옛 전송을 재개하지 않는다', async () => {
  const wait = deferred<boolean>(); const view = setup(); let task!: Promise<unknown>;
  act(() => { task = view.result.current.saveEdit({ patch: {}, confirm: () => wait.promise }); runtime.auth.currentUser = { uid: 'other' }; runtime.changed(runtime.auth.currentUser); runtime.auth.currentUser = { uid: 'actor' }; runtime.changed(runtime.auth.currentUser); });
  await act(async () => { wait.resolve(true); await task; }); expect(view.save).not.toHaveBeenCalled();
});
it('저장 실패는 원문을 유지하고 같은 초안 자동 재송신을 막는다', async () => {
  const save = vi.fn<StatementEditWriter>(async () => { throw Error('연결 끊김'); }); const view = setup(save);
  await act(async () => { await view.result.current.saveEdit({ patch: { memo: 'A' } }); });
  expect(view.result.current.error).toContain('연결 끊김'); expect(view.result.current.locked).toBe(true); expect(view.onCommitted).not.toHaveBeenCalled();
  await act(async () => { await view.result.current.saveEdit({ patch: { memo: 'A' } }); }); expect(save).toHaveBeenCalledTimes(1);
});
it('후속 처리 실패는 부분 완료를 표시하고 창을 유지한다', async () => {
  const view = setup(); await act(async () => { await view.result.current.saveEdit({ patch: {}, afterSave: async () => { throw Error('가격 실패'); } }); });
  expect(view.result.current.error).toContain('수정은 완료'); expect(view.result.current.locked).toBe(true); expect(view.onCommitted).not.toHaveBeenCalled();
});
it('날짜 확인 중 회사 변경은 전송하지 않고 새 회사 잠금을 해제한다', async () => {
  const wait = deferred<boolean>(); const view = setup(); let task!: Promise<unknown>;
  act(() => { task = view.result.current.updateDate(original, '2026-10-22', () => wait.promise); }); view.rerender({ fingerprint: 'A', companyId: 'punghoe' });
  await act(async () => { wait.resolve(true); await task; }); expect(view.save).not.toHaveBeenCalled(); expect(view.result.current.busy).toBe(false);
});
it('초안 변경 뒤에도 미확정 근거를 보존하고 같은 원문 재전송은 막는다', async () => {
  const save = vi.fn<StatementEditWriter>(async () => { throw Error('응답 없음'); }); const view = setup(save);
  await act(async () => { await view.result.current.saveEdit({ patch: { memo: 'A' } }); });
  view.rerender({ fingerprint: 'B', companyId: 'taebaek' }); expect(view.result.current.notice).toContain('안전한 재시도가 아닙니다'); expect(view.result.current.locked).toBe(false);
  view.rerender({ fingerprint: 'A', companyId: 'taebaek' });
  await act(async () => { await view.result.current.saveEdit({ patch: { memo: 'A' } }); }); expect(save).toHaveBeenCalledTimes(1); expect(view.result.current.error).toContain('실제 내용');
});
it('확인 중 외부 patch 객체가 바뀌어도 클릭한 원문만 송신한다', async () => {
  const wait = deferred<boolean>(), view = setup(); const patch = { memo: '첫 입력' }; let task!: Promise<unknown>;
  act(() => { task = view.result.current.saveEdit({ patch, confirm: () => wait.promise }); }); patch.memo = '교체';
  await act(async () => { wait.resolve(true); await task; }); expect(view.save.mock.calls[0][1]).toMatchObject({ memo: '첫 입력' });
});
it('증빙 실패도 실제 결과를 반환하고 현재 편집창을 닫지 않는다', async () => {
  const save = vi.fn<StatementEditWriter>(async () => { throw Error('증빙 연결 오류'); }); const view = setup(save);
  let outcome: unknown; await act(async () => { outcome = await view.result.current.updateEvidence(original, '세금계산서'); });
  expect(outcome).toMatchObject({ status: 'unknown' }); expect(view.result.current.error).toContain('증빙 연결 오류'); expect(view.onCommitted).not.toHaveBeenCalled();
});
