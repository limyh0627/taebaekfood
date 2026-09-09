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
  documentId,
  arrayUnion,
} from "firebase/firestore";
import { db } from "../firebase";
import { today } from '../day';
import type { RawMaterialLot } from "../types";
import { pruneDepletedLots } from "../lotUtils";
import { statementBlockReason } from "../statementGuard";
//  컬렉션 이름을 **글자가 아니라 목록에서** 받는다 — 오타가 컴파일에서 걸린다(2026-09-06)
import type { CollectionName } from '../collections';

export const subscribeToDocument = <T>(
  collectionName: CollectionName,
  docId: string,
  callback: (data: T | null) => void
) => {
  return onSnapshot(doc(db, collectionName, docId), (snap) => {
    callback(snap.exists() ? (snap.data() as T) : null);
  });
};

export const setDocument = async (collectionName: CollectionName, docId: string, data: any) => {
  await setDoc(doc(db, collectionName, docId), data, { merge: true });
};

export const subscribeToCollection = <T extends { id: string }>(
  collectionName: CollectionName,
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
  collectionName: CollectionName,
  constraints: QueryConstraint[] = []
): Promise<T[]> => {
  const q = query(collection(db, collectionName), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as T));
};

// 날짜 기준 과거 N일치 구독
export const subscribeToRecentCollection = <T extends { id: string }>(
  collectionName: CollectionName,
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
  collectionName: CollectionName,
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
 * items 컬렉션의 분류 3단은 DB 필드 이름과 코드 이름이 같다(type/category/subtype).
 * 예전엔 코드가 옛 이름(category=타입·subtype=카테고리·subtype2=서브타입)을 써서
 * 쓰기 직전에 뒤집어 줬는데, 2026-08-23에 코드를 DB 이름으로 맞추고 그 변환을 없앴다.
 */

export const addItem = async (collectionName: CollectionName, item: any) => {
  /**
   * **차·대를 못 채우는 전표는 안 만든다.** 만드는 길이 여러 갈래(전표화면·확인사항·반품·임가공)라
   * 화면마다 막으면 한 곳은 반드시 새다. 쓰는 문 하나에서 막는다.
   * (스크립트는 raw Firestore를 쓰므로 여기 안 걸린다 — 일부러 하는 정정은 막을 이유가 없다)
   */
  if (collectionName === 'issuedStatements') {
    const reason = statementBlockReason(item);
    if (reason) throw new Error(`전표를 만들 수 없습니다 — ${reason}`);
  }
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

export const updateItem = async (collectionName: CollectionName, id: string, data: any) => {
  const docRef = doc(db, collectionName, id);
  // getFirestore는 ignoreUndefinedProperties가 꺼져 있어 undefined가 있으면 updateDoc이 throw한다.
  // (예: 전표 items[].accountCode가 빈 값이면 undefined로 들어와 저장이 통째로 실패) → 깊게 제거.
  await updateDoc(docRef, stripUndefined(data));
};

export const deleteItem = async (collectionName: CollectionName, id: string) => {
  const docRef = doc(db, collectionName, id);
  await deleteDoc(docRef);
};

/**
 * 알림의 읽음·숨김은 여러 직원이 같은 문서에 자기 ID를 보탠다.
 * 화면 배열을 다시 써버리면 동시 처리 때 다른 직원 ID가 사라지므로 arrayUnion만 쓴다.
 */
export const markNotificationForUser = async (
  id: string,
  field: 'readBy' | 'dismissedBy',
  userId: string,
) => {
  await updateDoc(doc(db, 'notifications', id), { [field]: arrayUnion(userId) });
};

/**
 * 원료(raw) 품목의 lots 배열을 트랜잭션으로 안전하게 수정한다.
 * 입고(로트 추가)·사용(차감)·순서변경(▲▼)이 동시에 일어나도 덮어쓰기 사고를 막는다.
 * @param rawItemId  원료 품목 문서 ID (예: 'raw-깨분참기름')
 * @param transform  현재 lots → 새 lots (순수 함수)
 * @param computeStock  새 lots → items.stock에 쓸 값(원료의 운영 단위). 미지정 시 stock은 그대로 둠.
 */
/**
 * 재고를 **DB에서 읽어 더한다**(트랜잭션). delta는 증감분.
 *
 * `updateItem(col, id, { stock: 화면값 + delta })`가 하던 일을 대신한다.
 * 화면값은 클릭 순간의 React 상태라, 함수가 도는 몇 초 사이에 다른 쓰기가 끼면
 * **그 쓰기를 덮어써서 재고가 통째로 어긋난다.** 구독이 실시간이어도 소용없다 —
 * 이미 출발한 실행 안의 변수는 안 바뀌고, 자기가 방금 쓴 값도 왕복 전엔 안 돌아온다.
 * (2026-08 완제품 재고 22건이 음수로 간 경로가 이것이다)
 *
 * → 읽어서 보여주는 건 화면 상태, 계산해서 쓰는 건 DB.
 *
 * @returns 반영 뒤 재고. 문서가 없으면 null.
 */
export const adjustItemStock = async (
  collectionName: CollectionName,
  itemId: string,
  delta: number,
): Promise<number | null> => {
  if (!delta) return null;
  return runTransaction(db, async (tx) => {
    const ref = doc(db, collectionName, itemId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return null;
    const next = Math.round((Number(snap.data().stock ?? 0) + delta) * 1000) / 1000;
    tx.update(ref, { stock: next });
    return next;
  });
};

export const mutateRawMaterialLots = async (
  rawItemId: string,
  transform: (currentLots: RawMaterialLot[], currentStock: number) => RawMaterialLot[],
  computeStock?: (lots: RawMaterialLot[]) => number,
): Promise<RawMaterialLot[]> => {
  /**
   * Firestore는 undefined 필드를 거부 → 로트 배열에서 제거 (캔/수동 입고 로트의 미입력 옵션 필드 대비)
   *
   * **`lotsAreTotal` 원료는 stock을 안 덮어쓴다.** 로트와 벌크 재고는 다른 숫자다:
   *     로트·원료수불부   볶음참깨가 통틀어 몇 kg 있나 (벌크 + 낱개 + 박스)
   *     items.stock       그중 자루로 남은 **벌크만**
   * 부르는 쪽마다 챙기게 해 놨더니 orderStockEngine이 빠뜨려, 출고할 때마다 벌크 재고가
   * 로트합으로 덮였다. 판정을 이 안으로 들여서 어느 경로로 들어와도 안 틀어지게 한다.
   */
  const buildPatch = (next: RawMaterialLot[], lotsAreTotal: boolean): { lots: RawMaterialLot[]; stock?: number } => {
    const patch: { lots: RawMaterialLot[]; stock?: number } = { lots: stripUndefined(next) };
    if (computeStock && !lotsAreTotal) patch.stock = computeStock(next);
    return patch;
  };
  const { next, opening } = await runTransaction(db, async (tx) => {
    const ref = doc(db, "items", rawItemId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`원료 품목을 찾을 수 없음: ${rawItemId}`);
    const data = snap.data();
    const current: RawMaterialLot[] = Array.isArray(data.lots) ? data.lots : [];
    const stockBefore = Number(data.stock ?? 0);
    // #1 로트 배열 무한 증가 방지 — 오래된 depleted 로트 정리(모든 로트 쓰기 경로가 이 함수를 지남)
    const next = pruneDepletedLots(transform(current, stockBefore));
    tx.update(ref, buildPatch(next, !!data.lotsAreTotal));
    // 로트가 하나도 없던 원료를 처음 건드리는 순간 = withCarryOverLot이 stock을 '이월' 로트로 옮기는 때.
    // 그 이월은 **실제 원장에 아무 줄도 안 남겨서**, 로트합만 올라가고 잔량은 그대로라 영구히 벌어졌다.
    // → 여기서 기초이월 한 줄을 남긴다. 실제 원장의 줄과 로트 변화는 언제나 1:1이어야 한다.
    const opening = current.length === 0 && stockBefore > 0
      ? { kg: Math.round(stockBefore * 1000) / 1000, name: String(data.name ?? ""), companyId: data.companyId ?? "taebaek" }
      : null;
    return { next, opening };
  });

  if (opening) {
    // 문서 id를 원료별로 고정 → 재시도·중복 호출에도 딱 한 번만 생긴다.
    const entryId = `rm-open-${rawItemId}`;
    const material = opening.name.split("/")[0].trim() || opening.name;
    try {
      await setDoc(
        doc(db, "rawMaterialLedger", entryId),
        {
          id: entryId,
          material,
          //  **열쇠를 같이 박는다** — 이 줄은 이 품목의 로트가 처음 서면서 생긴 것이다.
          //  이름으로 되짚게 두면 이름이 바뀌는 순간 원장에서 떨어져 나간다.
          rawItemId,
          companyId: opening.companyId,
          date: today(),
          received: opening.kg,
          used: 0,
          note: "기초이월 (로트 도입 전 재고)",
          type: "manual",
          unit: "kg",
          createdAt: new Date().toISOString(),
        },
        { merge: true },
      );
    } catch (e) {
      // 원장 기록이 실패해도 로트 변경은 이미 커밋됐다 — 조용히 삼키지 말고 남긴다.
      console.error("[기초이월] 실제 원장 기록 실패:", rawItemId, e);
    }
  }
  return next;
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

export const syncInitialData = async (collectionName: CollectionName, initialData: any[]) => {
  // This is a helper to seed data if needed
  for (const item of initialData) {
    await addItem(collectionName, item);
  }
};

/* ────────────────────────────────────────────────────────────────────────────
 * 아래 셋은 **문을 넓히려고** 더한 것이다.
 *
 * 예전엔 이 파일에 없는 기능(조건 조회·트랜잭션·배치)이 필요하면 화면이 firebase를
 * 직접 불렀다. 그렇게 8개 파일이 밖으로 샜다. 나중에 다른 DB로 옮기든 회사 격리를
 * 한 곳에서 강제하든, **Firestore를 부르는 자리가 이 파일 하나여야** 손을 댈 수 있다.
 *
 * 여기 있는 것들은 일부러 **Firestore 타입을 밖으로 안 내보낸다** — 받는 것도 주는 것도
 * 평범한 객체다. 그래야 부르는 쪽이 Firestore를 몰라도 된다.
 * ──────────────────────────────────────────────────────────────────────────── */

/** 한 필드가 어떤 값인 문서만. 컬렉션 전체를 읽어 거르는 것보다 싸다. */
export const fetchWhere = async <T extends { id: string }>(
  collectionName: CollectionName,
  field: string,
  value: unknown,
): Promise<T[]> => {
  const snap = await getDocs(query(collection(db, collectionName), where(field, '==', value)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as T));
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
): Promise<T[]> => {
  const uniq = [...new Set(ids.filter(Boolean))];
  const out: T[] = [];
  for (let i = 0; i < uniq.length; i += 30) {
    const snap = await getDocs(query(collection(db, collectionName), where(documentId(), 'in', uniq.slice(i, i + 30))));
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

/**
 * 여러 문서를 **한꺼번에** 쓴다 — 중간에 끊겨 반만 쓰이는 일이 없다.
 * 재고 차감처럼 여러 품목이 같이 움직일 때 쓴다.
 */
export const writeMany = async (
  ops: { collection: string; id: string; data: Record<string, unknown>; merge?: boolean }[],
): Promise<void> => {
  if (!ops.length) return;
  //  Firestore 배치는 한 번에 500건까지다. 넘으면 나눠 보낸다.
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + 400)) {
      batch.set(doc(db, op.collection, op.id), op.data, { merge: op.merge ?? false });
    }
    await batch.commit();
  }
};

/**
 * 읽고 고쳐 쓰는 걸 **한 덩어리로** — 그 사이 남이 고치면 다시 돈다.
 * 두 사람이 같은 재고를 동시에 깎을 때 하나가 사라지는 걸 막는다.
 *
 * @param read  지금 값을 읽어 온다(없으면 undefined)
 * @param write 그 값으로 무엇을 쓸지 정한다. undefined를 주면 아무것도 안 쓴다.
 */
export const mutateDoc = async <T>(
  collectionName: CollectionName,
  id: string,
  next: (_cur: T | undefined) => Record<string, unknown> | undefined,
): Promise<void> => {
  const ref = doc(db, collectionName, id);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    const data = next(snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : undefined);
    if (data) tx.set(ref, data, { merge: true });
  });
};
