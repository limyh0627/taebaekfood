// 품목에서 **과세·면세(items.taxType)** 를 걷어낸다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// **왜** (2026-09-06 사장님: "품목에 과세 면세 정보가 없는게 맞는거 같다니까
//        그냥 거래처-품목 연결 테이블에 있으면 되는거 아니야?")
//
// 맞다. 이 값이 하던 일은 둘이었다:
//   ① 원가에 ×1.1 얹기 — 걷어냈다. 면세 매입엔 낸 부가세가 없어 셈 자체가 틀렸다.
//   ② "이 판매가에 부가세가 붙었나" — 그건 **거래처마다 다르다**. `partner_item.taxType` 이 안다.
// 남겨 두면 다음 사람이 ②를 여기서 읽는다 — 실제로 화면 네 곳이 그러고 있었다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, deleteField } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-drop-item-taxtype-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8')) as { id: string; name: string; taxType: string }[];
  for (const p of prev) await updateDoc(doc(db, 'items', p.id), { taxType: p.taxType });
  console.log(`되돌렸다 — ${prev.length}개 복구`);
  process.exit(0);
}

const items = (await getDocs(collection(db, 'items'))).docs.map(d => ({ id: d.id, ...(d.data() as any) }));
const 있는것 = items.filter(i => i.taxType === '과세' || i.taxType === '면세');
const 면세 = 있는것.filter(i => i.taxType === '면세');
console.log(`품목 ${items.length} / taxType 이 있는 것 ${있는것.length} (면세 ${면세.length}, 과세 ${있는것.length - 면세.length})`);
console.log('\n면세로 찍혀 있던 것 — 매입 단가가 부가세 없는 값이라는 표시였다:');
면세.forEach(i => console.log(`  ${String(i.type).padEnd(12)} ${i.name}`));
console.log('\n※ 앞으로 이 구분은 매입처–품목 연결(partner_item, Direction=in)의 taxType 이 쥔다.');

if (!APPLY) { console.log('\n--dry (기본). 적용하려면 --apply'); process.exit(0); }
if (existsSync(BACKUP)) { console.error(`\n이미 적용했다(${BACKUP}). 다시 하려면 --undo 먼저.`); process.exit(1); }

writeFileSync(BACKUP, JSON.stringify(있는것.map(i => ({ id: i.id, name: i.name, taxType: i.taxType })), null, 2), 'utf8');
for (const i of 있는것) await updateDoc(doc(db, 'items', i.id), { taxType: deleteField() });
console.log(`\n✅ 품목 ${있는것.length}개에서 taxType 을 지웠다. 되돌리려면 --undo`);
process.exit(0);
