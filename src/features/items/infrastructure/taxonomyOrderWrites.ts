import { doc, runTransaction } from 'firebase/firestore';
import type { DocumentData, DocumentSnapshot } from 'firebase/firestore';
import { auth, authReady, db } from '../../../shared/firebase';
import { withClaimCompany } from '../../../shared/companyWriteBoundary';
import { buildTaxonomy, CATEGORY_KEYS, DEFAULT_CATEGORY_LABELS, type TaxonomyRow } from '../../../shared/taxonomy';
import type { CompanyId } from '../../../shared/types';

type NewType = { kind: 'type'; key: string; label: string; order: number; companyId: CompanyId };
export type TaxonomyOrderWrite =
  | { kind: 'update'; id: string; order: number }
  | { kind: 'create'; id: string; data: NewType };
export type TaxonomyOrderAckRow = { id: string; order: number } | (NewType & { id: string });
export interface TaxonomyOrderPlan {
  companyId: CompanyId;
  operations: TaxonomyOrderWrite[];
  ackRows: TaxonomyOrderAckRow[];
}
export interface TaxonomyOrderContext {
  actorUid: string;
  companyId: CompanyId;
  isCurrent: () => boolean;
}
export class TaxonomyOrderNotStartedError extends Error {}
export const isTaxonomyOrderNotStarted = (error: unknown): error is TaxonomyOrderNotStartedError =>
  error instanceof TaxonomyOrderNotStartedError;

export function taxonomyTypeId(companyId: CompanyId, key: string): string {
  if (!CATEGORY_KEYS.includes(key as typeof CATEGORY_KEYS[number])) {
    throw new TaxonomyOrderNotStartedError('분류 타입을 확인할 수 없습니다.');
  }
  return `type-${companyId}-${key}`;
}

function planOf(companyId: CompanyId, operations: TaxonomyOrderWrite[]): TaxonomyOrderPlan {
  return { companyId, operations, ackRows: operations.map(op => op.kind === 'update'
    ? { id: op.id, order: op.order } : { id: op.id, ...op.data }) };
}

export function prepareTaxonomyTypeOrder(
  rows: TaxonomyRow[], key: string, direction: -1 | 1, companyId: CompanyId,
): TaxonomyOrderPlan | null {
  const taxonomy = buildTaxonomy(rows);
  const keys = taxonomy.allTypes.map(row => row.key);
  const from = keys.indexOf(key), to = from + direction;
  if (from < 0 || to < 0 || to >= keys.length) return null;
  [keys[from], keys[to]] = [keys[to], keys[from]];
  return planOf(companyId, keys.map((typeKey, order) => {
    // 옛 category 타입과 임시 이름 행도 기존 화면과 같은 방식으로 해석한다.
    const row = rows.find(value => (value.kind === 'type'
      || (value.kind === 'category' && value.key && !value.parent)) && value.key === typeKey);
    if (row && !row.id.startsWith('tmp-')) return { kind: 'update', id: row.id, order };
    return { kind: 'create', id: taxonomyTypeId(companyId, typeKey), data: {
      kind: 'type', key: typeKey, label: taxonomy.labelOf(typeKey), order, companyId,
    } };
  }));
}

