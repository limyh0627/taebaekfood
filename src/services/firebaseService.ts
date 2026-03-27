import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
  query,
  writeBatch,
  DocumentData,
  QuerySnapshot
} from "firebase/firestore";
import { db } from "../firebase";

export const subscribeToCollection = <T extends { id: string }>(
  collectionName: string, 
  callback: (data: T[]) => void
) => {
  const q = query(collection(db, collectionName));
  return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    const items = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as T));
    callback(items);
  });
};

export const addItem = async (collectionName: string, item: any) => {
  const { id, ...data } = item;
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

// productClients 컬렉션에 품목-거래처 매핑 저장 (기존 전체 교체)
export const setProductClients = async (productId: string, clientIds: string[]) => {
  const batch = writeBatch(db);

  // 기존 매핑 삭제
  const existing = await import('firebase/firestore').then(m =>
    m.getDocs(m.query(m.collection(db, 'productClients'), m.where('productId', '==', productId)))
  );
  existing.docs.forEach(d => batch.delete(d.ref));

  // 새 매핑 추가
  for (const clientId of clientIds) {
    const ref = doc(db, 'productClients', `${productId}_${clientId}`);
    batch.set(ref, { productId, clientId });
  }

  await batch.commit();
};

export const syncInitialData = async (collectionName: string, initialData: any[]) => {
  // This is a helper to seed data if needed
  for (const item of initialData) {
    await addItem(collectionName, item);
  }
};
