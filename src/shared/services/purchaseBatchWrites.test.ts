/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { auth } from '../firebase';
import * as commands from './purchaseOrderBatchService';
import { purchaseBatchWrites as writes, purchaseBatchKey } from './purchaseBatchWrites';
vi.mock('../firebase', () => ({ auth: { currentUser: { uid: 'u' } }, authReady: Promise.resolve(), db: {} }));
vi.mock('./purchaseOrderBatchService', async (importOriginal) => ({
    ...await importOriginal<typeof import('./purchaseOrderBatchService')>(),
    applyPurchaseOrderBatch: vi.fn(), inspectPurchaseOrderBatch: vi.fn(), cancelPurchaseOrderBatch: vi.fn(),
}));
const scope = () => ({ companyId: 'taebaek' as const, actorUid: 'u', isCurrent: () => true });
const request = (id = 'po-batch-one') => commands.preparePurchaseOrderBatch(scope(), [{ id: id + '-po', data: { companyId: 'taebaek', createdAt: '2026-10-24T01:00:00.000Z', status: 'pending', items: [{ itemId: 'p', quantity: 2 }] } }], { operationId: id, createdAt: '2026-10-24T01:00:00.000Z' });
const result = async (status: 'applied' | 'cancelled' | 'not-found' = 'applied', input = request()) => ({ reference: await commands.purchaseOrderBatchReference(input), status });
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); Object.assign(auth, { currentUser: { uid: 'u' } }); Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto }); });
it('송신 전 양사본을 정확히 보관하고 readonly 재읽기는 송신0', async () => {
    const input = request(), entry = await writes.prepare(scope(), input);
    expect(entry.request).toEqual(input);
    expect(entry.reference).toEqual(await commands.purchaseOrderBatchReference(input));
    expect(await writes.read(scope())).toEqual(entry);
    expect(commands.applyPurchaseOrderBatch).not.toHaveBeenCalled();
});
it('회사UID 한 미결이 남으면 다른 payload도 새 원문으로 대체하지 않는다', async () => {
    const entry = await writes.prepare(scope(), request());
    await expect(writes.prepare(scope(), request('po-batch-two'))).rejects.toThrow('보관된 발주');
    expect(await writes.read(scope())).toEqual(entry);
});
it('동일tick prepare는 하나만 보관한다', async () => {
    const first = writes.prepare(scope(), request());
    await expect(writes.prepare(scope(), request('po-batch-two'))).rejects.toThrow('처리 중');
    await first;
});
it('본문 보관 quota 실패면 apply0·남은 ref로 중단 가능', async () => {
    const key = purchaseBatchKey(scope()), original = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) {
        if (k === key)
            throw Error('quota');
        return original.call(this, k, v);
    });
    await expect(writes.prepare(scope(), request())).rejects.toThrow('quota');
    spy.mockRestore();
    const entry = (await writes.read(scope()))!;
    expect(entry.request).toBeNull();
    expect(entry.reference).not.toBeNull();
    expect(commands.applyPurchaseOrderBatch).not.toHaveBeenCalled();
    vi.mocked(commands.cancelPurchaseOrderBatch).mockResolvedValue(await result('cancelled'));
    expect((await writes.command(scope(), entry, 'cancel')).result?.status).toBe('cancelled');
});
it('응답유실 원인 reload 보존·동일retry·inspect는 apply 추가0', async () => {
    let entry = await writes.prepare(scope(), request());
    vi.mocked(commands.applyPurchaseOrderBatch).mockRejectedValueOnce(Error('응답유실')).mockResolvedValue(await result());
    await expect(writes.command(scope(), entry, 'apply', (next) => { entry = next!; })).rejects.toThrow('응답유실');
    expect((await writes.read(scope()))?.lastAttempt).toBe('응답유실');
    vi.mocked(commands.inspectPurchaseOrderBatch).mockResolvedValue(await result());
    expect((await writes.command(scope(), entry, 'inspect')).result?.status).toBe('applied');
    expect(commands.applyPurchaseOrderBatch).toHaveBeenCalledTimes(1);
    await writes.command(scope(), entry, 'apply');
    expect(vi.mocked(commands.applyPurchaseOrderBatch).mock.calls.map(c => c[1])).toEqual([request(), request()]);
});
it('refonly receipt없음→cancel→재inspectterminal→CAS정리로 새 발주 허용', async () => {
    const before = await writes.prepare(scope(), request());
    localStorage.removeItem(before.key);
    const entry = (await writes.read(scope()))!;
    vi.mocked(commands.inspectPurchaseOrderBatch).mockResolvedValueOnce(await result('not-found')).mockResolvedValueOnce(await result('cancelled'));
    expect((await writes.command(scope(), entry, 'inspect')).result?.status).toBe('not-found');
    vi.mocked(commands.cancelPurchaseOrderBatch).mockResolvedValue(await result('cancelled'));
    await writes.command(scope(), entry, 'cancel');
    await writes.discard(scope(), entry);
    expect(await writes.read(scope())).toBeNull();
    expect((await writes.prepare(scope(), request('po-batch-two'))).request?.operationId).toBe('po-batch-two');
    expect(commands.applyPurchaseOrderBatch).not.toHaveBeenCalled();
});
it('참조까지 손상이면 미처리 증거 없이 원문을 지우지 않는다', async () => {
    const key = purchaseBatchKey(scope());
    localStorage.setItem(key, 'broken');
    localStorage.setItem(key + ':reference', 'broken');
    const entry = (await writes.read(scope()))!;
    await expect(writes.discard(scope(), entry)).rejects.toThrow('참조');
    expect(localStorage.getItem(key)).toBe('broken');
    expect(commands.inspectPurchaseOrderBatch).not.toHaveBeenCalled();
});
it('유효 body A와 ref B 충돌은 어느 명령이나 정리로도 유실시키지 않는다', async () => {
    const entry = await writes.prepare(scope(), request()), ref = await commands.purchaseOrderBatchReference(request('po-batch-two'));
    localStorage.setItem(entry.key + ':reference', JSON.stringify({ version: 1, reference: ref }));
    const conflict = (await writes.read(scope()))!;
    expect(conflict.conflicting).toBe(true);
    for (const mode of ['apply', 'inspect', 'cancel'] as const)
        await expect(writes.command(scope(), conflict, mode)).rejects.toThrow('서로 다른');
    await expect(writes.discard(scope(), conflict)).rejects.toThrow('서로 다른');
    expect(localStorage.getItem(entry.key)).toBe(entry.bodyRaw);
});
it('CAS사본이 바뀌면 oldentry로 송신·중단·정리0', async () => {
    const entry = await writes.prepare(scope(), request());
    localStorage.setItem(entry.key + ':reference', 'replacement');
    for (const mode of ['apply', 'inspect', 'cancel'] as const)
        await expect(writes.command(scope(), entry, mode)).rejects.toThrow('바뀌');
    await expect(writes.discard(scope(), entry)).rejects.toThrow('바뀌');
    expect(localStorage.getItem(entry.key + ':reference')).toBe('replacement');
});
it('notfound 사본은 미처리로 단정해 정리하지 않는다', async () => {
    const entry = await writes.prepare(scope(), request());
    vi.mocked(commands.inspectPurchaseOrderBatch).mockResolvedValue(await result('not-found'));
    await expect(writes.discard(scope(), entry)).rejects.toThrow('확정');
    expect(await writes.read(scope())).toEqual(entry);
});
it('자기메타 callback은 정확한 before→after를 전달한다', async () => {
    const entry = await writes.prepare(scope(), request()), own = vi.fn();
    vi.mocked(commands.applyPurchaseOrderBatch).mockRejectedValue(Error('네트워크'));
    await expect(writes.command(scope(), entry, 'apply', own)).rejects.toThrow('네트워크');
    expect(own).toHaveBeenCalledWith(expect.objectContaining({ lastAttempt: '네트워크' }), entry);
});
it('RPC원인과메타quota를함께보존하고양사본은변경0', async () => {
    const entry = await writes.prepare(scope(), request());
    vi.mocked(commands.applyPurchaseOrderBatch).mockRejectedValue(Error('원RPC'));
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('quota'); });
    await expect(writes.command(scope(), entry, 'apply')).rejects.toThrow('원RPC 오류 기록 보관에도 실패');
    spy.mockRestore();
    expect(await writes.read(scope())).toEqual(entry);
});
it('UID회사/현재실행 변경시 old원문 송신0', async () => {
    const entry = await writes.prepare(scope(), request());
    Object.assign(auth, { currentUser: { uid: 'v' } });
    await expect(writes.command(scope(), entry, 'apply')).rejects.toThrow('계정');
    Object.assign(auth, { currentUser: { uid: 'u' } });
    await expect(writes.command({ ...scope(), isCurrent: () => false }, entry, 'cancel')).rejects.toThrow('계정');
    expect(commands.applyPurchaseOrderBatch).not.toHaveBeenCalled();
});
it('readonlyapplied는 현재 본문 저장이나 현재 PO 존재를 재검하지 않는다', async () => {
    const entry = await writes.prepare(scope(), request());
    vi.mocked(commands.inspectPurchaseOrderBatch).mockResolvedValue(await result());
    const observed = await writes.command(scope(), entry, 'inspect');
    expect(observed.entry).toEqual(entry);
    expect(await writes.read(scope())).toEqual(entry);
    expect(commands.applyPurchaseOrderBatch).not.toHaveBeenCalled();
});
it('remove가no-op이면정리성공callback0·기존사본유지', async () => {
    const entry = await writes.prepare(scope(), request()), own = vi.fn();
    vi.mocked(commands.inspectPurchaseOrderBatch).mockResolvedValue(await result('cancelled'));
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { });
    await expect(writes.discard(scope(), entry, own)).rejects.toThrow('정리를 확인');
    spy.mockRestore();
    expect(own).not.toHaveBeenCalled();
    expect(await writes.read(scope())).toEqual(entry);
});
it('조회ACK전다른사본교체면old정리0·교체보존', async () => {
    const entry = await writes.prepare(scope(), request());
    vi.mocked(commands.inspectPurchaseOrderBatch).mockImplementation(async () => { localStorage.setItem(entry.key + ':reference', 'new-copy'); return result('cancelled'); });
    await expect(writes.discard(scope(), entry)).rejects.toThrow('바뀌');
    expect(localStorage.getItem(entry.key + ':reference')).toBe('new-copy');
});
it('command 전달객체 request위조는 저장된원문으로만실행한다', async () => {
    const entry = await writes.prepare(scope(), request());
    vi.mocked(commands.applyPurchaseOrderBatch).mockResolvedValue(await result());
    await writes.command(scope(), { ...entry, request: request('po-batch-fake') }, 'apply');
    expect(vi.mocked(commands.applyPurchaseOrderBatch).mock.calls[0][1]).toEqual(request());
});
it('첫키삭제직후비협력B교체가있으면새참조를지우지않는다', async () => {
    const entry = await writes.prepare(scope(), request()), bRequest = request('po-batch-other'), bReference = await commands.purchaseOrderBatchReference(bRequest);
    const body = JSON.stringify({ version: 1, request: bRequest }), ref = JSON.stringify({ version: 1, reference: bReference });
    vi.mocked(commands.inspectPurchaseOrderBatch).mockResolvedValue(await result('cancelled'));
    const remove = Storage.prototype.removeItem;
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) { remove.call(this, key); if (key === entry.key) {
        this.setItem(entry.key, body);
        this.setItem(entry.key + ':reference', ref);
    } });
    await expect(writes.discard(scope(), entry)).rejects.toThrow();
    spy.mockRestore();
    expect(localStorage.getItem(entry.key)).toBe(body);
    expect(localStorage.getItem(entry.key + ':reference')).toBe(ref);
});
