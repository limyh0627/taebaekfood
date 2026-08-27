// 생들기름 — 로트만 움직이고 원장을 안 쓴 것 둘을 바로잡는다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// ① 수입들기름 대체분 512.848kg을 **로트에서만** 뺐다(fix-suip-to-saeng-lots). 원장에 안 남겼으니
//    무조건 틀어진다. 원장에 사용 줄로 남긴다.
// ② 그것과 별개로, 08-23 실사 앵커(3,055.668) 뒤 08-24·08-25 해피유통(포천) 277kg 두 건이
//    **원장에만 빠지고 로트에서 안 빠졌다**(합 554kg). 로트에서 마저 뺀다.
//
//   원장 2,485.048 − 512.848 = 1,972.2
//   로트 2,526.2   −   554   = 1,972.2
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { withCarryOverLot, deductFromLots } from '../src/shared/lotUtils';
import { ledgerBalanceKg } from '../src/shared/rawLedgerBalance';
import { lotRemainingKg } from '../src/shared/ledgerLotCheck';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-saeng-ledger-sync-backup.json';
const MATERIAL = '생들기름';
const 이동량 = 512.848;                       // 수입들기름 대체분 — 내가 로트에서만 뺐던 양
const ENTRY_ID = 'rm-fix-생들기름-수입대체-20260827';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8'));
  await updateDoc(doc(db, 'items', prev.itemId), { lots: prev.lots, stock: prev.stock });
  await deleteDoc(doc(db, 'rawMaterialLedger', ENTRY_ID));
  console.log('✅ 로트 복원 · 원장 줄 삭제'); process.exit(0);
}

const [items, led] = await Promise.all([load('items'), load('rawMaterialLedger')]);
const h = items.find((i: any) => i.name === MATERIAL && !i.archived);
const rows = led.filter((e: any) => String(e.material) === MATERIAL);
const balNow = Math.round(ledgerBalanceKg(rows as any, h.density ?? 1) * 1000) / 1000;
const lotNow = lotRemainingKg(h.lots);

const balAfter = Math.round((balNow - 이동량) * 1000) / 1000;      // 원장에 이동을 남긴 뒤
const lotShort = Math.round((lotNow - balAfter) * 1000) / 1000;    // 로트가 덜 빠진 양
const next = lotShort > 0.001
  ? deductFromLots(withCarryOverLot([...(h.lots ?? [])], Number(h.stock ?? 0), MATERIAL), lotShort).lots
  : [...(h.lots ?? [])];
const lotAfter = lotRemainingKg(next);

console.log(`\n═══ ${APPLY ? '🔴 적용(--apply)' : '🟢 미리보기(dry)'} ═══\n`);
console.log(`   지금        원장 ${balNow}kg      로트 ${lotNow}kg      (차이 ${Math.round((balNow - lotNow) * 1000) / 1000})`);
console.log(`\n   ① 원장에 사용 ${이동량}kg 기록 (수입들기름 대체분 — 로트에서만 빼놨던 것)`);
console.log(`        → 원장 ${balAfter}kg`);
console.log(`   ② 로트에서 ${lotShort}kg 차감 (08-24·08-25 해피유통(포천) 277×2 — 원장에만 빠졌던 것)`);
console.log(`        → 로트 ${lotAfter}kg`);
console.log(`\n   결과        원장 ${balAfter}kg  =  로트 ${lotAfter}kg   차이 ${Math.round((balAfter - lotAfter) * 1000) / 1000}`);
for (const l of next.filter((l: any) => Number(l.kgRemaining ?? 0) !== 0))
  console.log(`      ${String(l.lotNo ?? l.id).padEnd(28)} ${String(l.supplierName ?? '').padEnd(24)} ${l.kgRemaining}kg`);
console.log(`\n되돌리기: npx tsx scripts/fix-saeng-ledger-sync.mts --undo`);
if (!APPLY) { console.log(`\n적용: npx tsx scripts/fix-saeng-ledger-sync.mts --apply`); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify({ itemId: h.id, lots: h.lots ?? [], stock: Number(h.stock ?? 0) }, null, 1), 'utf8');
await setDoc(doc(db, 'rawMaterialLedger', ENTRY_ID), {
  id: ENTRY_ID, material: MATERIAL, date: '2026-08-27', received: 0, used: 이동량,
  note: '수입들기름 대체 사용 (수입분 부족분을 생들기름으로)',
  type: 'manual', unit: 'kg', createdAt: new Date().toISOString(),
});
await updateDoc(doc(db, 'items', h.id), {
  lots: JSON.parse(JSON.stringify(next)),
  ...(h.lotsAreTotal ? {} : { stock: lotAfter }),
});
console.log(`\n✅ 원장 ${balAfter}kg = 로트 ${lotAfter}kg · 백업 ${BACKUP}`);
process.exit(0);
