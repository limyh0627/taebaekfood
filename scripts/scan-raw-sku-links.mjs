// 매입 연결(partner_item in + partners.purchaseItems)된 SKU 전체 스캔:
// 원료 연동 여부 판정(rawLotTarget 로직 재현) + 원료명이 이름에 들어있는데 미연동인 것 표시 (읽기 전용)
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const RM_LIST = ['참깨', '들깨', '검정깨', '탈피들깨가루', '깨분', '볶음참깨', '볶음들깨', '볶음검정참깨', '통깨참기름', '깨분참기름', '통들깨들기름', '수입들기름'];
const baseRawName = (n) => (n ?? '').split('/')[0].trim();

const [itemsSnap, piSnap, partnersSnap] = await Promise.all([
  getDocs(collection(db, 'items')),
  getDocs(query(collection(db, 'partner_item'), where('Direction', '==', 'in'))),
  getDocs(collection(db, 'partners')),
]);
const items = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
const byId = new Map(items.map(i => [i.id, i]));
const partnerName = new Map(partnersSnap.docs.map(d => [d.id, d.data().name]));

// 매입 연결 수집: partner_item(in) + purchaseItems
const linked = new Map(); // itemId → Set(거래처명)
for (const d of piSnap.docs) {
  const x = d.data();
  if (!x.Item_ID) continue;
  if (!linked.has(x.Item_ID)) linked.set(x.Item_ID, new Set());
  linked.get(x.Item_ID).add(partnerName.get(x.Partner_ID) ?? x.Partner_ID);
}
for (const d of partnersSnap.docs) {
  const p = d.data();
  (p.purchaseItems ?? []).forEach(pi => {
    const it = byId.get(pi.id) ?? items.find(i => i.name === pi.name);
    if (!it) return;
    if (!linked.has(it.id)) linked.set(it.id, new Set());
    linked.get(it.id).add(p.name + '(구형)');
  });
}

const rawExists = (base) => items.some(i => i.category === 'raw' && baseRawName(i.name) === base);
const looksRaw = (name) => RM_LIST.find(m => (name ?? '').includes(m));

console.log('████ 매입 연결 SKU 전체 (' + linked.size + '건) ████');
const broken = [];
for (const [itemId, partners_] of linked) {
  const it = byId.get(itemId);
  if (!it) { console.log(`  ⚠️ 품목문서 없음: ${itemId} (연결: ${[...partners_].join(',')})`); continue; }
  const base = it.rawMaterialName || baseRawName(it.name);
  const ok = RM_LIST.includes(base) && rawExists(base);
  const looks = looksRaw(it.name);
  const flag = ok ? '✅ 원료연동' : looks ? `❌ 미연동(원료 "${looks}" 추정)` : '· 비원료(부자재/기타)';
  console.log(`  ${flag} | "${it.name}" [${it.id}] cat=${it.category} stock=${it.stock}${it.unit ?? ''} rawMaterialName=${it.rawMaterialName ?? '-'} ← ${[...partners_].join(', ')}`);
  if (!ok && looks) broken.push({ id: it.id, name: it.name, guess: looks });
}

console.log(`\n████ 원료명 포함인데 미연동 SKU: ${broken.length}건 ████`);
broken.forEach(b => console.log(`  - "${b.name}" [${b.id}] → rawMaterialName="${b.guess}" 지정 후보`));

process.exit(0);
