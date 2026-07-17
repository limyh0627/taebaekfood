// 볶음참깨 재고 모델 재편 (2026-07-13, 사용자 확정안)
//  - 10kg/20kg 박스 = 각자 품목 재고(박스 수), 완사입(procureType) — 생산 로직 스킵, 출고 시 자기 재고 차감
//  - 낱개/1kg = 팩 재고, 박스 "개봉"(unpackTo)으로 충전
//  - 80/140/200/350/500g = 벌크(raw-볶음참깨) 원료식(kg) 차감
//  - 1KG-볶음참깨(부자재, -770) 폐기(archived) + 옛 BOM 참조 제거 + 유령 알림 삭제
// 실행:     node scripts/migrate-bokkeum-model.mjs
// 되돌리기: node scripts/migrate-bokkeum-model.mjs --undo  (backup JSON 기반 원복)
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc, setDoc, deleteDoc, deleteField, collection, query, where, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import fs from 'fs';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app); await signInAnonymously(getAuth(app));
const undo = process.argv.includes('--undo');
const BACKUP = 'scripts/migrate-bokkeum-model-backup.json';

const IDS = {
  box10: 'p-1780625531675',        // 볶음참깨/10kg
  box20: 'p-1780625559322',        // 볶음참깨/20kg
  single: 'PLDhkjOgcPIhO1hhReHm',  // 볶음참깨-낱개/1kg
  smart: 'p-1779069467512',        // 볶음참깨(스마트스토어)/1kg
  legacy: 'PLYZ-S-1000',           // 1KG-볶음참깨 (폐기 대상)
  g80: 'p-1781770117874', g140: 'p-1780297369472', g200: 'p-1779320974154',
  g350: 'p-1783918260605', g500: 'p-1781739328648',
};

if (undo) {
  const bak = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
  for (const [path, data] of Object.entries(bak.docs)) {
    const [col, id] = path.split('/');
    if (data === null) await deleteDoc(doc(db, col, id));
    else await setDoc(doc(db, col, id), data);
    console.log(`복원: ${path}`);
  }
  console.log('되돌림 완료');
  process.exit(0);
}

const backup = { at: new Date().toISOString(), docs: {} };
const snapOf = async (col, id) => {
  const s = await getDoc(doc(db, col, id));
  return s.exists() ? s.data() : null;
};
const save = async (col, id) => { backup.docs[`${col}/${id}`] = await snapOf(col, id); };

// ── 1) 판매/재고 품목 재편 ──────────────────────────────────────────────
// 10kg 박스: 재고 0(박스), 완사입, 개봉→낱개+10, 규격 10kg
await save('items', IDS.box10);
await updateDoc(doc(db, 'items', IDS.box10), {
  stock: 0, unit: '개', spec: '10kg', procureType: '완사입',
  unpackTo: { itemId: IDS.single, count: 10 },
});
console.log('볶음참깨/10kg: stock 0(박스), 완사입, 개봉+10, spec 10kg');

// 20kg 박스
await save('items', IDS.box20);
await updateDoc(doc(db, 'items', IDS.box20), {
  stock: 0, unit: '개', spec: '20kg', procureType: '완사입',
  unpackTo: { itemId: IDS.single, count: 20 },
});
console.log('볶음참깨/20kg: stock 0(박스), 완사입, 개봉+20, spec 20kg');

// 낱개 1kg: 재고 0(팩), 완사입
await save('items', IDS.single);
await updateDoc(doc(db, 'items', IDS.single), { stock: 0, unit: '개', procureType: '완사입' });
console.log('볶음참깨-낱개/1kg: stock 0(팩), 완사입');

// 스마트스토어 1kg: 완사입 지정(자기 재고 차감) — 낱개와 별도 품목이라 재고 통합은 후속
await save('items', IDS.smart);
await updateDoc(doc(db, 'items', IDS.smart), { procureType: '완사입' });
console.log('볶음참깨(스마트스토어)/1kg: 완사입');

