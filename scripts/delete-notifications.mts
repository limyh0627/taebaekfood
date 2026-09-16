// **옛 알림을 전부 지운다.**
//   미리보기  npx tsx scripts/delete-notifications.mts
//   적용      … --apply          되돌리기  … --undo
//   백업: scripts/delete-notifications-backup.json
//
// 왜 (2026-09-16 사장님) — "알림은 기존꺼 다 삭제해".
//
// 회사별 권한을 규칙에서 강제하려면 알림에도 `companyId` 가 있어야 하는데, 옛 알림
// 780건에는 원본 id(`orderId`·`statementId`)도 수신자 id 도 안 붙어 있어 **어느 회사 것인지
// 알 길이 없다.** 전부 태백으로 몰아 찍을 수도 있지만, 알림은 이미 지나간 것이라
// 지우는 쪽이 정직하다 — 잘못 찍어 두면 풍회 직원 화면에 태백 알림이 뜬다.
//
// **지울 것을 열거한다**(남길 것이 아니라): `notifications` 컬렉션의 **모든 문서**.
// 그것뿐이다. 알림이 가리키던 주문·전표·대화는 안 건드린다 — 알림은 그것들의 **사본**이지
// 원본이 아니다. 읽었든 안 읽었든 구별 없이 지운다.
//
// 앞으로 만드는 알림에 회사를 붙이는 일은 **코드 쪽**이 한다(이 스크립트가 아니다).
import { adminDb, 실행모드 } from './_admin.mts';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const { APPLY, UNDO } = 실행모드();
//  **백업은 저장소 밖이다**(2026-09-16 코덱스 검수 8번) — `로컬전용/` 은 gitignore 된다.
const BACKUP = '로컬전용/백업/delete-notifications-backup.json';
const db = adminDb();

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error(`\n백업이 없다(${BACKUP}).\n`); process.exit(1); }
  const b = JSON.parse(readFileSync(BACKUP, 'utf-8')) as Record<string, Record<string, unknown>>;
  const 목록 = Object.entries(b);
  for (let i = 0; i < 목록.length; i += 400) {
    const batch = db.batch();
    for (const [id, 것] of 목록.slice(i, i + 400)) batch.set(db.collection('notifications').doc(id), 것);
    await batch.commit();
  }
  console.log(`\n알림 ${목록.length}건을 되살렸다.\n`);
  process.exit(0);
}

const docs = (await db.collection('notifications').get()).docs;

console.log(`\n═══ ${APPLY ? '🔴 실제 삭제(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);
console.log(`지울 것 — notifications 문서 ${docs.length}건 (전부)`);

//  무엇이 지워지는지 갈래별로 보여 준다 — 숫자만 보고 누르게 두지 않는다.
const 갈래: Record<string, number> = {};
let 안읽음 = 0;
for (const d of docs) {
  const x = d.data() as Record<string, unknown>;
  갈래[String(x.type ?? x.kind ?? '(갈래없음)')] = (갈래[String(x.type ?? x.kind ?? '(갈래없음)')] ?? 0) + 1;
  if (x.read === false || x.isRead === false) 안읽음++;
}
for (const [k, v] of Object.entries(갈래).sort((a, b) => b[1] - a[1])) console.log(`     ${k.padEnd(24)} ${v}건`);
console.log(`\n  그중 안 읽은 것 ${안읽음}건 — **구별 없이 지운다**`);
console.log('\n안 건드리는 것: 주문 · 전표 · 대화 · 그 밖 모든 컬렉션');
console.log('  (알림은 그것들의 사본이지 원본이 아니다)');

if (!APPLY) { console.log('\n미리보기였다. 지우려면 --apply.\n'); process.exit(0); }

if (existsSync(BACKUP)) { console.error(`\n이미 백업이 있다(${BACKUP}) — 옮기고 다시 실행한다.\n`); process.exit(1); }
const 백업: Record<string, unknown> = {};
for (const d of docs) 백업[d.id] = d.data();
writeFileSync(BACKUP, JSON.stringify(백업, null, 1), 'utf-8');
console.log(`\n백업 ${docs.length}건 → ${BACKUP}`);

for (let i = 0; i < docs.length; i += 400) {
  const batch = db.batch();
  for (const d of docs.slice(i, i + 400)) batch.delete(d.ref);
  await batch.commit();
  console.log(`  ${Math.min(i + 400, docs.length)} / ${docs.length}`);
}

//  **다시 읽어 확인한다** — 썼다고 믿지 않는다.
const 남음 = (await db.collection('notifications').get()).size;
console.log(`\n${남음 === 0 ? '✅' : '⚠'} 남은 알림 ${남음}건. 되돌리려면 --undo.\n`);
process.exit(0);
