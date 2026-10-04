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
  getDoc,
  writeBatch,
  runTransaction,
  DocumentData,
  type Firestore,
  QuerySnapshot,
  QueryConstraint,
  documentId,
  arrayUnion,
} from "firebase/firestore";
import { auth, authReady, db } from "../firebase";
import { today } from '../day';
import type { Order, OrderStatus, RawMaterialLot, PurchaseOrder } from "../types";
import { pruneDepletedLots, buildProductLot, withCarryOverProductLot, lotQtyRemaining } from "../lotUtils";
import { companyOf, poLines, type Item, type CompanyId } from '../types';
import { canConfirmPurchaseOrderReceiptItem, holdsUnitStock } from '../itemTaxonomy';
import { itemKg } from '../orderUnits';
import { DENSITY, baseRawName, parsePackageKg } from '../../constants/formula';
import { receiptToKg } from '../lotUtils';
import { isRawHolder } from '../rawHolder';
import { rawLotTarget } from '../rawReceipt';
import { readRawCommandInTransaction, prepareRawCommand, writePreparedRawCommand } from './rawInventoryService';
import type { RawInventoryCommand } from '../rawInventoryCore';
import type { ItemReceipt } from '../receipt';
import { statementBlockReason } from "../statementGuard";
import { canResumeFailedInventoryOperation } from '../orderCompletion';
//  컬렉션 이름을 **글자가 아니라 목록에서** 받는다 — 오타가 컴파일에서 걸린다(2026-09-06)
import type { CollectionName } from '../collections';
import { withClaimCompany } from '../companyWriteBoundary';
import { openingDocId, type Partner } from '../types';
import { openingPartnerStatement, type OpeningPartnerCode } from '../openingPartnerBalance';
import { AR, AP } from '../autoJournal';

/**
 * 업무문서를 만드는 모든 화면이 같은 회사 판정을 쓴다. 화면의 currentUser/companyId는
 * 조작 가능한 상태값이므로 Firebase Auth가 서명한 custom claim을 기준으로 삼는다.
 */
export const companyScopedWriteData = async (
  collectionName: CollectionName,
  data: Record<string, unknown>,
) => {
  await authReady;
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 만료되어 저장하지 않았습니다. 다시 로그인해 주세요.');
  const token = await user.getIdTokenResult();
  return withClaimCompany(collectionName, data, { companyId: token.claims.companyId });
};

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
  const scoped = await companyScopedWriteData(collectionName, stripUndefined(data));
  await setDoc(doc(db, collectionName, docId), scoped, { merge: true });
};

