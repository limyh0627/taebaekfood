// 완제품/상품 이름의 마지막 토큰(용량) 분포 확인 — 읽기 전용
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

const counts = new Map();
const noVolume = [];
for (const cat of ['product', 'goods', 'giftset']) {
  const snap = await getDocs(query(collection(db, 'items'), where('category', '==', cat)));
  snap.forEach(d => {
    const it = d.data();
    if (it.archived) return;
    const name = String(it.name ?? '');
    const last = name.split('/').pop()?.trim() ?? '';
    const isVol = /^\d+(\.\d+)?\s*(ml|l|g|kg)$/i.test(last);
    const key = isVol ? last.toLowerCase().replace(/\s/g, '') : null;
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    else noVolume.push(`${cat}: ${name} (spec=${it.spec ?? it['용량'] ?? '-'})`);
  });
}
console.log('=== 이름 끝 용량 토큰 분포 ===');
[...counts.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(8)} ${v}개`));
console.log(`\n=== 이름에 용량 없는 품목 (${noVolume.length}개, 최대 15개 표시) ===`);
noVolume.slice(0, 15).forEach(s => console.log('  ' + s));
process.exit(0);
