// 실제 원장(rawMaterialLedger)에 **열쇠**를 채운다 — companyId + rawItemId.
//   기본 = --dry (미리보기, 쓰기 없음).  실제 적용 = --apply.
//   적용 전 값은 scripts/fix-raw-ledger-keys-backup.json 에 통째로 남긴다.
//
// 왜 —
//   원장에는 **품목 id 가 아예 없었다.** `material` 이라는 이름만 있고 companyId 조차
//   726줄 중 713줄에 없었다. 그래서 원료를 고르는 자리 열한 곳이 이름을 견줘 첫 항목을
//   집는다. 이름이 바뀌면 연결이 소리 없이 끊기고, 이름이 겹치면 남의 회사 것을 집는다.
//   (인수인계.md "연결은 이름이 아니라 열쇠(id)로 건다")
//
// 무엇을 채우나 (2026-09-09 조사, 726줄) —
//   669줄  원료명에 홀더가 하나뿐 → 바로 정해진다
//     3줄  홀더 둘인데 companyId 가 있어 갈린다
//    53줄  홀더 둘(태백·풍회)인데 companyId 가 없다 — 참깨 51 · 깻묵 2
//            → **태백으로 채운다.** 지금 앱이 이미 그렇게 읽고 있고(companyId 없으면 태백),
//              그 값으로 로트가 정확히 맞는다(태백 참깨 180/180, 깻묵 3000/3000).
//              풍회 쪽은 둘 다 0 이라 가져갈 것이 없다. 즉 **지금 동작을 그대로 굳히는 것**이다.
//     1줄  material='검정깨' — 그 이름의 홀더가 없다.
//            홀더는 이름 '검정참깨' · **id `raw-검정깨`** 다. 원장에 이름 대신 **id 조각**이
//            적힌 것이다. 같은 날(8-07)·같은 80kg·같은 '재고실사정정' 이고, 그 실사가 만든
//            로트(260807-01, 잔량 80)가 홀더에 그대로 있다. → `raw-검정깨` 에 붙인다.
//            이 한 줄이 붙으면 검정참깨의 −80 갈림이 사라진다.
//
//   `material` 은 **안 건드린다.** 그건 보여주기용 스냅샷이고, 서류가 이름으로 묶는 자리가
//   아직 남아 있어 지금 바꾸면 그쪽이 흔들린다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync } from 'node:fs';
import { baseRawName } from '../src/constants/formula';

const APPLY = process.argv.includes('--apply');
const BACKUP = 'scripts/fix-raw-ledger-keys-backup.json';
//  이름이 안 맞아 홀더를 못 찾는 줄 — 사람이 확인해 정한 것만 여기 적는다.
const 이름보정: Record<string, string> = { 검정깨: 'raw-검정깨' };

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [items, ledger] = await Promise.all([load('items'), load('rawMaterialLedger')]);

console.log(`\n═══ ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);

const isHolder = (i: any) => (i.type === 'raw' || (i.type === 'wip' && i.unit !== '개')) && !i.phantom && !i.archived;
const companyOf = (x: any): string => x?.companyId ?? 'taebaek';
const holders = items.filter(isHolder);
const byId = new Map(holders.map(h => [h.id, h]));

const byName = new Map<string, any[]>();
for (const h of holders) {
  const b = baseRawName(h.name ?? '');
  if (!byName.has(b)) byName.set(b, []);
  byName.get(b)!.push(h);
}

type Plan = { row: any; companyId: string; rawItemId: string; 근거: string };
const plans: Plan[] = [];
const 못정함: any[] = [];

for (const e of ledger) {
  const m = String(e.material ?? '');

  //  ① 사람이 확인해 적어 둔 이름 보정
  const fixed = 이름보정[m];
  if (fixed) {
    const h = byId.get(fixed);
    if (!h) { 못정함.push({ ...e, 왜: `보정 대상 홀더 없음: ${fixed}` }); continue; }
    plans.push({ row: e, companyId: companyOf(h), rawItemId: h.id, 근거: '이름보정' });
    continue;
  }

  const hs = byName.get(m) ?? [];
  if (hs.length === 0) { 못정함.push({ ...e, 왜: '그 이름의 홀더가 없다' }); continue; }

  //  ② 홀더가 하나뿐이면 바로
  if (hs.length === 1) {
    plans.push({ row: e, companyId: companyOf(hs[0]), rawItemId: hs[0].id, 근거: '홀더 하나' });
    continue;
  }

  //  ③ 홀더가 둘 이상 — companyId 로 갈린다
  const want = companyOf(e);   // 없으면 태백(지금 앱이 읽는 그대로)
  const hit = hs.filter(h => companyOf(h) === want);
  if (hit.length === 1) {
    plans.push({ row: e, companyId: want, rawItemId: hit[0].id, 근거: e.companyId ? '회사로 갈림' : '회사없음→태백' });
    continue;
  }
  못정함.push({ ...e, 왜: `홀더 ${hs.length}개, ${want} 로 못 좁힘` });
}

//  이미 옳게 채워져 있는 줄은 건너뛴다 — 다시 돌려도 안전하게.
const 바꿀것 = plans.filter(p => p.row.companyId !== p.companyId || p.row.rawItemId !== p.rawItemId);

const 근거별 = new Map<string, number>();
for (const p of plans) 근거별.set(p.근거, (근거별.get(p.근거) ?? 0) + 1);

console.log(`원장 ${ledger.length}줄`);
for (const [k, v] of 근거별) console.log(`  ${k.padEnd(14)} ${v}줄`);
console.log(`  ${'못 정함'.padEnd(14)} ${못정함.length}줄`);
console.log(`\n실제로 바꿀 줄: ${바꿀것.length}  (나머지는 이미 맞다)`);

//  회사·품목별로 몇 줄이 붙는지 — 눈으로 확인할 표
const 묶음 = new Map<string, number>();
for (const p of 바꿀것) {
  const k = `${p.companyId} / ${byId.get(p.rawItemId)?.name ?? '?'} (${p.rawItemId})`;
  묶음.set(k, (묶음.get(k) ?? 0) + 1);
}
console.log('\n── 붙는 곳 ──');
for (const [k, v] of [...묶음.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}줄  ${k}`);

if (못정함.length) {
  console.log('\n⚠ 못 정한 줄 — 손대지 않는다');
  for (const e of 못정함) console.log(`  ${e.date}  material=${e.material}  ${e.왜}  id=${e.id}`);
}

if (!APPLY) {
  console.log('\n미리보기만 했다. 실제로 바꾸려면 --apply 를 붙여라.\n');
  process.exit(0);
}

writeFileSync(BACKUP, JSON.stringify({
  적은때: new Date().toISOString(),
  설명: '원장에 companyId·rawItemId 채우기 — 적용 전 원본(바꾼 줄만)',
  before: 바꿀것.map(p => ({
    id: p.row.id, material: p.row.material,
    companyId: p.row.companyId ?? null, rawItemId: p.row.rawItemId ?? null,
  })),
}, null, 2), 'utf8');
console.log(`\n백업 → ${BACKUP}`);

//  Firestore 배치는 500개 한도
for (let i = 0; i < 바꿀것.length; i += 400) {
  const batch = writeBatch(db);
  for (const p of 바꿀것.slice(i, i + 400)) {
    batch.update(doc(db, 'rawMaterialLedger', p.row.id), { companyId: p.companyId, rawItemId: p.rawItemId });
  }
  await batch.commit();
  console.log(`  ${Math.min(i + 400, 바꿀것.length)} / ${바꿀것.length}`);
}
console.log('\n✅ 적용 완료.\n');
process.exit(0);