/** Existing 108/251 aggregates are frozen; new partner balances live in vouchers. */
export async function saveOpeningBalancesWithDb(
  store: Firestore, companyId: CompanyId, date: string, amounts: Record<string, number>,
) {
  const ref = doc(store, 'openingBalances', openingDocId(companyId));
  await runTransaction(store, async tx => {
    const snap = await tx.get(ref);
    if (snap.exists() && snap.data().companyId !== companyId) throw new Error('다른 회사 기초잔액입니다.');
    if (snap.data()?.hasPartnerOpening && snap.data()?.date !== date) {
      throw new Error('거래처별 기초 전표가 있어 기준일을 변경할 수 없습니다.');
    }
    for (const code of [AR, AP]) {
      const before = Number(snap.data()?.amounts?.[code] ?? 0);
      const after = Number(amounts[code] ?? 0);
      if (before !== after) throw new Error(`${code} 기초 합계는 직접 변경할 수 없습니다. 거래처별 기초 전표를 등록하세요.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Object.values(amounts).some(v => !Number.isFinite(v) || v < 0)) {
      throw new Error('기초일과 계정별 금액을 확인하세요.');
    }
    // Replace the amounts map: merge would silently retain an account the user cleared.
    tx.set(ref, { id: openingDocId(companyId), companyId, date, amounts,
      ...(snap.data()?.hasPartnerOpening ? { hasPartnerOpening: true } : {}) });
  });
}

export async function saveOpeningBalances(companyId: CompanyId, date: string, amounts: Record<string, number>) {
  await authReady;
  const token = await auth.currentUser?.getIdTokenResult();
  if (token?.claims.companyId !== companyId) throw new Error('현재 로그인한 회사와 다른 회사에는 저장할 수 없습니다.');
  return saveOpeningBalancesWithDb(db, companyId, date, amounts);
}

/** Save one opening partner balance without overwriting an existing voucher on retry. */
export async function createOpeningPartnerBalanceWithDb(
  store: Firestore, companyId: CompanyId, date: string, partnerId: string, code: OpeningPartnerCode, amount: number,
): Promise<'created' | 'unchanged'> {
  const partnerRef = doc(store, 'partners', partnerId);
  const openingRef = doc(store, 'openingBalances', openingDocId(companyId));
  const id = `opening-partner-${companyId}-${date}-${partnerId}-${code}`;
  const voucherRef = doc(store, 'issuedStatements', id);
  return runTransaction(store, async tx => {
    const [partnerSnap, openingSnap, voucherSnap] = await Promise.all([
      tx.get(partnerRef), tx.get(openingRef), tx.get(voucherRef),
    ]);
    if (!partnerSnap.exists()) throw new Error('거래처가 없습니다.');
    const partner = { id: partnerSnap.id, ...partnerSnap.data() } as Partner;
    if (companyOf(partner) !== companyId) throw new Error('다른 회사 거래처입니다.');
    if (!openingSnap.exists() || openingSnap.data().companyId !== companyId || openingSnap.data().date !== date) {
      throw new Error('먼저 해당 날짜의 회계 기초잔액을 저장하세요.');
    }
    if (Number(openingSnap.data().amounts?.[code] ?? 0) !== 0) {
      throw new Error(`${code} 계정에 합계 기초잔액이 있어 이중계상됩니다. 기존 금액을 확인하세요.`);
    }
    const voucher = openingPartnerStatement(companyId, date, partner, code, amount);
    if (voucherSnap.exists()) {
      const saved = voucherSnap.data();
      if (saved.companyId === companyId && saved.partnerId === partnerId && saved.tradeDate === date &&
          saved.items?.find((i: { accountCode: string }) => i.accountCode === code)?.total === amount) return 'unchanged';
      throw new Error('같은 기초 전표번호에 다른 내용이 저장되어 있습니다.');
    }
    tx.update(openingRef, { hasPartnerOpening: true });
    tx.set(voucherRef, voucher);
    return 'created';
  });
}

export async function createOpeningPartnerBalance(companyId: CompanyId, date: string, partnerId: string, code: OpeningPartnerCode, amount: number) {
  await authReady;
  const token = await auth.currentUser?.getIdTokenResult();
  if (token?.claims.companyId !== companyId) throw new Error('현재 로그인한 회사와 다른 회사에는 저장할 수 없습니다.');
  return createOpeningPartnerBalanceWithDb(db, companyId, date, partnerId, code, amount);
}

export const subscribeToCollection = <T extends { id: string }>(
  collectionName: CollectionName,
  callback: (data: T[]) => void,
  constraints: QueryConstraint[] = [],
  onError: (error: Error) => void = error => console.error(`[Firestore 구독 실패] ${collectionName}`, error),
) => {
  const q = query(collection(db, collectionName), ...constraints);
  const cache = new Map<string, T>();

  return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    const changes = snapshot.docChanges();
    for (const change of changes) {
      if (change.type === 'added' || change.type === 'modified') {
        cache.set(change.doc.id, { id: change.doc.id, ...change.doc.data() } as T);
      } else if (change.type === 'removed') {
        cache.delete(change.doc.id);
      }
    }
    callback(Array.from(cache.values()));
  }, onError);
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
  callback: (data: T[]) => void,
  extraConstraints: QueryConstraint[] = [],
) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  // dateField이 ISO string이면 toISOString(), YYYY-MM-DD면 slice
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  // 회사 분리용 복합 인덱스가 생성되는 동안에도 목록이 비지 않도록 회사 조건으로
  // 먼저 구독하고 최근 날짜는 클라이언트에서 거른다.
  return subscribeToCollection<T>(
    collectionName,
    rows => callback(rows.filter(row => String((row as Record<string, unknown>)[dateField] ?? '') >= cutoffStr)),
    extraConstraints,
  );
};

// 특정 날짜 범위 one-time fetch (과거 데이터 온디맨드)
export const fetchDateRange = async <T extends { id: string }>(
  collectionName: CollectionName,
  dateField: string,
  startDate: string,
  endDate: string,
  extraConstraints: QueryConstraint[] = [],
): Promise<T[]> => {
  const q = query(
    collection(db, collectionName),
    where(dateField, '>=', startDate),
    where(dateField, '<=', endDate),
    ...extraConstraints,
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
  const data = await companyScopedWriteData(collectionName, stripUndefined(raw));
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
  // 수정도 로그인 claim의 회사를 함께 보낸다. 생성만 회사 경계를 지나고 수정은 화면값에 맡기면
  // 오피스톡 초대처럼 강화된 규칙에서 저장 경로마다 동작이 갈린다.
  const scoped = await companyScopedWriteData(collectionName, stripUndefined(data));
  await updateDoc(docRef, scoped);
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
    if (delta < 0 && next < 0) {
      throw new Error(`${itemId} 재고가 부족합니다. 현재 ${Number(snap.data().stock ?? 0)}, 차감 ${Math.round(-delta * 1000) / 1000}`);
    }
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
   * **재고는 언제나 로트 합계다**(2026-09-16). 예전엔 `lotsAreTotal` 원료만 예외로
   * 빼 뒀다 — "로트는 통틀어, stock 은 벌크만" 이라는 우회였는데, 그 예외를 켠 품목
   * (볶음참깨)만 장부가 깨져 있었다. 품목마다 로트를 나눠 다는 이관이 끝나 예외를 없앴다.
   */
  const buildPatch = (next: RawMaterialLot[]): { lots: RawMaterialLot[]; stock?: number } => {
    const patch: { lots: RawMaterialLot[]; stock?: number } = { lots: stripUndefined(next) };
    if (computeStock) patch.stock = computeStock(next);
    return patch;
  };
  const next = await runTransaction(db, async (tx) => {
    const ref = doc(db, "items", rawItemId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`원료 품목을 찾을 수 없음: ${rawItemId}`);
    const data = snap.data();
    const current: RawMaterialLot[] = Array.isArray(data.lots) ? data.lots : [];
    const stockBefore = Number(data.stock ?? 0);
    // #1 로트 배열 무한 증가 방지 — 오래된 depleted 로트 정리(모든 로트 쓰기 경로가 이 함수를 지남)
    const next = pruneDepletedLots(transform(current, stockBefore));
    tx.update(ref, buildPatch(next));
    return next;
  });
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
  parentCollection: CollectionName,
  parentId: string,
  subCollectionName: string,
  item: any
) => {
  const { id, ...raw } = item;
  const data = await companyScopedWriteData(parentCollection, stripUndefined(raw));
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

  // 회사별 보안 규칙은 목록 질의 자체에 companyId 조건이 있어야 허용한다.
  // 화면에서 이미 태백 품목만 보고 있어도 여기서 전체 회사를 조회하면 permission-denied가 난다.
  const scoped = await companyScopedWriteData('partner_item', {});
  const companyId = scoped.companyId as string;

  // 기존 레코드 조회 (Direction='out' 필터)
  const existing = await getDocs(q(
    col(db, 'partner_item'),
    where('companyId', '==', companyId),
    where('itemId', '==', itemId),
    where('Direction', '==', 'out'),
  ));
  const existingMap = new Map(existing.docs.map(d => [(d.data().partnerId ?? d.data().partnerId) as string, d.ref]));

  const ops: CompanyWriteOperation[] = [];

  // 연결 해제된 거래처 삭제
  existingMap.forEach((ref, partnerId) => {
    if (!partnerIds.includes(partnerId)) ops.push({ kind: 'delete', collection: 'partner_item', id: ref.id });
  });

  // 새로 연결된 거래처만 추가 (기존 레코드는 건드리지 않아 박스/테이프 설정 보존)
  for (const partnerId of partnerIds) {
    if (!existingMap.has(partnerId)) {
      const id = `${itemId}_${partnerId}_out`;
      ops.push({ kind: 'set', collection: 'partner_item', id, data: { id, itemId, partnerId, Direction: 'out' } });
    }
  }

  await commitCompanyWrites(ops);
};

// partner_item 컬렉션에 품목-거래처(Direction='in') 매핑 저장
export const setProductSuppliers = async (itemId: string, inboundPartnerIds: string[]) => {
  const { getDocs, query: q, collection: col, where } = await import('firebase/firestore');

  const scoped = await companyScopedWriteData('partner_item', {});
  const companyId = scoped.companyId as string;

  const existing = await getDocs(q(
    col(db, 'partner_item'),
    where('companyId', '==', companyId),
    where('itemId', '==', itemId),
    where('Direction', '==', 'in'),
  ));
  const existingMap = new Map(existing.docs.map(d => [(d.data().partnerId ?? d.data().partnerId) as string, d.ref]));

  const ops: CompanyWriteOperation[] = [];

  existingMap.forEach((ref, partnerId) => {
    if (!inboundPartnerIds.includes(partnerId)) ops.push({ kind: 'delete', collection: 'partner_item', id: ref.id });
  });

  for (const partnerId of inboundPartnerIds) {
    if (!existingMap.has(partnerId)) {
      const id = `${itemId}_${partnerId}_in`;
      ops.push({ kind: 'set', collection: 'partner_item', id, data: { id, itemId, partnerId, Direction: 'in' } });
    }
  }

  await commitCompanyWrites(ops);
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

/** 한 필드가 주어진 값들 중 하나인 문서. Firestore의 in 한도에 맞춰 30개씩 나눠 읽는다. */
export const fetchWhereIn = async <T extends { id: string }>(
  collectionName: CollectionName,
  field: string,
  values: readonly unknown[],
): Promise<T[]> => {
  const uniq = [...new Set(values)];
  if (uniq.length === 0) return [];
  const rows = new Map<string, T>();
  for (let i = 0; i < uniq.length; i += 30) {
    const snap = await getDocs(query(collection(db, collectionName), where(field, 'in', uniq.slice(i, i + 30))));
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
export type CompanyWriteOperation =
  | { kind: 'set'; collection: CollectionName; id: string; data: Record<string, unknown>; merge?: boolean }
  | { kind: 'delete'; collection: CollectionName; id: string };

/** 배치 생성도 단건 생성과 같은 claim 회사 경계를 반드시 통과한다. */
export const commitCompanyWrites = async (ops: CompanyWriteOperation[]): Promise<void> => {
  if (!ops.length) return;
  //  Firestore 배치는 한 번에 500건까지다. 넘으면 나눠 보낸다.
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + 400)) {
      const ref = doc(db, op.collection, op.id);
      if (op.kind === 'delete') {
        batch.delete(ref);
      } else {
        const data = await companyScopedWriteData(op.collection, stripUndefined(op.data));
        batch.set(ref, data, { merge: op.merge ?? false });
      }
    }
    await batch.commit();
  }
};

/** 캔 입고31개가 stock에만 남았던 사고: 품목·로트·입고근거를 같이 확정한다. */
export async function receiveUnitStock(receipt: ItemReceipt): Promise<boolean> {
  if (!Number.isFinite(receipt.quantity) || receipt.quantity <= 0) throw new Error('입고 수량은 0보다 커야 합니다.');
  const data = await companyScopedWriteData('itemReceipts', stripUndefined(receipt));
  return runTransaction(db, async tx => {
    const itemRef = doc(db, 'items', receipt.itemId);
    const receiptRef = doc(db, 'itemReceipts', receipt.id);
    const [itemSnap, receiptSnap] = await Promise.all([tx.get(itemRef), tx.get(receiptRef)]);
    if (!itemSnap.exists()) throw new Error('입고 품목이 없습니다.');
    const item = { ...itemSnap.data(), id: receipt.itemId } as Item;
    if (companyOf(item) !== data.companyId || !holdsUnitStock(item)) throw new Error('입고 회사 또는 품목 분류가 변경되었습니다.');
    if (receiptSnap.exists()) {
      const saved = receiptSnap.data();
      if (['itemId', 'companyId', 'quantity', 'date', 'poId'].some(k => saved[k] !== data[k])) throw new Error('같은 입고번호의 내용이 다릅니다.');
      return false;
    }
    const stock = Number(item.stock ?? 0);
    if (!Number.isFinite(stock) || stock < 0) throw new Error('현재 재고를 먼저 확인해 주세요.');
    const unitKg = itemKg(item) || 0;
    const lots = withCarryOverProductLot(item.lots ?? [], stock, item.rawMaterialName || item.name, unitKg,
      { id: `carry:${receipt.id}`, receivedDate: receipt.date, createdAt: receipt.createdAt });
    if (Math.abs(lotQtyRemaining(lots) - stock) > 0.0001) throw new Error('품목 재고와 로트 잔량이 다릅니다. 기존 누락을 확인한 뒤 입고해 주세요.');
    const lot = { ...buildProductLot({ material: item.rawMaterialName || item.name, itemId: item.id,
      supplierName: receipt.partnerName, supplierId: receipt.partnerId, qtyIn: receipt.quantity, unitKg,
      receivedDate: receipt.date, poId: receipt.poId }), id: `receipt:${receipt.id}`, createdAt: receipt.createdAt };
    tx.update(itemRef, { stock: Math.round((stock + receipt.quantity) * 1000) / 1000, lots: stripUndefined([...lots, lot]) });
    tx.set(receiptRef, data);
    return true;
  });
}

/** 발주 상태와 품목·원료 입고를 한 트랜잭션에서 확정한다. */
export async function confirmUnitPurchaseOrderReceipt(poId: string, addedBy?: string, allItems: Item[] = []): Promise<boolean> {
  await authReady;
  if (!auth.currentUser) throw new Error('로그인이 만료되었습니다.');
  const claim = (await auth.currentUser.getIdTokenResult()).claims.companyId as CompanyId;
  if (!claim) throw new Error('회사 권한이 없습니다.');
  return confirmUnitPurchaseOrderReceiptWithDb(db, claim, poId, addedBy, allItems);
}

/** 에뮬레이터에서 같은 트랜잭션을 실제 보안 규칙으로 검증한다. */
export async function confirmUnitPurchaseOrderReceiptWithDb(store: Firestore, claim: CompanyId, poId: string, addedBy?: string, allItems: Item[] = []): Promise<boolean> {
  const now = new Date().toISOString();
  const date = today();
  const poRef = doc(store, 'purchaseOrders', poId);
  if ((await getDoc(poRef)).data()?.status === 'received') return false;
  // 옛 입고 방식으로 일부만 반영된 발주는 자동 재시도하면 중복 재고가 된다.
  const oldReceipts = await getDocs(query(collection(store, 'itemReceipts'), where('companyId', '==', claim), where('poId', '==', poId)));
  if (!oldReceipts.empty) throw new Error('이 발주에 이미 입고 기록이 있습니다. 기존 반영 내역을 먼저 확인해 주세요.');
  const oldRawReceipts = await getDocs(query(collection(store, 'rawMaterialLedger'), where('companyId', '==', claim), where('source.id', '==', poId)));
  if (!oldRawReceipts.empty) throw new Error('이 발주에 이미 원료 입고 기록이 있습니다. 기존 로트와 수불부를 먼저 확인해 주세요.');
  return runTransaction(store, async tx => {
    const poSnap = await tx.get(poRef);
    if (!poSnap.exists()) throw new Error('발주가 없습니다.');
    const po = { id: poId, ...poSnap.data() } as PurchaseOrder;
    if (companyOf(po) !== claim) throw new Error('발주 회사가 로그인 회사와 다릅니다.');
    if (po.poType === 'oem') throw new Error('외주 발주는 이 버튼으로 입고할 수 없습니다.');
    if (po.status === 'received') return false;
    if (po.status !== 'invoiced') throw new Error('입고대기 발주만 확정할 수 있습니다.');
    const lines = poLines(po);
    if (!lines.length || lines.length > 100 || new Set(lines.map(line => line.itemId)).size !== lines.length)
      throw new Error('발주 품목 구성을 먼저 확인해 주세요.');
    const refs = lines.map(line => ({ item: doc(store, 'items', line.itemId), receipt: doc(store, 'itemReceipts', `rcv-po-${encodeURIComponent(poId)}-${encodeURIComponent(line.itemId)}`) }));
    const itemSnaps = await Promise.all(refs.map(ref => tx.get(ref.item)));
    const receiptSnaps = await Promise.all(refs.map(ref => tx.get(ref.receipt)));
    const rawCommands: { command: RawInventoryCommand; legacy: Record<string, unknown> }[] = [];
    const writes = lines.map((line, i) => {
      if (!Number.isFinite(line.quantity) || line.quantity <= 0 || Math.abs(Math.round(line.quantity * 1000) - line.quantity * 1000) > 1e-6)
        throw new Error('발주 수량을 먼저 확인해 주세요.');
      if (!itemSnaps[i].exists()) throw new Error(`입고 품목이 없습니다: ${line.itemId}`);
      if (receiptSnaps[i].exists()) throw new Error('기존 입고 기록이 있어 중복 입고를 막았습니다.');
      const item = { id: line.itemId, ...itemSnaps[i].data() } as Item;
      if (companyOf(item) !== claim) throw new Error(`품목 회사가 다릅니다: ${item.name}`);
      const unitStock = holdsUnitStock(item);
      if (!canConfirmPurchaseOrderReceiptItem(item)) {
        const target = isRawHolder(item) ? { rawItem: item, baseName: item.rawMaterialName || baseRawName(item.name) }
          : rawLotTarget(allItems, item, item.name, claim);
        if (!target) throw new Error(`원료 로트 홀더가 없습니다: ${item.name}`);
        const unit = String(item.unit ?? line.unit ?? '').toLowerCase();
        const packaged = unit !== 'kg' && unit !== 'l';
        const packageKg = packaged ? itemKg(item) || parsePackageKg(item.name) : undefined;
        if (packaged && (!packageKg || !Number.isFinite(packageKg) || packageKg <= 0))
          throw new Error(`원료 포장 단위의 kg 환산값이 없습니다: ${item.name}`);
        const density = DENSITY[target.baseName] ?? item.density ?? 1;
        const kg = receiptToKg({ quantity: line.quantity, unit, density, packageKg });
        if (!Number.isFinite(kg) || kg <= 0) throw new Error(`원료 입고 kg을 확인해 주세요: ${item.name}`);
        rawCommands.push({ command: {
          companyId: claim, rawItemId: target.rawItem.id, materialSnapshot: target.baseName,
          operationId: `po-receive:${poId}:${line.itemId}`,
          effectiveAt: now.slice(0, 10) === date ? now : `${date}T12:00:00+09:00`,
          source: { type: 'purchase', id: poId }, actorName: addedBy,
          kind: 'receive', kg,
          lot: { supplierId: po.partnerId, supplierName: po.partnerName || '거래처',
            packageType: packaged ? item.packageType ?? (packageKg ? '캔' : undefined) : undefined,
            packageKg, qtyIn: packaged ? line.quantity : undefined, poId },
        }, legacy: { note: `${po.partnerName || '거래처'} 입고`, type: 'manual', addedBy,
          originalAmount: line.quantity, originalUnit: unit === 'l' ? 'L' : 'kg',
          ...(packaged && packageKg ? { canSize: packageKg, canCount: line.quantity } : {}) } });
        return null;
      }
      const stock = Number(item.stock ?? 0);
      if (!Number.isFinite(stock) || stock < 0) throw new Error(`현재 재고를 확인해 주세요: ${item.name}`);
      if (!unitStock) return { item, stock, lots: item.lots ?? [], line };
      const unitKg = itemKg(item) || 0;
      const lots = withCarryOverProductLot(item.lots ?? [], stock, item.rawMaterialName || item.name, unitKg,
        { id: `carry:${refs[i].receipt.id}`, receivedDate: date, createdAt: now });
      if (Math.abs(lotQtyRemaining(lots) - stock) > 0.0001) throw new Error(`재고와 로트 잔량이 다릅니다: ${item.name}`);
      const lot = { ...buildProductLot({ material: item.rawMaterialName || item.name, itemId: item.id,
        supplierName: po.partnerName || '거래처', supplierId: po.partnerId, qtyIn: line.quantity, unitKg,
        receivedDate: date, poId }), id: `receipt:${refs[i].receipt.id}`, createdAt: now };
      return { item, stock, lots: [...lots, lot], line };
    });
    const rawReads = await Promise.all(rawCommands.map(row => readRawCommandInTransaction(tx, store, row.command)));
    rawCommands.forEach((row, i) => {
      const holder = rawReads[i].itemSnap.exists() ? { id: row.command.rawItemId, ...rawReads[i].itemSnap.data() } as Item : undefined;
      if (!holder || !isRawHolder(holder) || companyOf(holder) !== claim || baseRawName(holder.name) !== baseRawName(row.command.materialSnapshot))
        throw new Error(`원료 로트 홀더 연결이 변경됐습니다: ${row.command.materialSnapshot}`);
    });
    // 같은 홀더의 포장 SKU 여러 줄은 앞줄의 로트·재고를 다음 줄의 가상 입력으로 쓴다.
    // Firestore 읽기는 모두 끝낸 상태이며 쓰기는 각 원장 줄과 최종 홀더 상태를 한 거래로 묶는다.
    const virtualByHolder = new Map<string, { state: Extract<ReturnType<typeof prepareRawCommand>, { status: 'applied' }>['state']; itemData: Record<string, any> }>();
    const rawResults = rawCommands.map((row, i) => {
      const result = prepareRawCommand(row.command, rawReads[i], { now }, virtualByHolder.get(row.command.rawItemId));
      if (result.status !== 'applied') throw new Error(result.status === 'rejected' ? result.message : '기존 원료 입고 이력과 충돌합니다. 로트·수불부를 확인해 주세요.');
      virtualByHolder.set(row.command.rawItemId, {
        state: result.state,
        itemData: { ...rawReads[i].itemSnap.data(), stock: result.state.stockKg,
          lots: [...result.state.activeLots, ...result.state.recentDepletedLots] },
      });
      return result;
    });
    const receipts = writes.map((write, i) => write && stripUndefined({
      itemId: write.item.id, itemName: write.item.name, quantity: write.line.quantity,
      unit: write.item.unit, partnerId: po.partnerId, partnerName: po.partnerName || '거래처',
      date, poId, addedBy, createdAt: now, companyId: claim,
      id: refs[i].receipt.id,
    }));
    writes.forEach((write, i) => {
      if (!write) return;
      tx.update(refs[i].item, holdsUnitStock(write.item)
        ? { stock: Math.round((write.stock + write.line.quantity) * 1000) / 1000, lots: stripUndefined(write.lots) }
        : { stock: Math.round((write.stock + write.line.quantity) * 1000) / 1000 });
      tx.set(refs[i].receipt, receipts[i]);
    });
    rawCommands.forEach((row, i) => writePreparedRawCommand(tx, row.command, rawReads[i], rawResults[i], { now, legacy: row.legacy }));
    tx.update(poRef, { status: 'received', receivedAt: now });
    return true;
  });
}

/** 아직 입고되지 않은 일반 발주만 지운다. 전표와 재고 근거는 절대 함께 삭제하지 않는다. */
export async function deletePendingPurchaseOrder(poId: string): Promise<void> {
  await authReady;
  if (!auth.currentUser) throw new Error('로그인이 만료되었습니다.');
  const claim = (await auth.currentUser.getIdTokenResult()).claims.companyId as CompanyId;
  if (!claim) throw new Error('회사 권한이 없습니다.');
  await deletePendingPurchaseOrderWithDb(db, claim, poId);
}

export async function deletePendingPurchaseOrderWithDb(store: Firestore, claim: CompanyId, poId: string): Promise<void> {
  const receiptSnap = await getDocs(query(collection(store, 'itemReceipts'), where('companyId', '==', claim), where('poId', '==', poId)));
  if (!receiptSnap.empty) throw new Error('이미 입고 기록이 있어 발주를 삭제할 수 없습니다.');
  const rawReceiptSnap = await getDocs(query(collection(store, 'rawMaterialLedger'), where('companyId', '==', claim), where('source.id', '==', poId)));
  if (!rawReceiptSnap.empty) throw new Error('이미 원료 입고 기록이 있어 발주를 삭제할 수 없습니다.');
  await runTransaction(store, async tx => {
    const poRef = doc(store, 'purchaseOrders', poId);
    const poSnap = await tx.get(poRef);
    if (!poSnap.exists()) throw new Error('발주가 없거나 이미 삭제됐습니다.');
    const po = { id: poId, ...poSnap.data() } as PurchaseOrder;
    if (companyOf(po) !== claim) throw new Error('다른 회사 발주는 삭제할 수 없습니다.');
    if (po.status !== 'pending' && po.status !== 'invoiced') throw new Error('입고 완료된 발주는 삭제할 수 없습니다.');
    if (po.linkedStatementId) throw new Error('연결 전표가 있는 발주는 전표를 먼저 확인해 주세요.');
    if (po.poType === 'oem') throw new Error('외주 발주는 이 화면에서 삭제할 수 없습니다.');
    const lines = poLines(po);
    if (!lines.length) throw new Error('품목이 없는 발주는 내용을 먼저 확인해 주세요.');
    const items = await Promise.all(lines.map(line => tx.get(doc(store, 'items', line.itemId))));
    if (items.some(snap => !snap.exists() || companyOf(snap.data() as Item) !== claim))
      throw new Error('품목이 없거나 회사가 다른 발주는 이 화면에서 삭제할 수 없습니다.');
    tx.delete(poRef);
  });
}

export const writeMany = async (
  ops: { collection: CollectionName; id: string; data: Record<string, unknown>; merge?: boolean }[],
): Promise<void> => commitCompanyWrites(ops.map(op => ({ kind: 'set' as const, ...op })));

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

/**
 * 주문 상태·재고 작업을 DB에서 선점한다. 화면별 메모리 잠금만으로는 다른 탭의 동시 승인을
 * 막지 못하므로, 주문 문서의 현재 상태를 확인하고 작업 표식을 같은 트랜잭션에 기록한다.
 */
export const claimOrderInventoryOperation = async (
  orderId: string,
  expectedStatus: OrderStatus,
  operation: NonNullable<Order['inventoryOperation']>,
): Promise<Order> => runTransaction(db, async tx => {
  const ref = doc(db, 'orders', orderId);
  const snap = await tx.get(ref);
  if (!snap.exists()) throw new Error('주문을 찾을 수 없습니다.');
  const current = { id: snap.id, ...snap.data() } as Order;
  if (current.status !== expectedStatus) throw new Error('주문 상태가 이미 변경되었습니다. 새로고침 후 다시 확인해 주세요.');
  if (current.inventoryOperation?.state === 'processing') throw new Error('이 주문의 재고 작업이 이미 진행 중입니다.');
  if (current.inventoryOperation?.state === 'failed') {
    // 품목 한 줄 작업은 원료·생산실적 ID가 결정적이라 같은 체크를 다시 누르면 이미 끝난 단계는
    // duplicate로 건너뛴다. 반면 옛 주문 전체 상태 작업은 재실행 범위가 불명확하므로 계속 막는다.
    const retryableLine = canResumeFailedInventoryOperation(current.inventoryOperation, operation);
    if (!retryableLine) throw new Error('이 주문의 이전 재고 작업이 실패 상태입니다. 재고·로트·수불부를 점검한 뒤 작업 잠금을 해제해 주세요.');
  }
  tx.update(ref, { inventoryOperation: operation });
  return { ...current, inventoryOperation: operation };
});
