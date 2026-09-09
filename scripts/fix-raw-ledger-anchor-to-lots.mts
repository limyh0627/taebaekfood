// 갈려 있는 원료 5종 — **실제 원장을 로트 잔량에 맞춘다**(실사 앵커 한 줄씩).
//   기본 = --dry (미리보기, 쓰기 없음).  실제 적용 = --apply.
//   백업: scripts/fix-raw-ledger-anchor-to-lots-backup.json
//
// 사장님(2026-09-10): "그냥 로트 숫자에 맞추고 진행해. 이후에 실사로 한번 맞추면 되잖아."
//
// 어떻게 맞추나 —
//   원장에 **실사 줄(`targetKg`)** 을 하나씩 넣는다. 잔량 계산은 실사를 만나면 여태 누적을
//   버리고 그 숫자부터 다시 센다(`rawLedgerBalance.applyLedgerRow` — 앵커).
//   그래서 이 한 줄이면 원장 잔량이 로트 합과 같아진다.
//
//   **로트와 재고(`items`)는 안 건드린다.** 로트가 기준이니까.
//   `received`/`used` 는 0 이라 기간별 입고·사용 합계도 안 움직인다(앱의 실사와 같은 모양).
//
// 왜 갈렸었나 — 원장과 로트를 **따로 쓰기 때문**이다. 그걸 한 트랜잭션으로 묶는 일이
//   docs/원료실제원장-로트-원자화-설계.md 이고, 이 정정은 그 이관(4단계) 전에 출발선을
//   맞춰 두는 것이다. 어느 쪽이 맞는지는 코드가 못 정한다 — 사장님이 로트로 정하셨다.
//
// 손대지 않는 것 —
//   풍회 깻묵(`raw-깻묵-punghoe`)은 원장 0 · 로트 0 인데 `items.stock` 만 8,000 이다.
//   원장과 로트는 이미 같아서 이 스크립트의 대상이 아니다. 재고 8,000 을 0 으로 지우는 건
//   **실물 확인 없이 할 일이 아니다** — 다음 실사에서 정한다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc, writeBatch } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync } from 'node:fs';
import { baseRawName, DENSITY } from '../src/constants/formula';
import { ledgerBalanceKg } from '../src/shared/rawLedgerBalance';
import type { RawMaterialEntry, RawMaterialLot } from '../src/shared/types';

const APPLY = process.argv.includes('--apply');
const DATE = '2026-09-10';
const BACKUP = 'scripts/fix-raw-ledger-anchor-to-lots-backup.json';
const TOL = 0.001;

//  맞출 대상 — 열쇠(id)로 적는다. 이름으로 적으면 이름이 바뀌는 순간 엉뚱한 걸 건드린다.
const 대상 = [
  'raw-볶음참깨', 'raw-통깨참기름', 'raw-볶음검정참깨', 'raw-깨분참기름', 'raw-수입들기름',
];

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

const ledger = (await getDocs(collection(db, 'rawMaterialLedger')))
  .docs.map(d => ({ id: d.id, ...d.data() } as RawMaterialEntry));

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const 계획: { rawItemId: string; material: string; companyId: string; 원장: number; 로트: number; entryId: string }[] = [];

for (const rawItemId of 대상) {
  const snap = await getDoc(doc(db, 'items', rawItemId));
  if (!snap.exists()) throw new Error(`품목이 없다: ${rawItemId}`);
  const d = snap.data() as { name?: string; companyId?: string; lots?: RawMaterialLot[] };

  const material = baseRawName(d.name ?? '');
  const companyId = d.companyId ?? 'taebaek';
  const 로트 = r3((d.lots ?? []).reduce((a, l) => a + Number(l.kgRemaining ?? 0), 0));

  //  그 품목의 원장 줄 — **열쇠로** 모은다(이름이 어긋난 옛 줄은 이미 열쇠를 채워 뒀다).
  const mine = ledger.filter(e => (e.rawItemId ?? '') === rawItemId);
  const 원장 = r3(ledgerBalanceKg(mine, DENSITY[material] ?? 1));

  const entryId = `rm-anchor-${rawItemId}-${DATE.replace(/-/g, '')}`;
  console.log(`${material.padEnd(10)} (${rawItemId})`);
  console.log(`   원장 ${String(원장).padStart(10)}  →  로트 ${String(로트).padStart(10)}   (${r3(로트 - 원장) > 0 ? '+' : ''}${r3(로트 - 원장)})   원장줄 ${mine.length}개`);

  if (Math.abs(로트 - 원장) <= TOL) { console.log('   이미 맞다 — 건너뛴다\n'); continue; }
  if (ledger.some(e => e.id === entryId)) { console.log('   오늘 앵커가 이미 있다 — 건너뛴다\n'); continue; }
  console.log(`   → 실사 줄 추가: targetKg=${로트}  id=${entryId}\n`);
  계획.push({ rawItemId, material, companyId, 원장, 로트, entryId });
}

console.log(`맞출 것 ${계획.length}건`);

if (!APPLY) {
  console.log('\n미리보기만 했다. 실제로 바꾸려면 --apply 를 붙여라.\n');
  process.exit(0);
}
if (계획.length === 0) { console.log('\n할 일 없음.\n'); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify({
  적은때: new Date().toISOString(),
  설명: '원장을 로트에 맞춘 실사 앵커 — 되돌리려면 아래 entryId 문서들을 지우면 된다(원장 잔량이 원래대로 돌아간다)',
  넣은줄: 계획.map(p => ({ entryId: p.entryId, rawItemId: p.rawItemId, material: p.material, 이전원장잔량: p.원장, 맞춘값: p.로트 })),
}, null, 2), 'utf8');
console.log(`\n백업 → ${BACKUP}`);

const batch = writeBatch(db);
for (const p of 계획) {
  batch.set(doc(db, 'rawMaterialLedger', p.entryId), {
    id: p.entryId,
    material: p.material,
    rawItemId: p.rawItemId,
    companyId: p.companyId,
    date: DATE,
    received: 0,
    used: 0,
    targetKg: p.로트,
    note: '재고실사정정 — 로트 잔량에 맞춤',
    type: 'correction',
    unit: 'kg',
    createdAt: new Date().toISOString(),
  });
}
await batch.commit();
console.log('\n✅ 적용 완료.\n');
process.exit(0);
