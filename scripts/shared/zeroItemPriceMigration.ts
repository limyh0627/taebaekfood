import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { isDeepStrictEqual } from 'node:util';

export type Version = { seconds: number; nanoseconds: number };
export type Document = { id: string; data: Record<string, unknown>; version: Version };
export type Plan = { version: 1; companyId: 'taebaek' | 'punghoe'; documents: { id: string; before: Record<string, unknown>; after: Record<string, unknown>; version: Version }[] };
export type Applied = { version: 1; planHash: string; documents: { id: string; version: Version }[] };

export function prepareZeroItemPrice(companyId: Plan['companyId'], documents: Document[]): Plan {
  if (!['taebaek', 'punghoe'].includes(companyId)) throw Error('회사 지정이 필요합니다.');
  const seen = new Set<string>();
  const selected: Plan['documents'] = [];
  for (const row of documents) {
    if (!row.id || seen.has(row.id)) throw Error('중복 품목 ID');
    seen.add(row.id);
    if ((row.data.companyId ?? 'taebaek') !== companyId) continue;
    if (!Object.hasOwn(row.data, 'price') || !Object.is(row.data.price, 0)) continue;
    const { price: _price, ...after } = row.data;
    selected.push({ id: row.id, before: row.data, after, version: row.version });
  }
  if (selected.length > 450) throw Error('단일 거래 한도를 넘습니다. 범위 재검토가 필요합니다.');
  return { version: 1, companyId, documents: selected.sort((a, b) => a.id.localeCompare(b.id)) };
}

export function checkPlan(plan: Plan): void {
  if (plan.version !== 1 || !['taebaek', 'punghoe'].includes(plan.companyId)) throw Error('잘못된 계획');
  const rebuilt = prepareZeroItemPrice(plan.companyId, plan.documents.map(row => ({ id: row.id, data: row.before, version: row.version })));
  if (!isDeepStrictEqual(rebuilt, plan)) throw Error('계획 원문/삭제 범위가 변경됐습니다.');
}

/** 모든 읽기/검증을 끝낸 뒤에만 호출자가 price 필드 한 개를 update한다. */
export function checkMigrationState(plan: Plan, current: Document[], mode: 'apply' | 'undo' | 'duplicate' | 'undone', receipt?: Applied, planHash?: string): void {
  checkPlan(plan);
  if (current.length !== plan.documents.length || new Set(current.map(row => row.id)).size !== current.length) throw Error('문서 집합 변경');
  if (mode !== 'apply' && (!receipt || receipt.version !== 1 || receipt.planHash !== planHash || receipt.documents.length !== current.length || new Set(receipt.documents.map(row => row.id)).size !== current.length)) throw Error('적용 확인 원문이 필요합니다.');
  for (const row of plan.documents) {
    const now = current.find(doc => doc.id === row.id);
    const expectedVersion = mode === 'apply' ? row.version : receipt!.documents.find(doc => doc.id === row.id)?.version;
    if (!now || !expectedVersion || !isDeepStrictEqual(now.version, expectedVersion) || !isDeepStrictEqual(now.data, mode === 'apply' || mode === 'undone' ? row.before : row.after)) throw Error('품목 원문/나노초 버전 변경');
  }
}

/** WriteResult.writeTime만 적용 증명으로 사용한다. 사후 조회 버전을 채택하지 않는다. */
export async function commitZeroItemPrice(db: Firestore, plan: Plan, current: Document[], mode: 'apply' | 'undo', planHash: string, receipt?: Applied): Promise<Applied> {
  checkMigrationState(plan, current, mode, receipt, planHash);
  if (!plan.documents.length) return { version: 1, planHash, documents: [] };
  const batch = db.batch();
  for (const row of plan.documents) {
    const v = mode === 'apply' ? row.version : receipt!.documents.find(doc => doc.id === row.id)!.version;
    batch.update(db.collection('items').doc(row.id), { price: mode === 'apply' ? FieldValue.delete() : 0 },
      { lastUpdateTime: new Timestamp(v.seconds, v.nanoseconds) });
  }
  const results = await batch.commit();
  if (results.length !== plan.documents.length) throw Error('적용 결과 버전 수 불일치. 재적용 금지');
  return { version: 1, planHash, documents: results.map((result, index) => ({ id: plan.documents[index].id,
    version: { seconds: result.writeTime.seconds, nanoseconds: result.writeTime.nanoseconds } })) };
}
