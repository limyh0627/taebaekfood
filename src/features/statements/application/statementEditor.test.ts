import { expect, it, vi } from 'vitest';
import type { IssuedStatement } from '../../../shared/types';
import { buildStatementEditPatch, captureStatementEdit, executeStatementEdit, executePersistentStatementEdit, type StatementEditWriter } from './statementEditor';
import type { StatementEditBindings, StatementEditEntry, StatementEditObservation } from '../../../shared/services/statementEditWrites';
const original: IssuedStatement = { id: 's', companyId: 'taebaek', mutationRevision: 0, tradeDate: '2026-10-01', issuedAt: '2026-10-01T00:00:00Z', type: '매입', partnerId: 'p', partnerName: '거래처', orderId: '', docNo: '원번호', totalSupply: 100, totalTax: 0, totalAmount: 100, items: [] };
const context = () => ({ companyId: 'taebaek' as const, actorUid: 'uid-a', isCurrent: () => true });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => resolve = yes); return { promise, resolve }; };
it('최초 선택 revision0과 원문을 고정하고 최신목록 revision을 보충하지 않는다', () => {
    const captured = captureStatementEdit(original, 's', 'taebaek');
    original.items.push({ name: '나중', spec: '', qty: 1, price: 1, supply: 1, tax: 0, total: 1, isTaxExempt: false });
    expect(captured.expectedRevision).toBe(0);
    expect(captured.original.items).toEqual([]);
    original.items = [];
    expect(() => captureStatementEdit(original, '다른번호', 'taebaek')).toThrow('원문');
    expect(() => captureStatementEdit({ ...original, companyId: 'punghoe' }, 's', 'taebaek')).toThrow('원문');
    expect(() => captureStatementEdit({ ...original, mutationRevision: -1 }, 's', 'taebaek')).toThrow('버전');
    expect(captureStatementEdit({ ...original, companyId: undefined, mutationRevision: undefined }, 's', 'taebaek').expectedRevision).toBe(0);
});
it('전체 편집 payload는 기존 수량금액과 매입 스냅샷/순번을 그대로 전달한다', () => {
    const patch = buildStatementEditPatch({ tradeDate: '2026-10-02', memo: ' 메모 ', partnerId: 'p', partnerName: '업체', totalSupply: 321, totalTax: 12, totalAmount: 333, type: '매입', lines: [{ key: 'x', no: 1, name: '품목', spec: '규격', qty: 2.5, price: 17, supply: 321, tax: 12, total: 333, isTaxExempt: false, purchaseQuantityKg: 3.5, side: '차변' }] });
    expect(patch).toEqual({ tradeDate: '2026-10-02', memo: '메모', partnerId: 'p', partnerName: '업체', totalSupply: 321, totalTax: 12, totalAmount: 333, partySnapshot: undefined, items: [{ name: '품목', spec: '규격', qty: 2.5, price: 17, supply: 321, tax: 12, total: 333, isTaxExempt: false, accountCode: undefined, side: '차변', purchaseQuantityKg: 3.5 }] });
});
it('원 revision과 actor/current를 writer에 전달하고 ACK 전 후속을 실행하지 않는다', async () => {
    const wait = deferred(), save = vi.fn<StatementEditWriter>(() => wait.promise), afterSave = vi.fn(), ctx = context();
    const pending = executeStatementEdit({ original, patch: { memo: '변경' }, context: ctx, save, afterSave });
    expect(save).toHaveBeenCalledWith('s', { memo: '변경' }, expect.objectContaining({ mutationRevision: 0 }), 'uid-a', ctx.isCurrent);
    expect(afterSave).not.toHaveBeenCalled();
    wait.resolve();
    expect((await pending).status).toBe('saved');
    expect(afterSave).toHaveBeenCalledWith(ctx.isCurrent);
});
it('미송신 scope불일치/미연결은 not-started이고 void는 ACK가 아니다', async () => {
    const save = vi.fn<StatementEditWriter>();
    expect((await executeStatementEdit({ original, patch: {}, context: { ...context(), isCurrent: () => false }, save })).status).toBe('not-started');
    expect(save).not.toHaveBeenCalled();
    expect((await executeStatementEdit({ original, patch: {}, context: context() })).status).toBe('not-started');
    expect((await executeStatementEdit({ original, patch: {}, context: context(), save })).status).toBe('unknown');
});
it('송신 오류는 저장실패 확정이 아닌 unknown과 원인을 보존한다', async () => {
    const result = await executeStatementEdit({ original, patch: {}, context: context(), save: vi.fn().mockRejectedValue(Error('응답 유실')) });
    expect(result).toMatchObject({ status: 'unknown', acknowledged: false });
    expect(result.message).toContain('응답 유실');
});
it('늦은 ACK는 후속저장과 현재초안 종결을 허용하지 않는다', async () => {
    let current = true;
    const wait = deferred(), afterSave = vi.fn();
    const pending = executeStatementEdit({ original, patch: {}, context: { ...context(), isCurrent: () => current }, save: () => wait.promise, afterSave });
    current = false;
    wait.resolve();
    expect(await pending).toMatchObject({ status: 'stale', acknowledged: true });
    expect(afterSave).not.toHaveBeenCalled();
});
it('전표 ACK 뒤 가격 후속 실패는 재수정 금지의 부분완료와 원인을 보존한다', async () => {
    const result = await executeStatementEdit({ original, patch: {}, context: context(), save: async () => { }, afterSave: async () => { throw Error('원가 응답 유실'); } });
    expect(result).toMatchObject({ status: 'partial', acknowledged: true });
    expect(result.message).toContain('원가 응답 유실');
    expect(result.message).toContain('다시 수정하지 말고');
});
function persistentFixture() {
    const entry = { key: 'key', reference: { companyId: 'taebaek', operationId: 'operation-123', statementId: original.id }, retained: null, observedLocalText: 'body', observedReferenceText: 'ref', description: '전표 수정' } as StatementEditEntry;
    const observation: StatementEditObservation = { entry, result: { version: 1, reference: entry.reference!, actorUid: 'uid-a', status: 'applied', requestHash: 'a'.repeat(64), revision: 1, message: '본문 완료' }, terminal: true, copyMismatch: false, message: '본문 완료', nextAction: '후속 확인' };
    const prepare = vi.fn(async () => entry), apply = vi.fn(async () => observation), markFollowup = vi.fn(async () => entry), discardObserved = vi.fn(async () => observation);
    // 실행 순서 검증은 application이 실제 호출하는 네 포트만 대체한다.
    const ports = { prepare, apply, markFollowup, discardObserved } as unknown as StatementEditBindings;
    return { entry, observation, ports, prepare, apply, markFollowup, discardObserved };
}
it('영속 실행은 준비→본문ACK→ACK마커→후속→사본정리 순서를 지킨다', async () => {
    const h = persistentFixture(), order: string[] = [];
    h.prepare.mockImplementation(async () => { order.push('prepare'); return h.entry; });
    h.apply.mockImplementation(async () => { order.push('body'); return h.observation; });
    h.markFollowup.mockImplementation(async () => { order.push('mark'); return h.entry; });
    h.discardObserved.mockImplementation(async () => { order.push('clear'); return h.observation; });
    const result = await executePersistentStatementEdit({ ports: h.ports, scope: { companyId: 'taebaek', actorUid: 'uid-a' }, original, patch: {}, plan: null, current: () => true, afterSave: () => { order.push('followup'); } });
    expect(result.status).toBe('saved');
    expect(order).toEqual(['prepare', 'body', 'mark', 'followup', 'clear']);
});
it('영속 본문ACK 뒤 ACK마커 저장 실패는 partial이며 후속0·정리0이다', async () => {
    const h = persistentFixture(), afterSave = vi.fn();
    h.markFollowup.mockRejectedValue(Error('보관 실패'));
    const result = await executePersistentStatementEdit({ ports: h.ports, scope: { companyId: 'taebaek', actorUid: 'uid-a' }, original, patch: {}, plan: null, current: () => true, afterSave });
    expect(result).toMatchObject({ status: 'partial', acknowledged: true });
    expect(afterSave).not.toHaveBeenCalled();
    expect(h.discardObserved).not.toHaveBeenCalled();
});
it('running 마커 저장이 실패하면 실제 후속 쓰기를 시작하지 않는다', async () => {
    const h = persistentFixture(), write = vi.fn();
    h.markFollowup.mockResolvedValueOnce(h.entry).mockRejectedValue(Error('진행 보관 실패'));
    const result = await executePersistentStatementEdit({ ports: h.ports, scope: { companyId: 'taebaek', actorUid: 'uid-a' }, original, patch: {}, plan: null, current: () => true, afterSave: async (_current, report) => { await report({ stage: 'terms', index: 0, status: 'running' }); await write(); } });
    expect(result.status).toBe('partial');
    expect(write).not.toHaveBeenCalled();
    expect(h.discardObserved).not.toHaveBeenCalled();
});
it('영속 본문 unknown은 후속과 사본 정리를 실행하지 않는다', async () => {
    const h = persistentFixture(), afterSave = vi.fn();
    h.apply.mockResolvedValue({ ...h.observation, terminal: false, result: { ...h.observation.result, status: 'unknown' } });
    const result = await executePersistentStatementEdit({ ports: h.ports, scope: { companyId: 'taebaek', actorUid: 'uid-a' }, original, patch: {}, plan: null, current: () => true, afterSave });
    expect(result.status).toBe('unknown');
    expect(afterSave).not.toHaveBeenCalled();
    expect(h.markFollowup).not.toHaveBeenCalled();
    expect(h.discardObserved).not.toHaveBeenCalled();
});
