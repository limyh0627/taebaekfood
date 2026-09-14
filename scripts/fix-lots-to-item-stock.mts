// 로트·원료상태를 **품목 재고(`items.stock`)에 맞춘다.**
//   미리보기  npx tsx scripts/fix-lots-to-item-stock.mts
//   적용      … --apply       되돌리기  … --undo
//   백업: scripts/fix-lots-to-item-stock-backup.json
//
// 왜 (2026-09-14 사장님) — "지금 로트랑 item stock이랑 틀어져 있는 경우 있나" → 8건이 갈렸다.
//   → "음수인건 상관없으니까 품목재고에다 맞춰놔"
//
//   2026-09-11 에는 **반대로** 맞췄다(`fix-raw-state-to-lots.mts`, 로트 기준). 그때는
//   `items.stock` 이 거의 다 로트와 같았고 상태만 떠 있었다. 이번엔 사장님이 재고 기준으로
//   정하셨다 — **기준은 사장님이 정한다.**
//
// 무엇을 고치나 — **원료(items.lots 가 kg 로트인 것)만.** 둘 다 맞춘다:
//   ① `items.lots` 잔량 합 → `items.stock`   (모자라면 '재고맞춤' 로트를 얹고, 남으면 로트에서 뺀다)
//   ② `rawInventories.stockKg` → `items.stock`  (실사 명령. 원장 줄도 같이 남는다)
//
// 완제품 로트(볶음참깨/1kg 박스·낱개)는 **여기서 안 건드린다** — 로트가 개수(`qtyRemaining`)와
// kg 두 축이라 셈이 다르고, `lotsAreTotal` 품목은 설계상 stock 을 로트로 안 덮는다.
// 잘못 손대면 박스·낱개가 또 갈린다. 그건 따로 본다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { buildReceiveLot, deductFromLots } from '../src/shared/lotUtils';
import { executeRawInventoryCommand } from '../src/shared/services/rawInventoryService';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const UNDO = args.includes('--undo');
const BACKUP = 'scripts/fix-lots-to-item-stock-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const 반 = (n: number) => Math.round(n * 1000) / 1000;

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error(`\n백업이 없다(${BACKUP}).\n`); process.exit(1); }
  const 백업본: Record<string, any> = JSON.parse(readFileSync(BACKUP, 'utf-8'));
  for (const [itemId, lots] of Object.entries(백업본)) await updateDoc(doc(db, 'items', itemId), { lots });
  console.log(`\n품목 ${Object.keys(백업본).length}개의 로트를 백업 상태로 되돌렸다.`);
  console.log('⚠ 원료상태(실사)는 되돌리지 않는다 — 실사는 지우지 않고 반대 실사를 다시 넣는 것이 규칙이다.\n');
  process.exit(0);
}

const [items, raws] = await Promise.all([load('items'), load('rawInventories')]);
console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

/** kg 로트를 쓰는 원료인가 — 완제품 로트(개수 축)는 뺀다. */
const kg로트 = (i: any) => {
  const lots = Array.isArray(i.lots) ? i.lots : [];
  return lots.length > 0 && !lots.some((l: any) => l.qtyRemaining !== undefined);
};
const 로트합 = (i: any) => 반((Array.isArray(i.lots) ? i.lots : [])
  .filter((l: any) => l?.status !== 'void' && l?.status !== 'deleted')
  .reduce((s: number, l: any) => s + (Number(l.kgRemaining) || 0), 0));

const DIAG = 'scripts/diag-raw-ledger-lots.json';
if (!existsSync(DIAG)) { console.error('먼저 진단을 돌린다: npx tsx scripts/diag-raw-ledger-lots.mts'); process.exit(1); }
const 진단 = JSON.parse(readFileSync(DIAG, 'utf-8'));
const 홀더별: any[] = 진단.홀더별 ?? [];
console.log(`진단 ${진단.조사시각} 기준 · 홀더 ${홀더별.length}개
`);

const 백업: Record<string, any> = {};
const 할일: { item: any; 목표: number; 로트차: number; 상태차: number; 원장차: number; raw?: any }[] = [];

for (const h of 홀더별) {
  //  lotsAreTotal 원료는 로트가 벌크+제품 합이라 축이 다르다(볶음참깨는 제품로트가 -300).
  //  설계상 stock 을 로트로 안 덮으므로 여기서 건드리지 않는다 — 따로 정리한다.
  if (h.lotsAreTotal) { console.log(`건너뜀(축이 다름): ${h.company} ${h.itemName}`); continue; }
  const it = items.find(x => x.id === h.rawItemId);
  if (!it) continue;
  const 목표 = 반(Number(it.stock ?? 0));
  const raw = raws.find(r => r.rawItemId === it.id);
  const 로트차 = kg로트(it) ? 반(목표 - 로트합(it)) : 0;
  const 상태차 = raw ? 반(목표 - Number(raw.stockKg ?? 0)) : 0;
  const 원장차 = 반(목표 - Number(h.원장잔량 ?? 0));
  if (Math.abs(로트차) < 0.001 && Math.abs(상태차) < 0.001 && Math.abs(원장차) < 0.001) continue;
  할일.push({ item: it, 목표, 로트차, 상태차, 원장차, raw });
}

if (!할일.length) { console.log('갈린 원료가 없다.\n'); process.exit(0); }

