/**
 * @shared-move  shared/src/services/firebaseService.ts
 * Firebase CRUD 공통 서비스 — 직원 앱·관리자 앱 양쪽에서 동일하게 사용합니다.
 * Phase 2 분리 시 shared/ 로 이동하고 각 앱에서 import합니다.
 */
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
  query,
  where,
  getDocs,
  writeBatch,
  runTransaction,
  DocumentData,
  QuerySnapshot,
  QueryConstraint,
} from "firebase/firestore";
import { db } from "../firebase";
import type { RawMaterialLot } from "../types";
import { pruneDepletedLots } from "../lotUtils";

export const subscribeToDocument = <T>(
  collectionName: string,
  docId: string,
  callback: (data: T | null) => void
) => {
  return onSnapshot(doc(db, collectionName, docId), (snap) => {
    callback(snap.exists() ? (snap.data() as T) : null);
  });
};

export const setDocument = async (collectionName: string, docId: string, data: any) => {
  await setDoc(doc(db, collectionName, docId), data, { merge: true });
};

export const subscribeToCollection = <T extends { id: string }>(
  collectionName: string,
  callback: (data: T[]) => void,
  constraints: QueryConstraint[] = []
) => {
  const q = query(collection(db, collectionName), ...constraints);
  const cache = new Map<string, T>();

  return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    const changes = snapshot.docChanges();
    if (changes.length === 0) return;

    for (const change of changes) {
      if (change.type === 'added' || change.type === 'modified') {
        cache.set(change.doc.id, { id: change.doc.id, ...change.doc.data() } as T);
      } else if (change.type === 'removed') {
        cache.delete(change.doc.id);
      }
    }
    callback(Array.from(cache.values()));
  });
};

// 1회 읽기 (정적 데이터용)
export const fetchCollection = async <T extends { id: string }>(
  collectionName: string,
  constraints: QueryConstraint[] = []
): Promise<T[]> => {
  const q = query(collection(db, collectionName), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as T));
};

// 날짜 기준 과거 N일치 구독
export const subscribeToRecentCollection = <T extends { id: string }>(
  collectionName: string,
  dateField: string,
  daysBack: number,
  callback: (data: T[]) => void
) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  // dateField이 ISO string이면 toISOString(), YYYY-MM-DD면 slice
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return subscribeToCollection<T>(collectionName, callback, [where(dateField, '>=', cutoffStr)]);
};

// 특정 날짜 범위 one-time fetch (과거 데이터 온디맨드)
export const fetchDateRange = async <T extends { id: string }>(
  collectionName: string,
  dateField: string,
  startDate: string,
  endDate: string
): Promise<T[]> => {
  const q = query(
    collection(db, collectionName),
    where(dateField, '>=', startDate),
    where(dateField, '<=', endDate)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as T));
};

const stripUndefined = (obj: any): any => {
  if (Array.isArray(obj)) return obj.map(v => stripUndefined(v));
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)])
    );
  }
  return obj;
};

/**
 * items 컬렉션만 — 코드가 들고 있는 옛 필드 이름을 DB의 새 이름으로 되돌린다.
 *   코드:  category(=타입) · subtype(=카테고리) · subtype2(=서브타입)
 *   DB  :  type          · category           · subtype
 * 세 필드 중 하나라도 실려 있을 때만 변환한다(부분 갱신 — 예: {cost:123} 은 그대로 통과).
 */
const toItemDbFields = (collectionName: string, data: any) => {
  if (collectionName !== 'items' || !data || typeof data !== 'object') return data;
  const touches = ['category', 'subtype', 'subtype2'].some(k => k in data);
  if (!touches) return data;
  const { category, subtype, subtype2, ...rest } = data;
  return {
    ...rest,
    ...(category !== undefined ? { type: category } : {}),
    ...(subtype !== undefined ? { category: subtype } : {}),
    ...(subtype2 !== undefined ? { subtype: subtype2 } : {}),
  };
};

export const addItem = async (collectionName: string, item: any) => {
  const { id, ...raw } = toItemDbFields(collectionName, item);
  const data = stripUndefined(raw);
  if (id) {
    await setDoc(doc(db, collectionName, id), data);
    return id;
  } else {
    const docRef = await addDoc(collection(db, collectionName), data);
    return docRef.id;
  }
};

export const updateItem = async (collectionName: string, id: string, data: any) => {
  const docRef = doc(db, collectionName, id);
  // getFirestore는 ignoreUndefinedProperties가 꺼져 있어 undefined가 있으면 updateDoc이 throw한다.
  // (예: 전표 items[].accountCode가 빈 값이면 undefined로 들어와 저장이 통째로 실패) → 깊게 제거.
  await updateDoc(docRef, stripUndefined(toItemDbFields(collectionName, data)));
};

export const deleteItem = async (collectionName: string, id: string) => {
  const docRef = doc(db, collectionName, id);
  await deleteDoc(docRef);
};

/**
 * 원료(raw) 품목의 lots 배열을 트랜잭션으로 안전하게 수정한다.
 * 입고(로트 추가)·사용(차감)·순서변경(▲▼)이 동시에 일어나도 덮어쓰기 사고를 막는다.
 * @param rawItemId  원료 품목 문서 ID (예: 'raw-깨분참기름')
 * @param transform  현재 lots → 새 lots (순수 함수)
 * @param computeStock  새 lots → items.stock에 쓸 값(원료의 운영 단위). 미지정 시 stock은 그대로 둠.
 */