// ── 2) 옛 BOM 참조 제거 (1KG-볶음참깨 / raw-볶음참깨 직접참조) ─────────
for (const id of [IDS.box10, IDS.box20, IDS.single, IDS.g350]) {
  const cur = await snapOf('items', id);
  if (!cur) continue;
  const before = cur.submaterials ?? [];
  const after = before.filter(s => s.id !== IDS.legacy && s.id !== 'raw-볶음참깨');
  if (before.length !== after.length || !cur.submaterials) {
    if (!backup.docs[`items/${id}`]) await save('items', id);
    await updateDoc(doc(db, 'items', id), { submaterials: after });
    console.log(`${cur.name}: BOM 참조 정리 (${before.length}→${after.length})`);
  }
}

// ── 3) 소용량 원료식(item_formula) — 벌크 kg 차감 ──────────────────────
const smallIds = [IDS.g80, IDS.g140, IDS.g200, IDS.g350, IDS.g500];
for (const id of smallIds) {
  const cur = await snapOf('items', id);
  if (!cur) { console.log(`items/${id} 없음 — 건너뜀`); continue; }
  // 3-1) 규격/이름 정리
  if (id === IDS.g80 && cur.spec !== '80g') {
    if (!backup.docs[`items/${id}`]) await save('items', id);
    await updateDoc(doc(db, 'items', id), { spec: '80g' });
    console.log(`${cur.name}: spec ${cur.spec} → 80g (오타 수정)`);
  }
  if (id === IDS.g500 && cur.name === '볶음참깨') {
    if (!backup.docs[`items/${id}`]) await save('items', id);
    await updateDoc(doc(db, 'items', id), { name: '볶음참깨/500g' });
    console.log(`볶음참깨(500g): 이름 → 볶음참깨/500g`);
  }
  // 3-2) produceOrder 가드: submaterials 배열이 없으면 빈 배열 생성
  if (!cur.submaterials) {
    if (!backup.docs[`items/${id}`]) await save('items', id);
    await updateDoc(doc(db, 'items', id), { submaterials: [] });
    console.log(`${cur.name}: submaterials [] 생성 (원료식 차감 경로 진입용)`);
  }
  // 3-3) 원료식 등록 — parent_key = 품목 || 이름 (위 이름 변경 반영)
  const fresh = await snapOf('items', id);
  const parentKey = fresh.품목 || fresh.name;
  const fid = `formula-${parentKey}-볶음참깨`.replace(/\s/g, '_');
  backup.docs[`item_formula/${fid}`] = await snapOf('item_formula', fid);
  await setDoc(doc(db, 'item_formula', fid), { parent_key: parentKey, child_name: '볶음참깨', ratio: 1, yield_rate: 1 });
  console.log(`원료식: ${parentKey} → 볶음참깨 ×1 (spec ${fresh.spec} 기준 kg 환산)`);
}

// ── 4) 1KG-볶음참깨 폐기 ────────────────────────────────────────────────
await save('items', IDS.legacy);
await updateDoc(doc(db, 'items', IDS.legacy), { archived: true, stock: 0 });
console.log('1KG-볶음참깨: archived + stock 0 (기존 -770)');

// ── 5) 유령 발주 알림 삭제 ─────────────────────────────────────────────
const ar = await getDocs(query(collection(db, 'adjustmentRequests'), where('type', '==', 'reorder_alert'), where('status', '==', 'pending')));
for (const d of ar.docs) {
  const r = d.data();
  if (r.itemId === IDS.legacy || r.itemId === 'raw-볶음참깨') {
    backup.docs[`adjustmentRequests/${d.id}`] = r;
    await deleteDoc(doc(db, 'adjustmentRequests', d.id));
    console.log(`알림 삭제: ${r.itemName} (${r.reason})`);
  }
}

fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2));
console.log(`\n백업 저장: ${BACKUP} — 완료`);
process.exit(0);
