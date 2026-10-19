import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const state = vi.hoisted(() => ({ db: null as unknown, uid: 'taxonomy-user' }));
vi.mock('../../../shared/firebase', () => ({ get db() { return state.db; }, authReady: Promise.resolve(),
  auth: { get currentUser() { return { uid: state.uid, getIdTokenResult: async () => ({
    claims: { companyId: 'taebaek', employeeId: 'taxonomy-employee', isAdmin: true },
  }) }; } } }));
import { commitTaxonomyOrder, commitTaxonomyType, taxonomyTypeId, prepareTaxonomyTypeOrder, type TaxonomyOrderPlan } from './taxonomyOrderWrites';
const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8182';
describe.skipIf(!enabled)('분류 순서 실제 Rules 원자 배치', () => {
  const projectId = `demo-taxonomy-${randomUUID().slice(0, 8)}`;
  const prefix = randomUUID();
  const touched = new Set<string>();
  let env: RulesTestEnvironment;
  const context = { actorUid: state.uid, companyId: 'taebaek' as const, isCurrent: () => true };
  const seed = async (id: string, data: Record<string, unknown>) => {
    touched.add(id);
    await env.withSecurityRulesDisabled(async c => setDoc(doc(c.firestore(), 'itemTaxonomy', id), data));
  };
  const read = async (id: string) => {
    let result: Record<string, unknown> | undefined;
    await env.withSecurityRulesDisabled(async c => { result = (await getDoc(doc(c.firestore(), 'itemTaxonomy', id))).data(); });
    return result;
  };
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8182,
      rules: readFileSync('firestore.rules', 'utf8') } });
    state.db = env.authenticatedContext(state.uid, { companyId: 'taebaek', employeeId: 'taxonomy-employee', isAdmin: true }).firestore();
  });
  afterAll(async () => {
    if (!env) return;
    await env.withSecurityRulesDisabled(async c => {
      for (const id of touched) await deleteDoc(doc(c.firestore(), 'itemTaxonomy', id));
    });
    await env.cleanup();
  });
  it('다른 회사인 둘째 문서가 거절되면 첫 문서의 순서도 전혀 바뀌지 않는다', async () => {
    const a = `${prefix}-atomic-a`, b = `${prefix}-atomic-b`;
    await seed(a, { companyId: 'taebaek', label: '가', order: 0 });
    await seed(b, { companyId: 'punghoe', label: '나', order: 1 });
    const plan: TaxonomyOrderPlan = { companyId: 'taebaek', ackRows: [], operations: [
      { kind: 'update', id: a, order: 1 }, { kind: 'update', id: b, order: 0 },
    ] };
    await expect(commitTaxonomyOrder(plan, context)).rejects.toThrow();
    expect(await read(a)).toMatchObject({ order: 0 });
    expect(await read(b)).toMatchObject({ order: 1 });
  });
  it('정상 교환은 두 순서만 바꾸고 이름·숨김·미지 필드를 유지한다', async () => {
    const a = `${prefix}-normal-a`, b = `${prefix}-normal-b`;
    const beforeA = { companyId: 'taebaek', label: '원래 이름', hidden: true, legacy: { value: 7 }, order: 0 };
    await seed(a, beforeA); await seed(b, { companyId: 'taebaek', label: '나', order: 1 });
    await commitTaxonomyOrder({ companyId: 'taebaek', ackRows: [], operations: [
      { kind: 'update', id: a, order: 1 }, { kind: 'update', id: b, order: 0 },
    ] }, context);
    expect(await read(a)).toEqual({ ...beforeA, order: 1 });
    expect(await read(b)).toMatchObject({ order: 0 });
  });
  it('누락 타입 생성 ID와 내용은 준비 시 고정되고 기존 타입의 숨김은 보존한다', async () => {
    const id = `${prefix}-legacy-type`;
    await seed(id, { companyId: 'taebaek', kind: 'category', key: 'product', label: '제품', hidden: true, order: 0 });
    const plan = prepareTaxonomyTypeOrder([{ id, kind: 'category', key: 'product', label: '제품', hidden: true, order: 0 }], 'product', 1, 'taebaek')!;
    for (const operation of plan.operations) touched.add(operation.id);
    await commitTaxonomyOrder(plan, context);
    for (const operation of plan.operations) {
      if (operation.kind === 'create') expect(await read(operation.id)).toEqual(operation.data);
    }
    expect(await read(id)).toMatchObject({ order: 1, hidden: true, label: '제품' });
  });
  it('동시에 준비한 누락 타입 계획은 같은 문서만 만들고 기존 이름·숨김을 ACK로 보존한다', async () => {
    const first = prepareTaxonomyTypeOrder([], 'product', 1, 'taebaek')!;
    const second = prepareTaxonomyTypeOrder([], 'goods', 1, 'taebaek')!;
    expect(first.operations.map(op => op.id).sort()).toEqual(second.operations.map(op => op.id).sort());
    for (const operation of first.operations) touched.add(operation.id);
    for (const operation of second.operations) touched.add(operation.id);
    await env.withSecurityRulesDisabled(async c => {
      for (const operation of first.operations) await deleteDoc(doc(c.firestore(), 'itemTaxonomy', operation.id));
    });
    const id = taxonomyTypeId('taebaek', 'product');
    await seed(id, { companyId: 'taebaek', kind: 'type', key: 'product', label: '서버 이름', hidden: true, order: 0 });
    const acknowledgements = await Promise.all([commitTaxonomyOrder(first, context), commitTaxonomyOrder(second, context)]);
    for (const ack of acknowledgements) expect(ack.find(row => row.id === id)).toMatchObject({ label: '서버 이름', hidden: true });
    expect(await read(id)).toMatchObject({ label: '서버 이름', hidden: true });
    expect(new Set([...first.operations, ...second.operations].map(op => op.id)).size).toBe(6);
    for (const operation of first.operations) expect(await read(operation.id)).toBeDefined();
  });
  it('seed·이름·숨김도 같은 결정 ID를 쓰고 각 소유 필드만 바꾼다', async () => {
    const id = taxonomyTypeId('taebaek', 'raw'); touched.add(id);
    await seed(id, { companyId: 'taebaek', kind: 'type', key: 'raw', label: '기존', hidden: true, order: 8, unknown: 7 });
    await commitTaxonomyType({ companyId: 'taebaek', key: 'raw', mode: 'seed' }, context);
    expect(await read(id)).toMatchObject({ label: '기존', hidden: true, order: 8, unknown: 7 });
    await commitTaxonomyType({ companyId: 'taebaek', key: 'raw', mode: 'rename', label: '새 이름' }, context);
    await commitTaxonomyType({ companyId: 'taebaek', key: 'raw', mode: 'hide', hidden: false }, context);
    expect(await read(id)).toMatchObject({ label: '새 이름', hidden: false, order: 8, unknown: 7 });
  });
});
