import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ calls: [] as Array<{ name: string; clauses: Array<{ field: string; op: string; value: unknown }> }> }));
vi.mock('../firebase', () => ({ db: {}, auth: { currentUser: null }, authReady: Promise.resolve(), functions: undefined }));
vi.mock('firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  collection: (_db: unknown, name: string) => name,
  documentId: () => '__name__',
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  query: (name: string, ...clauses: typeof state.calls[number]['clauses']) => ({ name, clauses }),
  getDocs: async (query: typeof state.calls[number]) => {
    state.calls.push(query);
    const ids = query.clauses.find(clause => clause.field === '__name__')?.value as string[];
    return { docs: ids.map(id => ({ id, data: () => ({ value: id }) })) };
  },
}));
import { fetchByIds } from './firebaseService';
beforeEach(() => { state.calls = []; });
it('빈 입력은 조회하지 않는다', async () => {
  expect(await fetchByIds('issuedStatements', ['', ''], 'punghoe')).toEqual([]);
  expect(state.calls).toEqual([]);
});
it('중복 ID를 제거하고 30개씩 조회하며 모든 질의에 회사 조건을 넣는다', async () => {
  const ids = Array.from({ length: 31 }, (_, i) => `statement-${i}`);
  const result = await fetchByIds('issuedStatements', [...ids, ids[0]], 'punghoe');
  expect(state.calls).toHaveLength(2);
  expect(state.calls.map(call => call.clauses[0].value)).toEqual([ids.slice(0, 30), ids.slice(30)]);
  for (const call of state.calls) expect(call.clauses).toContainEqual({ field: 'companyId', op: '==', value: 'punghoe' });
  expect(result).toEqual(ids.map(id => ({ id, value: id })));
});
it('회사 인수가 없는 기존 호출은 문서 ID 조회를 유지한다', async () => {
  expect(await fetchByIds('orders', ['one'])).toEqual([{ id: 'one', value: 'one' }]);
  expect(state.calls[0].clauses).toEqual([{ field: '__name__', op: 'in', value: ['one'] }]);
});