export function prepareTaxonomyRowOrder(
  rows: TaxonomyRow[], rowId: string, direction: -1 | 1,
  kind: 'category' | 'subtype', parent: string, companyId: CompanyId,
): TaxonomyOrderPlan | null {
  const ordered = rows.filter(row => row.kind === kind && row.parent === parent)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const from = ordered.findIndex(row => row.id === rowId), to = from + direction;
  if (from < 0 || to < 0 || to >= ordered.length) return null;
  [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
  return planOf(companyId, ordered.map((row, order) => ({ kind: 'update', id: row.id, order })));
}

function validate(plan: TaxonomyOrderPlan, context: TaxonomyOrderContext): void {
  if (plan.companyId !== context.companyId) throw new Error('현재 회사와 다른 분류 순서는 저장할 수 없습니다.');
  if (plan.operations.length > 500) throw new Error('분류가 500개를 넘어 순서를 저장하지 않았습니다.');
  const ids = new Set<string>();
  for (const operation of plan.operations) {
    if (!operation.id || operation.id.includes('/') || ids.has(operation.id)) {
      throw new Error('분류 문서 번호가 올바르지 않아 순서를 저장하지 않았습니다.');
    }
    ids.add(operation.id);
    const order = operation.kind === 'update' ? operation.order : operation.data.order;
    if (!Number.isInteger(order) || order < 0) throw new Error('분류 순서가 올바르지 않습니다.');
    if (operation.kind === 'create') withClaimCompany('itemTaxonomy', operation.data, { companyId: context.companyId });
  }
}

async function authorize(context: TaxonomyOrderContext): Promise<() => void> {
  const assertCurrent = () => {
    if (!context.isCurrent() || !context.actorUid || auth.currentUser?.uid !== context.actorUid) {
      throw new TaxonomyOrderNotStartedError('로그인 또는 회사가 바뀌어 저장하지 않았습니다. 다시 열어 주세요.');
    }
  };
  try {
    assertCurrent();
    await authReady;
    assertCurrent();
    const token = await auth.currentUser!.getIdTokenResult();
    assertCurrent();
    withClaimCompany('itemTaxonomy', { companyId: context.companyId }, { companyId: token.claims.companyId });
    return assertCurrent;
  } catch (error) {
    throw new TaxonomyOrderNotStartedError(error instanceof Error ? error.message : '로그인을 확인해 주세요.');
  }
}

function existingRow(id: string, data: Record<string, unknown>, companyId: CompanyId, key?: string): TaxonomyRow {
  if (data.companyId !== companyId) throw new TaxonomyOrderNotStartedError('분류의 소속 회사가 현재 회사와 달라 저장하지 않았습니다.');
  if (key && !((data.kind === 'type' || (data.kind === 'category' && !data.parent)) && data.key === key)) {
    throw new TaxonomyOrderNotStartedError('기본 타입 문서가 다른 분류를 가리켜 저장하지 않았습니다.');
  }
  return { ...data, id } as unknown as TaxonomyRow;
}

export async function commitTaxonomyOrder(plan: TaxonomyOrderPlan, context: TaxonomyOrderContext): Promise<TaxonomyRow[]> {
  try { validate(plan, context); }
  catch (error) { throw new TaxonomyOrderNotStartedError(error instanceof Error ? error.message : '분류 순서를 확인해 주세요.'); }
  const assertCurrent = await authorize(context);
  assertCurrent();
  return runTransaction(db, async transaction => {
    await authorize(context);
    assertCurrent();
    const snapshots: DocumentSnapshot<DocumentData>[] = [];
    for (const operation of plan.operations) snapshots.push(await transaction.get(doc(db, 'itemTaxonomy', operation.id)));
    const result = plan.operations.map((operation, index) => {
      const snapshot = snapshots[index];
      if (snapshot.exists()) {
        const row = existingRow(operation.id, snapshot.data(), context.companyId,
          operation.kind === 'create' ? operation.data.key : undefined);
        return { ...row, order: operation.kind === 'update' ? operation.order : operation.data.order };
      }
      if (operation.kind === 'update') throw new TaxonomyOrderNotStartedError('분류가 삭제되어 순서를 저장하지 않았습니다. 목록을 다시 조회해 주세요.');
      return { id: operation.id, ...operation.data };
    });
    await authorize(context);
    assertCurrent();
    for (const [index, operation] of plan.operations.entries()) {
      const reference = doc(db, 'itemTaxonomy', operation.id);
      if (snapshots[index].exists()) transaction.update(reference, { order: result[index].order });
      else transaction.set(reference, operation.kind === 'create' ? operation.data : {});
    }
    return result;
  });
}

export interface TaxonomyTypeChange {
  companyId: CompanyId;
  key: string;
  mode: 'seed' | 'rename' | 'hide';
  label?: string;
  hidden?: boolean;
}
export async function commitTaxonomyType(change: TaxonomyTypeChange, context: TaxonomyOrderContext): Promise<TaxonomyRow> {
  if (change.companyId !== context.companyId) throw new TaxonomyOrderNotStartedError('현재 회사가 바뀌어 저장하지 않았습니다.');
  const id = taxonomyTypeId(change.companyId, change.key);
  const assertCurrent = await authorize(context);
  assertCurrent();
  return runTransaction(db, async transaction => {
    await authorize(context);
    assertCurrent();
    const reference = doc(db, 'itemTaxonomy', id);
    const snapshot = await transaction.get(reference);
    const row: TaxonomyRow = snapshot.exists()
      ? existingRow(id, snapshot.data(), context.companyId, change.key)
      : { id, kind: 'type', key: change.key, label: DEFAULT_CATEGORY_LABELS[change.key], order: CATEGORY_KEYS.indexOf(change.key as typeof CATEGORY_KEYS[number]) };
    const patch = change.mode === 'rename' ? { label: change.label ?? '' }
      : change.mode === 'hide' ? { hidden: change.hidden === true } : {};
    await authorize(context);
    assertCurrent();
    if (snapshot.exists()) {
      if (change.mode !== 'seed') transaction.update(reference, patch);
    } else {
      const { id: _id, ...data } = { ...row, ...patch };
      transaction.set(reference, withClaimCompany('itemTaxonomy', data, { companyId: context.companyId }));
    }
    return { ...row, ...patch };
  });
}



