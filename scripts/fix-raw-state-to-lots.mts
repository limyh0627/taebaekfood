// 원료 원자화 상태(`rawInventories`)를 **로트 잔량에 맞춘다** — 실사 명령으로.
//   기본 = --dry (미리보기).  적용 = --apply.
//   백업: scripts/fix-raw-state-to-lots-backup.json
//
// 왜 (2026-09-11 사장님) — 은진상회 주문을 작업완료로 못 보냈다. 주문 문서에 그 까닭이
//   그대로 남아 있었다:
//
//     inventoryOperation.state = "failed"
//     원료 차감 거절: STOCK_MISMATCH
//     품목 재고와 원료 상태가 어긋나 있다: items.stock 1511.061 ≠ 1569.106 (taebaek__raw-깨분참기름)
//
//   서비스는 `items.stock` 과 상태(`rawInventories.stockKg`)가 **1kg 넘게 어긋나면 아예
//   거절한다**(`MIRROR_TOLERANCE_KG`). 안전장치가 제 일을 한 것이고, 어긋난 것을 맞춰야 풀린다.
//
// 어느 쪽에 맞추나 — **로트**다(사장님: "로트합에 다 갖다 맞춰").
//   실측해 보면 `items.stock` 은 거의 다 이미 로트 합과 같고, 혼자 떠 있는 건 상태 쪽이다.
//   깻묵만 다르다 — 로트가 0 인데 재고가 8,000 이라, **로트를 8,000 으로 넣으라** 하셨다.
//
// 어떻게 —
//   · 깻묵: `receive` 명령으로 8,000kg 로트를 하나 세운다.
//   · 나머지: `stocktake` 명령(실사)으로 목표를 로트 합에 맞춘다.
//   **둘 다 공용 서비스(`executeRawInventoryCommand`)를 지난다** — 원장 줄·상태·`items` 가
//   한 트랜잭션에서 같이 움직인다. 손으로 문서를 고치면 또 갈린다(그게 이 사달의 뿌리다).
//
//   `lotsAreTotal` 원료(볶음참깨)는 설계상 `items.stock` 을 안 덮는다 — 그건 그대로 둔다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, existsSync } from 'node:fs';
import { executeRawInventoryCommand } from '../src/shared/services/rawInventoryService';

const APPLY = process.argv.includes('--apply');
const BACKUP = 'scripts/fix-raw-state-to-lots-backup.json';
const DATE = '2026-09-11';
const 깻묵목표 = 8000;

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [items, states] = await Promise.all([load('items'), load('rawInventories')]);

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

const 로트합 = (it: any) => Math.round((it?.lots ?? [])
  .filter((l: any) => l.status === 'active')
  .reduce((s: number, l: any) => s + Number(l.kgRemaining ?? 0), 0) * 1000) / 1000;

type 할일 = { 종류: '실사' | '깻묵로트'; stateId: string; rawItemId: string; companyId: string; 이름: string; 지금상태: number; 목표: number; 재고: number; lotsAreTotal: boolean };
const 목록: 할일[] = [];

for (const st of states) {
  const rawItemId = String(st.rawItemId ?? String(st.id).split('__')[1] ?? '');
  const companyId = String(st.companyId ?? String(st.id).split('__')[0] ?? 'taebaek');
  const it = items.find((i: any) => i.id === rawItemId);
  if (!it) { console.log(`   ⚠ 상태만 있고 품목이 없다: ${st.id}`); continue; }
  const 합 = 로트합(it);
  const 상태 = Number(st.stockKg ?? 0);
  const 재고 = Number(it.stock ?? 0);
  const 깻묵인가 = String(it.name) === '깻묵' && 합 === 0 && 재고 === 깻묵목표;
  //  깻묵은 로트를 세워야 한다. 나머지는 상태가 로트 합과 1kg 넘게 다를 때만 손댄다.
  if (!깻묵인가 && Math.abs(상태 - 합) <= 1) continue;
  목록.push({
    종류: 깻묵인가 ? '깻묵로트' : '실사',
    stateId: String(st.id), rawItemId, companyId, 이름: String(it.name),
    지금상태: 상태, 목표: 깻묵인가 ? 깻묵목표 : 합, 재고, lotsAreTotal: !!it.lotsAreTotal,
  });
}

