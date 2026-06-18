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

/**
 * 원료(raw) 품목의 lots 배열을 트랜잭션으로 안전하게 수정한다.
 * 입고(로트 추가)·사용(차감)·순서변경(▲▼)이 동시에 일어나도 덮어쓰기 사고를 막는다.
 * @param rawItemId  원료 품목 문서 ID (예: 'raw-깨분참기름')
 * @param transform  현재 lots → 새 lots (순수 함수)
 * @param computeStock  새 lots → items.stock에 쓸 값(원료의 운영 단위). 미지정 시 stock은 그대로 둠.
 * @param fallback  읽기 한도(429) 소진 시 트랜잭션 대신 사용할 "메모리상의 현재 로트/재고".
 *   주면: 읽기 막혀도 순수 쓰기로 기록 보존(단일 작업 안전). 단, 같은 품목을 동시에 다른 기기에서
 *   수정하면 마지막 쓰기가 이겨 한쪽이 유실될 수 있음(lost update). 안 주면 한도 소진 시 그대로 실패.
 */
export const mutateRawMaterialLots = async (
  rawItemId: string,
  transform: (currentLots: RawMaterialLot[], currentStock: number) => RawMaterialLot[],
  computeStock?: (lots: RawMaterialLot[]) => number,
  fallback?: { lots: RawMaterialLot[]; stock: number },
) => {
  // Firestore는 undefined 필드를 거부 → 로트 배열에서 제거 (캔/수동 입고 로트의 미입력 옵션 필드 대비)
  const buildPatch = (next: RawMaterialLot[]): { lots: RawMaterialLot[]; stock?: number } => {
    const patch: { lots: RawMaterialLot[]; stock?: number } = { lots: stripUndefined(next) };
    if (computeStock) patch.stock = computeStock(next);
    return patch;
  };
  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, "items", rawItemId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error(`원료 품목을 찾을 수 없음: ${rawItemId}`);
      const data = snap.data();
      const current: RawMaterialLot[] = Array.isArray(data.lots) ? data.lots : [];
      tx.update(ref, buildPatch(transform(current, data.stock ?? 0)));
    });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const msg = String((err as { message?: string })?.message ?? '');
    const exhausted = code === 'resource-exhausted' || /resource-exhausted|quota/i.test(msg);
    if (exhausted && fallback) {
      // 읽기 한도 소진 → 트랜잭션(읽기) 대신 메모리 로트 기준 순수 쓰기로 기록 보존
      console.warn(`[mutateRawMaterialLots] 읽기 한도 소진 → 메모리 기준 순수쓰기 폴백 (${rawItemId})`);
      await updateDoc(doc(db, "items", rawItemId), buildPatch(transform(fallback.lots, fallback.stock)));
      return;
    }
    throw err;
  }
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