for (const t of 할일) {
  console.log(`${String(t.item.name).padEnd(18)} | 품목재고 ${String(t.목표).padStart(9)}${t.item.unit ?? ''}`);
  if (Math.abs(t.로트차) >= 0.001) console.log(`   로트 합  ${String(로트합(t.item)).padStart(9)} → ${t.목표}   (${t.로트차 > 0 ? '+' : ''}${t.로트차})`);
  if (Math.abs(t.원장차) >= 0.001) console.log(`   원장 잔량 ${반(t.목표 - t.원장차)} → ${t.목표}   (${t.원장차 > 0 ? '+' : ''}${t.원장차})  실사 앵커로 끊는다`);
  if (Math.abs(t.상태차) >= 0.001) console.log(`   원료상태 ${String(반(Number(t.raw.stockKg ?? 0))).padStart(9)} → ${t.목표}   (${t.상태차 > 0 ? '+' : ''}${t.상태차})  [${t.raw.companyId ?? '-'}] 실사 명령`);
}

const 완제품갈림 = items.filter(i => {
  const lots = (Array.isArray(i.lots) ? i.lots : []).filter((l: any) => l?.status !== 'void');
  if (!lots.length || !lots.some((l: any) => l.qtyRemaining !== undefined)) return false;
  const 합 = 반(lots.reduce((s: number, l: any) => s + (Number(l.qtyRemaining) || 0), 0));
  return Math.abs(합 - 반(Number(i.stock ?? 0))) > 0.001;
});
if (완제품갈림.length) {
  console.log(`\n⚠ 완제품 로트가 갈린 품목 ${완제품갈림.length}개 — **여기서는 안 건드린다**(축이 다르다):`);
  for (const i of 완제품갈림) console.log(`   ${i.name} (${i.id})  재고 ${i.stock}${i.unit ?? ''}`);
}

if (!APPLY) { console.log('\n미리보기였다. 적용하려면 --apply.\n'); process.exit(0); }

if (existsSync(BACKUP)) { console.error(`\n백업 파일이 이미 있다(${BACKUP}). 옮기고 다시 실행한다.\n`); process.exit(1); }
for (const t of 할일) 백업[t.item.id] = t.item.lots ?? [];
writeFileSync(BACKUP, JSON.stringify(백업, null, 1), 'utf-8');
console.log(`\n백업 ${Object.keys(백업).length}개 → ${BACKUP}`);

const 오늘 = new Date().toISOString().slice(0, 10);
for (const t of 할일) {
  //  ① 로트를 재고에 맞춘다 — 모자라면 '재고맞춤' 로트를 얹고, 남으면 앞에서부터 뺀다
  if (Math.abs(t.로트차) >= 0.001) {
    let 다음 = [...(t.item.lots ?? [])];
    if (t.로트차 > 0) {
      /*  Firestore 는 `undefined` 를 못 받는다 — `buildReceiveLot` 이 안 채운 칸
          (supplierId·packageKg 등)이 그대로 오면 쓰기가 통째로 실패한다(2026-09-14 깨분에서 겪음). */
      const 새로트 = buildReceiveLot({ material: t.item.name, supplierName: '재고맞춤', qtyIn: 0, kgIn: t.로트차, receivedDate: 오늘 });
      다음 = [...다음, Object.fromEntries(Object.entries(새로트).filter(([, v]) => v !== undefined))];
    } else {
      다음 = deductFromLots(다음, -t.로트차).lots;
    }
    await updateDoc(doc(db, 'items', t.item.id), { lots: 다음 });
    console.log(`  ${t.item.name}: 로트 맞춤 (${t.로트차 > 0 ? '+' : ''}${t.로트차})`);
  }
  //  ② 원료상태는 **실사 명령**으로 — 상태·원장·items 가 한 트랜잭션에서 같이 움직인다.
  //     손으로 문서를 고치면 또 갈린다(그게 이 사달의 뿌리다).
  if (t.raw && (Math.abs(t.상태차) >= 0.001 || Math.abs(t.원장차) >= 0.001)) {
    const opId = `fix-stock-align-${t.item.id}-${Date.now()}`;
    /*  **`as never` 로 타입 검사를 가리지 않는다** — 2026-09-14 에 `type:` 으로 잘못 적고
        그 캐스팅 때문에 못 잡았다. 명령이 통째로 거절돼 아무것도 안 들어갔는데 화면에는
        "실사 → …" 이 찍혔다(결과를 안 봤기 때문). 둘 다 고친다. */
    const 결과 = await executeRawInventoryCommand({
      kind: 'stocktake',
      targetKg: t.목표,
      operationId: opId,
      companyId: t.raw.companyId,
      rawItemId: t.item.id,
      materialSnapshot: t.item.name,
      effectiveAt: new Date().toISOString(),
      source: { type: 'stocktake', id: opId },
      actorName: '재고 맞춤(스크립트)',
    }, { db });
    if (결과.status !== 'applied') { console.error(`  ${t.item.name}: 실사 거절 — ${결과.status} ${JSON.stringify((결과 as any).reason ?? '')}`); continue; }
    console.log(`  ${t.item.name}: 원료상태 실사 → ${t.목표}`);
  }
}
console.log('\n끝. 되돌리기는 --undo (로트만). 원료상태는 반대 실사를 다시 넣는다.\n');
process.exit(0);