목록.sort((a, b) => Math.abs(b.목표 - b.지금상태) - Math.abs(a.목표 - a.지금상태));
console.log(`맞출 원료 ${목록.length}개\n`);
for (const m of 목록) {
  console.log(`   ${m.종류 === '깻묵로트' ? '로트세움' : '실 사  '} ${m.이름.padEnd(12)} 상태 ${String(m.지금상태).padStart(11)} → ${String(m.목표).padStart(11)}   (items.stock ${String(m.재고).padStart(11)}${m.lotsAreTotal ? ' · lotsAreTotal 이라 stock 은 안 덮음' : ''})`);
}
console.log('\n원장에는 실사 줄이 한 개씩 남는다 — 입고·사용 합계는 안 움직인다(received/used 0).');

if (!APPLY) { console.log('\n미리보기만 했다. 실제로 맞추려면 --apply 를 붙여라.\n'); process.exit(0); }
if (목록.length === 0) { console.log('\n맞출 게 없다.\n'); process.exit(0); }
if (existsSync(BACKUP)) throw new Error(`기존 백업이 있다: ${BACKUP}`);

writeFileSync(BACKUP, JSON.stringify({
  적은때: new Date().toISOString(),
  설명: '원자화 상태를 로트 합에 맞춤 — 되돌리려면 각 상태의 stockKg 를 지금상태로 되쓰고 원장의 실사 줄을 지운다',
  맞춘것: 목록,
}, null, 2), 'utf8');
console.log(`\n백업 → ${BACKUP}`);

for (const m of 목록) {
  //  작업 번호는 **결정적**으로 짓는다 — 두 번 돌려도 한 번만 먹는다(§9 멱등).
  const operationId = `fix-state-to-lots-${m.companyId}-${m.rawItemId}-${DATE}`;
  const 공통 = {
    companyId: m.companyId as any, rawItemId: m.rawItemId, material: m.이름,
    operationId, effectiveAt: `${DATE}T23:59:59.999+09:00`, actor: '정정 스크립트',
  };
  /*  **깻묵은 두 걸음이다.**
   *
   *  `receive` 도 미러 검사(`MIRROR_TOLERANCE_KG`)를 지난다 — `items.stock 8000` 인데 상태가
   *  `0` 이라 입고부터 거절당한다. 그래서 **실사로 상태를 8,000 에 먼저 맞추고**, 그 다음
   *  로트를 세운다. 실사 뒤에는 둘이 같아져서 입고가 통과한다.
   *
   *  순서를 바꿀 수는 없다 — 로트를 먼저 세우려 해도 그 입고 자체가 막힌다. */
  const 명령들: any[] = m.종류 === '깻묵로트'
    ? [
        { ...공통, kind: 'stocktake', targetKg: m.목표 },
        { ...공통, operationId: `${operationId}-lot`, kind: 'receive', kg: m.목표, lot: { supplierName: '재고정정(로트 세움)' } },
      ]
    : [{ ...공통, kind: 'stocktake', targetKg: m.목표 }];
  for (const command of 명령들) {
    const r = await executeRawInventoryCommand(command, {
      db,
      legacy: { note: '재고정정 — 상태를 로트 잔량에 맞춤', type: command.kind === 'receive' ? 'manual' : 'correction', addedBy: '정정 스크립트' } as any,
    });
    const 표 = r.status === 'applied' ? '✅' : r.status === 'duplicate' ? '↺ 이미' : '❌';
    console.log(`  ${표} ${m.이름.padEnd(12)} ${command.kind.padEnd(9)} ${r.status}${(r as any).code ? ` ${(r as any).code} ${(r as any).message}` : ''}`);
  }
}
console.log('\n✅ 끝났다. 다시 조사해서 갈림이 남았는지 보라.\n');
process.exit(0);
