// 어떤 **거래처의 전 품목**을 면세(또는 과세)로 맞춘다.
//   미리보기:  npx tsx scripts/fix-partner-all-exempt.mts C060 C024 C085
//   적용:      … --apply
//   과세로:    … --과세
//   백업: scripts/fix-partner-all-exempt-backup.json
//
// 왜 (2026-09-10 사장님) — "거래처별로 달라. 아까 기름류가 다 과세라고 했던 것도 틀리네.
//   일성 동일 홍인은 일단 전 품목 다 면세야."
//
//   **과세/면세는 품목이 아니라 거래처가 가른다.** 앞서 "기름은 과세" 처럼 품목 갈래로
//   일괄 적용한 게 그래서 틀렸다. 거래처 단위로 맞추는 게 실제 업무에 맞다.
//
//   `--apply` 는 **빈칸이든 반대 값이든 전부 덮는다.** 사장님이 "전 품목 다" 라고 못박은
//   거래처에만 쓴다. 덮은 값은 백업에 `전` 으로 남는다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const 목표: '과세' | '면세' = process.argv.includes('--과세') ? '과세' : '면세';
const BACKUP = 'scripts/fix-partner-all-exempt-backup.json';
const ids = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (ids.length === 0) { console.error('거래처 id 를 넘겨라. 예: C060 C024 C085'); process.exit(1); }

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [pi, items, partners] = await Promise.all([load('partner_item'), load('items'), load('partners')]);
const byId = new Map(items.map((i: any) => [i.id, i]));
const 거래처 = new Map(partners.map((p: any) => [p.id, p.name]));

console.log(`\n═══ ${APPLY ? `🔴 실제 적용 — 전부 ${목표}` : `🟢 미리보기(dry) — 전부 ${목표}`} ═══\n`);
for (const id of ids) console.log(`   대상: ${거래처.get(id) ?? '(이름 못 찾음)'}  (${id})`);

const 바꿀것: any[] = [];
for (const p of pi) {
  if (!ids.includes(p.partnerId)) continue;
  if (!(Number(p.price ?? 0) > 0) || !p.itemId) continue;
  if (p.taxType === 목표) continue;                      // 이미 맞다
  바꿀것.push({
    id: p.id,
    거래처: String(거래처.get(p.partnerId) ?? p.partnerId),
    품목: String(byId.get(p.itemId)?.name ?? p.itemId),
    방향: p.Direction === 'in' ? '매입' : '매출',
    단가: p.price, 전: p.taxType ?? null,
  });
}

console.log(`\n바꿀 것 ${바꿀것.length}건`);
for (const r of 바꿀것) {
  console.log(`   ${r.거래처.slice(0, 12).padEnd(12)} ${r.품목.slice(0, 30).padEnd(30)} ${r.방향} ${String(r.단가).padStart(9)}  ${r.전 ?? '(빈칸)'} → ${목표}`);
}

if (!APPLY) { console.log('\n미리보기만 했다. 실제로 바꾸려면 --apply 를 붙여라.\n'); process.exit(0); }
if (바꿀것.length === 0) { console.log('\n할 일 없음.\n'); process.exit(0); }
if (existsSync(BACKUP)) throw new Error(`기존 백업이 있다. 먼저 확인하라: ${BACKUP}`);

writeFileSync(BACKUP, JSON.stringify({
  적은때: new Date().toISOString(),
  설명: `거래처 전 품목을 ${목표} 로 — 되돌리려면 각 id 의 taxType 을 \`전\` 값으로 되쓴다(null 이면 지운다)`,
  거래처: ids.map(id => ({ id, name: 거래처.get(id) ?? null })),
  바꾼것: 바꿀것,
}, null, 2), 'utf8');
console.log(`\n백업 → ${BACKUP}`);

const batch = writeBatch(db);
for (const r of 바꿀것) batch.update(doc(db, 'partner_item', r.id), { taxType: 목표 });
await batch.commit();
console.log(`\n✅ ${바꿀것.length}건 ${목표} 로 맞췄다.\n`);
process.exit(0);
