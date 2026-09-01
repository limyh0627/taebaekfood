// 전표 템플릿에 회사를 단다 — 거래처·금액이 박힌 것만.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 회사를 안 단 템플릿은 **모든 회사에서 보인다**(공용 뼈대). 계정만 붙은 것들 —
// 카드대금·수금·지불·인출금·운임처럼 어느 회사든 그대로 쓰는 것들이다.
//
// 거래처나 금액이 박힌 것은 그 회사 것이다. 태백 임대인·수협·한전이 물린 템플릿이
// 풍회 화면에 뜨면, 그걸로 끊은 전표가 엉뚱한 거래처에 붙는다.
// 지금 있는 건 전부 태백에서 만든 것이라 'taebaek'을 단다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-template-company-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  for (const t of JSON.parse(readFileSync(BACKUP, 'utf8')) as any[]) {
    const { id, ...rest } = t; await setDoc(doc(db, 'fixedCostTemplates', id), rest);
  }
  console.log('✅ 복원'); process.exit(0);
}

const tpls = await load('fixedCostTemplates');
/** 그 회사 것인가 — 거래처가 붙었거나, 금액이 박혔거나, 자동발행을 켰거나 */
const isOwned = (t: any) =>
  !!t.partnerId || Number(t.amount ?? 0) > 0 || !!t.autoIssue
  || Number(t.principal ?? 0) > 0 || Number(t.insCorp ?? 0) > 0 || Number(t.gross ?? 0) > 0;

const own = tpls.filter(t => !t.companyId && isOwned(t));
const shared = tpls.filter(t => !t.companyId && !isOwned(t));

console.log(`── 태백 것으로 달 템플릿 (${own.length}) ──`);
for (const t of own) console.log(`   ${String(t.name).padEnd(16)} ${String(t.partnerName ?? '').padEnd(10)} ${Number(t.amount ?? 0).toLocaleString().padStart(11)}  ${t.autoIssue ? '자동' : ''}`);
console.log(`\n── 공용으로 둘 뼈대 (${shared.length}) ──`);
console.log('   ' + shared.map(t => t.name).join(' · '));
const already = tpls.filter(t => t.companyId);
if (already.length) console.log(`\n이미 회사가 달린 것 ${already.length}건 — 건드리지 않는다`);

if (!own.length) { console.log('\n달 게 없다.'); process.exit(0); }
if (!APPLY) { console.log('\n(--dry) 적용하려면 --apply'); process.exit(0); }
writeFileSync(BACKUP, JSON.stringify(own, null, 2), 'utf8');
for (const t of own) { const { id, ...rest } = t; await setDoc(doc(db, 'fixedCostTemplates', id), { ...rest, companyId: 'taebaek' }); }
console.log(`\n✅ ${own.length}건에 taebaek을 달았다.  되돌리기: npx tsx scripts/fix-template-company.mts --undo`);
process.exit(0);
