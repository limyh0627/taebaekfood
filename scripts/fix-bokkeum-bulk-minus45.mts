// 볶음참깨 벌크(자루) 재고를 -45kg로 못 박는다.
//   기본 = --dry (미리보기, 쓰기 없음).  실제 적용 = --apply.
//
// 왜 -45인가 — `lotsAreTotal` 원료는 두 숫자가 따로다:
//   로트 합계 201kg  = 통틀어 몇 kg (자루 + 낱개 + 박스)
//   items.stock     = 그중 자루로 남은 것
// 통합 대상은 낱개 1kg · 10개입 · 20개입 셋(200g 페트는 별개 BOM이라 제외):
//   낱개 -4 × 1 + 10개입 -1 × 10 + 20개입 13 × 20 = 246kg
//   자루 = 201 - 246 = -45kg
// 로트는 안 건드린다 — 통합값 201은 그대로 두고 자루 칸만 맞춘다.
//
// ⚠️ shared/services/firebaseService.ts의 lotsAreTotal 가드가 **배포된 뒤에** 돌릴 것.
//    배포 전 코드는 로트를 건드리는 순간 stock을 로트합(201)으로 도로 덮는다.
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const APPLY = process.argv.includes('--apply');
const ITEM_ID = 'raw-볶음참깨';
const BULK_KG = -45;

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

const ref = doc(db, 'items', ITEM_ID);
const snap = await getDoc(ref);
if (!snap.exists()) { console.error(`품목 ${ITEM_ID} 없음 — 중단`); process.exit(1); }
const cur = snap.data() as any;
const lots = Array.isArray(cur.lots) ? cur.lots : [];
const lotSum = lots.filter((l: any) => l.status === 'active').reduce((s: number, l: any) => s + (l.kgRemaining ?? 0), 0);

console.log(`품목    ${cur.name} [${ITEM_ID}]  type=${cur.type} subtype='${cur.subtype ?? ''}'`);
console.log(`현재    stock=${cur.stock} kg   로트 ${lots.length}개 합 ${Math.round(lotSum * 10) / 10} kg   lotsAreTotal=${cur.lotsAreTotal}`);
console.log(`변경 후 stock=${BULK_KG} kg   (로트는 그대로 — 통합값 ${Math.round(lotSum * 10) / 10}kg 유지)`);
console.log(`\n되돌리기: stock을 ${cur.stock} 로 되돌리면 된다.`);

if (!APPLY) { console.log(`\n적용하려면: npx tsx scripts/fix-bokkeum-bulk-minus45.mts --apply`); process.exit(0); }

await updateDoc(ref, { stock: BULK_KG });
const after = (await getDoc(ref)).data() as any;
console.log(`\n✅ 적용됨 — stock=${after.stock} (로트 ${(after.lots ?? []).length}개 그대로)`);
process.exit(0);
