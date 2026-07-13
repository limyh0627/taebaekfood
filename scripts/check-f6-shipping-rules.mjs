// 들향기름골드(f6) 거래처별 배송 규칙(qty_per_box 오버라이드) 확인 — 읽기 전용
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app); await signInAnonymously(getAuth(app));
const snap = await getDocs(query(collection(db, 'shipping_rules'), where('item_id', '==', 'f6')));
console.log(`shipping_rules에서 f6 규칙: ${snap.size}건`);
snap.forEach(d => console.log(' ', JSON.stringify(d.data())));
process.exit(0);
