// 수입들기름 원장 잔량을 로트(0)에 맞춘다 — 모자란 만큼 **입고**로 채운다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 원장이 -440.083kg다. 사용은 적혔는데 그만큼의 매입이 원장에 안 잡힌 것이라, 앵커로 덮지 않고
// **입고 줄**로 채운다. 앵커는 "세어보니 이만큼"이고 입고는 "이만큼 들어왔다"라 뜻이 다르다 —
// 없던 매입을 앵커로 지우면 그 매입이 영영 서류에서 사라진다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { ledgerBalanceKg } from '../src/shared/rawLedgerBalance';
import { lotRemainingKg } from '../src/shared/ledgerLotCheck';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const MATERIAL = '수입들기름';
const ENTRY_ID = `rm-fix-수입들기름-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) { await deleteDoc(doc(db, 'rawMaterialLedger', ENTRY_ID)); console.log('✅ 입고 줄 삭제'); process.exit(0); }

const [items, led] = await Promise.all([load('items'), load('rawMaterialLedger')]);
const h = items.find((i: any) => i.name === MATERIAL && !i.archived);
const rows = led.filter((e: any) => String(e.material) === MATERIAL);
const bal = Math.round(ledgerBalanceKg(rows as any, h.density ?? 1) * 1000) / 1000;
const lot = lotRemainingKg(h.lots);
const need = Math.round((lot - bal) * 1000) / 1000;
const date = new Date().toISOString().slice(0, 10);

console.log(`\n═══ ${APPLY ? '🔴 적용(--apply)' : '🟢 미리보기(dry)'} ═══\n`);
console.log(`   원장 잔량 ${bal}kg   로트 잔량 ${lot}kg`);
console.log(`   → 입고 ${need}kg 한 줄 추가하면 원장이 ${Math.round((bal + need) * 1000) / 1000}kg = 로트\n`);
console.log(`   ${date}  입고 ${need}kg  "원장 맞춤 (매입 미기록분)"  type=manual`);
console.log(`\n되돌리기: npx tsx scripts/fix-suip-ledger-to-zero.mts --undo`);
if (!APPLY) { console.log(`\n적용: npx tsx scripts/fix-suip-ledger-to-zero.mts --apply`); process.exit(0); }
if (Math.abs(need) < 0.001) { console.log('\n이미 맞다 — 넣을 게 없다.'); process.exit(0); }

await setDoc(doc(db, 'rawMaterialLedger', ENTRY_ID), {
  id: ENTRY_ID, material: MATERIAL, date, received: need, used: 0,
  note: '원장 맞춤 (매입 미기록분) — 로트 대조',
  type: 'manual', unit: 'kg', createdAt: new Date().toISOString(),
});
console.log(`\n✅ 입고 ${need}kg 기록 — 원장 ${Math.round((bal + need) * 1000) / 1000}kg = 로트 ${lot}kg`);
process.exit(0);
