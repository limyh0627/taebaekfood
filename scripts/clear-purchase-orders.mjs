import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
  storageBucket: 'taebaek-3abe4.firebasestorage.app',
  messagingSenderId: '426912093935',
  appId: '1:426912093935:web:2bd399b729b553edf82d1a',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

await signInAnonymously(auth);

const snap = await getDocs(collection(db, 'purchaseOrders'));
console.log(`총 ${snap.size}개 문서 삭제 중...`);
await Promise.all(snap.docs.map(d => deleteDoc(doc(db, 'purchaseOrders', d.id))));
console.log('완료');
process.exit(0);