export const mutateRawMaterialLots = async (
  rawItemId: string,
  transform: (currentLots: RawMaterialLot[], currentStock: number) => RawMaterialLot[],
  computeStock?: (lots: RawMaterialLot[]) => number,
): Promise<RawMaterialLot[]> => {
  // Firestore는 undefined 필드를 거부 → 로트 배열에서 제거 (캔/수동 입고 로트의 미입력 옵션 필드 대비)
  const buildPatch = (next: RawMaterialLot[]): { lots: RawMaterialLot[]; stock?: number } => {
    const patch: { lots: RawMaterialLot[]; stock?: number } = { lots: stripUndefined(next) };
    if (computeStock) patch.stock = computeStock(next);
    return patch;
  };
  return await runTransaction(db, async (tx) => {
    const ref = doc(db, "items", rawItemId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`원료 품목을 찾을 수 없음: ${rawItemId}`);
    const data = snap.data();
    const current: RawMaterialLot[] = Array.isArray(data.lots) ? data.lots : [];
    // #1 로트 배열 무한 증가 방지 — 오래된 depleted 로트 정리(모든 로트 쓰기 경로가 이 함수를 지남)
    const next = pruneDepletedLots(transform(current, data.stock ?? 0));
    tx.update(ref, buildPatch(next));
    return next;
  });
};

export const subscribeToSubcollection = <T extends { id: string }>(
  parentCollection: string,
  parentId: string,
  subCollectionName: string,
  callback: (data: T[]) => void
) => {
  const q = query(collection(db, parentCollection, parentId, subCollectionName));
  return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    const items = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as T));
    callback(items);
  });
};

export const addSubItem = async (
  parentCollection: string,
  parentId: string,
  subCollectionName: string,
  item: any
) => {
  const { id, ...data } = item;
  if (id) {
    await setDoc(doc(db, parentCollection, parentId, subCollectionName, id), data);
    return id;
  } else {
    const docRef = await addDoc(collection(db, parentCollection, parentId, subCollectionName), data);
    return docRef.id;
  }
};

export const updateSubItem = async (
  parentCollection: string,
  parentId: string,
  subCollectionName: string,
  id: string,
  data: any
) => {
  const docRef = doc(db, parentCollection, parentId, subCollectionName, id);
  await updateDoc(docRef, data);
};

export const deleteSubItem = async (
  parentCollection: string,
  parentId: string,
  subCollectionName: string,
  id: string
) => {
  const docRef = doc(db, parentCollection, parentId, subCollectionName, id);
  await deleteDoc(docRef);
};

// partner_item 컬렉션에 품목-거래처(Direction='out') 매핑 저장 — 기존 box/tape 설정 보존
export const setProductClients = async (itemId: string, partnerIds: string[]) => {
  const { getDocs, query: q, collection: col, where } = await import('firebase/firestore');

  // 기존 레코드 조회 (Direction='out' 필터)
  const existing = await getDocs(q(col(db, 'partner_item'), where('itemId', '==', itemId), where('Direction', '==', 'out')));
  const existingMap = new Map(existing.docs.map(d => [(d.data().partnerId ?? d.data().partnerId) as string, d.ref]));

  const batch = writeBatch(db);

  // 연결 해제된 거래처 삭제
  existingMap.forEach((ref, partnerId) => {
    if (!partnerIds.includes(partnerId)) batch.delete(ref);
  });

  // 새로 연결된 거래처만 추가 (기존 레코드는 건드리지 않아 박스/테이프 설정 보존)
  for (const partnerId of partnerIds) {
    if (!existingMap.has(partnerId)) {
      const id = `${itemId}_${partnerId}_out`;
      const ref = doc(db, 'partner_item', id);
      batch.set(ref, { id, itemId, partnerId, Direction: 'out' });
    }
  }

  await batch.commit();
};

// partner_item 컬렉션에 품목-거래처(Direction='in') 매핑 저장
export const setProductSuppliers = async (itemId: string, inboundPartnerIds: string[]) => {
  const { getDocs, query: q, collection: col, where } = await import('firebase/firestore');

  const existing = await getDocs(q(col(db, 'partner_item'), where('itemId', '==', itemId), where('Direction', '==', 'in')));
  const existingMap = new Map(existing.docs.map(d => [(d.data().partnerId ?? d.data().partnerId) as string, d.ref]));

  const batch = writeBatch(db);

  existingMap.forEach((ref, partnerId) => {
    if (!inboundPartnerIds.includes(partnerId)) batch.delete(ref);
  });

  for (const partnerId of inboundPartnerIds) {
    if (!existingMap.has(partnerId)) {
      const id = `${itemId}_${partnerId}_in`;
      const ref = doc(db, 'partner_item', id);
      batch.set(ref, { id, itemId, partnerId, Direction: 'in' });
    }
  }

  await batch.commit();
};

export const syncInitialData = async (collectionName: string, initialData: any[]) => {
  // This is a helper to seed data if needed
  for (const item of initialData) {
    await addItem(collectionName, item);
  }
};
