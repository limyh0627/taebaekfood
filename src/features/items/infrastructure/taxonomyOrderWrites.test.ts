import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaxonomyRow } from '../../../shared/taxonomy';
const state = vi.hoisted(() => ({ uid: 'u', company: 'taebaek', current: true,
  update: vi.fn(), set: vi.fn(), commit: vi.fn(), batch: vi.fn(), token: vi.fn(), get: vi.fn() }));
vi.mock('../../../shared/firebase', () => ({ db: {}, authReady: Promise.resolve(), auth: {
  get currentUser() { return { uid: state.uid, getIdTokenResult: state.token }; },
} }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  runTransaction: async (_db: unknown, callback: (tx: unknown) => Promise<unknown>) => { state.batch(); const result = await callback({ get: state.get, update: state.update, set: state.set }); await state.commit(); return result; } }));
import { commitTaxonomyOrder, isTaxonomyOrderNotStarted, prepareTaxonomyRowOrder,
  prepareTaxonomyTypeOrder, type TaxonomyOrderPlan } from './taxonomyOrderWrites';
const context = () => ({ actorUid: 'u', companyId: 'taebaek' as const, isCurrent: () => state.current });
const rows: TaxonomyRow[] = [{ id: 'a', kind: 'category', parent: 'product', label: '가', order: 0 },
  { id: 'b', kind: 'category', parent: 'product', label: '나', order: 1 }];
describe('분류 순서 원자 배치', () => {
  beforeEach(() => {
    vi.clearAllMocks(); state.uid = 'u'; state.company = 'taebaek'; state.current = true;
    state.token.mockResolvedValue({ claims: { companyId: state.company, employeeId: 'e' } });
    state.commit.mockResolvedValue(undefined);
    state.get.mockImplementation(async (ref: {id:string}) => ({ exists: () => ['a','b','legacy'].includes(ref.id), data: () => ({ companyId: 'taebaek', kind:'category', key:'product', label:'실제 이름', hidden:true }) }));
  });
  it('같은 부모의 기존 정렬만 바꾸며 ACK에는 이름 초안을 포함하지 않는다', async () => {
    const plan = prepareTaxonomyRowOrder([...rows, { ...rows[0], id: 'other', parent: 'raw' }], 'a', 1, 'category', 'product', 'taebaek')!;
    expect(plan.ackRows).toEqual([{ id: 'b', order: 0 }, { id: 'a', order: 1 }]);
    await commitTaxonomyOrder(plan, context());
    expect(state.batch).toHaveBeenCalledTimes(1); expect(state.commit).toHaveBeenCalledTimes(1);
    expect(state.update.mock.calls.map(call => call[1])).toEqual([{ order: 0 }, { order: 1 }]);
    expect(state.set).not.toHaveBeenCalled();
    expect(prepareTaxonomyRowOrder(rows, 'a', -1, 'category', 'product', 'taebaek')).toBeNull();
  });
  it('옛 category 타입은 update하고 임시 타입은 준비 시 고정된 ID와 이름으로 생성한다', async () => {
    const plan = prepareTaxonomyTypeOrder([
      { id: 'legacy', kind: 'category', key: 'product', label: '옛 이름', hidden: true, order: 0 },
      { id: 'tmp-goods', kind: 'type', key: 'goods', label: '새 이름', order: 1 },
    ], 'product', 1, 'taebaek')!;
    const serialized = JSON.stringify(plan);
    await commitTaxonomyOrder(plan, context());
    expect(JSON.stringify(plan)).toBe(serialized);
    expect(state.update).toHaveBeenCalledWith({ collection: 'itemTaxonomy', id: 'legacy' }, { order: 1 });
    expect(state.set.mock.calls[0][1]).toEqual({ kind: 'type', key: 'goods', label: '새 이름', order: 0, companyId: 'taebaek' });
    expect(plan.operations).toHaveLength(6);
  });
  it('500개 초과는 batch 생성이나 송신 없이 명확히 거절한다', async () => {
    const plan: TaxonomyOrderPlan = { companyId: 'taebaek', ackRows: [], operations: Array.from({ length: 501 }, (_, n) => ({ kind: 'update', id: `x${n}`, order: n })) };
    const error = await commitTaxonomyOrder(plan, context()).catch(error => error);
    expect(isTaxonomyOrderNotStarted(error)).toBe(true); expect(error.message).toContain('500');
    expect(state.batch).not.toHaveBeenCalled(); expect(state.commit).not.toHaveBeenCalled();
  });
  it('토큰 대기 중 UID와 회사 수명이 바뀌면 후속 송신하지 않는다', async () => {
    state.token.mockImplementation(async () => { state.uid = 'new'; return { claims: { companyId: 'taebaek' } }; });
    const error = await commitTaxonomyOrder(prepareTaxonomyRowOrder(rows, 'a', 1, 'category', 'product', 'taebaek')!, context()).catch(error => error);
    expect(isTaxonomyOrderNotStarted(error)).toBe(true); expect(state.commit).not.toHaveBeenCalled();
  });
  it('다른 회사 claim은 송신하지 않고 실제 commit 오류는 미송신으로 오분류하지 않는다', async () => {
    const plan = prepareTaxonomyRowOrder(rows, 'a', 1, 'category', 'product', 'taebaek')!;
    state.token.mockResolvedValueOnce({ claims: { companyId: 'punghoe' } });
    expect(isTaxonomyOrderNotStarted(await commitTaxonomyOrder(plan, context()).catch(error => error))).toBe(true);
    expect(state.commit).not.toHaveBeenCalled();
    const failure = new Error('응답 유실'); state.commit.mockRejectedValueOnce(failure);
    expect(await commitTaxonomyOrder(plan, context()).catch(error => error)).toBe(failure);
    expect(isTaxonomyOrderNotStarted(failure)).toBe(false);
  });
  it('같은 UID도 실제 문서 조회 중 회사 claim이 바뀌면 쓰기 전에 멈춘다', async () => {
    state.token.mockResolvedValueOnce({ claims: { companyId: 'taebaek' } })
      .mockResolvedValueOnce({ claims: { companyId: 'taebaek' } })
      .mockResolvedValue({ claims: { companyId: 'punghoe' } });
    const error = await commitTaxonomyOrder(prepareTaxonomyRowOrder(rows, 'a', 1, 'category', 'product', 'taebaek')!, context()).catch(error => error);
    expect(isTaxonomyOrderNotStarted(error)).toBe(true);
    expect(state.update).not.toHaveBeenCalled(); expect(state.commit).not.toHaveBeenCalled();
  });
});

