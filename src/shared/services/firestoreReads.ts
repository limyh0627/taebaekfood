import { collection, query, where, getDocs, documentId, onSnapshot, type QuerySnapshot, type DocumentData } from 'firebase/firestore';
import { db } from '../firebase';
import type { CollectionName } from '../collections';
import type { CompanyId } from '../types';

/** 한 필드가 어떤 값인 문서만. 컬렉션 전체를 읽어 거르는 것보다 싸다. */
export const fetchWhere = async <T extends { id: string }>(
  collectionName: CollectionName,
  field: string,
  value: unknown,
): Promise<T[]> => {
  const snap = await getDocs(query(collection(db, collectionName), where(field, '==', value)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as T));
};

/** 한 필드가 주어진 값들 중 하나인 문서. Firestore의 in 한도에 맞춰 30개씩 나눠 읽는다. */
export const fetchWhereIn = async <T extends { id: string }>(
  collectionName: CollectionName,
  field: string,
  values: readonly unknown[],
  companyId: CompanyId,
): Promise<T[]> => {
  const uniq = [...new Set(values)];
  if (uniq.length === 0) return [];
  const rows = new Map<string, T>();
  for (let i = 0; i < uniq.length; i += 30) {
    const snap = await getDocs(query(collection(db, collectionName), where('companyId', '==', companyId), where(field, 'in', uniq.slice(i, i + 30))));
    for (const d of snap.docs) rows.set(d.id, { id: d.id, ...d.data() } as T);
  }
  return [...rows.values()];
};

/** 한 필드가 어떤 값인 문서를 계속 지켜본다. 해지 함수를 돌려준다. */
/**
 * **id로 콕 집어 온다** — 앵커가 짚어 준 미결 전표처럼 몇 장만 필요할 때.
 *
 * Firestore `in`은 한 번에 30개까지라 30개씩 끊어 던진다. 없는 id는 그냥 안 온다.
 * 날짜 범위로 훑는 것과 달리 **읽는 양이 요청한 개수만큼**이라, 앵커가 값을 하는 자리다.
 */
export const fetchByIds = async <T extends { id: string }>(
  collectionName: CollectionName,
  ids: string[],
  companyId?: CompanyId,
): Promise<T[]> => {
  const uniq = [...new Set(ids.filter(Boolean))];
  const out: T[] = [];
  for (let i = 0; i < uniq.length; i += 30) {
    const snap = await getDocs(query(collection(db, collectionName), where(documentId(), 'in', uniq.slice(i, i + 30)), ...(companyId ? [where('companyId', '==', companyId)] : [])));
    for (const d of snap.docs) out.push({ id: d.id, ...d.data() } as T);
  }
  return out;
};

export const subscribeWhere = <T extends { id: string }>(
  collectionName: CollectionName,
  field: string,
  value: unknown,
  cb: (_rows: T[]) => void,
): (() => void) =>
  onSnapshot(
    query(collection(db, collectionName), where(field, '==', value)),
    (snap: QuerySnapshot<DocumentData>) => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as T))),
    () => cb([]),
  );
