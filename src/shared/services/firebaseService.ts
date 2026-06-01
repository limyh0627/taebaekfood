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
  DocumentData,
  QuerySnapshot,
  QueryConstraint,
} from "firebase/firestore";
import { db } from "../firebase";

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

export const addItem = async (collectionName: string, item: any) => {
  const { id, ...raw } = item;
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
  await updateDoc(docRef, data);
};

export const deleteItem = async (collectionName: string, id: string) => {
  const docRef = doc(db, collectionName, id);
  await deleteDoc(docRef);
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
  const existing = await getDocs(q(col(db, 'partner_item'), where('Item_ID', '==', itemId), where('Direction', '==', 'out')));
  const existingMap = new Map(existing.docs.map(d => [d.data().Partner_ID as string, d.ref]));

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
      batch.set(ref, { id, Item_ID: itemId, Partner_ID: partnerId, Direction: 'out' });
    }
  }

  await batch.commit();
};

// partner_item 컬렉션에 품목-거래처(Direction='in') 매핑 저장
export const setProductSuppliers = async (itemId: string, inboundPartnerIds: string[]) => {
  const { getDocs, query: q, collection: col, where } = await import('firebase/firestore');

  const existing = await getDocs(q(col(db, 'partner_item'), where('Item_ID', '==', itemId), where('Direction', '==', 'in')));
  const existingMap = new Map(existing.docs.map(d => [d.data().Partner_ID as string, d.ref]));

  const batch = writeBatch(db);

  existingMap.forEach((ref, partnerId) => {
    if (!inboundPartnerIds.includes(partnerId)) batch.delete(ref);
  });

  for (const partnerId of inboundPartnerIds) {
    if (!existingMap.has(partnerId)) {
      const id = `${itemId}_${partnerId}_in`;
      const ref = doc(db, 'partner_item', id);
      batch.set(ref, { id, Item_ID: itemId, Partner_ID: partnerId, Direction: 'in' });
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
