// 거래처 잔액 앵커를 박는다 — **결산 때 한 해에 한 번.**
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//   해 지정 = --year=2026 (없으면 지난해)
//
//   `partnerBalanceSnapshots/{회사}-{연도}` 에 그 해 끝의
//     ① 거래처별 받을 돈·갚을 돈
//     ② 그날 아직 안 끝난 전표와 남은 금액
//   을 적어 둔다. 그 뒤로 화면은 **앵커 다음 날부터만** 읽는다.
//
//   왜 여기서 전부 읽나: 앵커를 만드는 건 일 년에 한 번이라 전부 읽어도 싸다.
//   비싼 건 화면 열 때마다 읽는 쪽이고, 그걸 막으려고 앵커를 박는 것이다.
//
//   **소급 전표가 들어오면 앵커가 낡는다.** 그때는 그 거래처만 다시 세야 한다
//   (`refreshPartner`). 이 스크립트를 다시 돌려도 되고 — 어차피 처음부터 다시 센다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { buildJournals } from '../src/shared/buildJournals';
import { buildPartnerAnchor, anchorId } from '../src/features/admin/partnerAnchor';
import { companyOf, COMPANIES, type CompanyId } from '../src/shared/types';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const YEAR = (process.argv.find(a => a.startsWith('--year=')) ?? '').slice(7)
  || String(new Date().getFullYear() - 1);
const BACKUP = `scripts/stamp-partner-anchor-${YEAR}-backup.json`;
const COL = 'partnerBalanceSnapshots';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error(`✖ 백업이 없다: ${BACKUP}`); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8'));
  for (const [id, before] of Object.entries<any>(prev.before)) {
    if (before) { const { id: _drop, ...rest } = before; await setDoc(doc(db, COL, id), rest); }
    else await deleteDoc(doc(db, COL, id));
  }
  console.log('✅ 되돌림'); process.exit(0);
}

const [statements, cashEntries, settlements, accounts, existing, partners] = await Promise.all([
  load('issuedStatements'), load('cashEntries'), load('settlements'),
  load('accounts'), load(COL), load('partners'),
]);
const nameOf = (pid: string) => partners.find((p: any) => p.id === pid)?.name;

console.log(`\n━━ ${YEAR}년 말 거래처 앵커 ━━  (${APPLY ? '적용' : '미리보기 — 적용하려면 --apply'})\n`);

const before: Record<string, any> = {};
const writes: { id: string; doc: any }[] = [];

for (const co of COMPANIES) {
  const cid = co.id as CompanyId;
  const myStmts = statements.filter((s: any) => companyOf(s) === cid);
  const myCash = cashEntries.filter((e: any) => companyOf(e) === cid);
  const { entries, skipped } = buildJournals({ statements: myStmts, cashEntries: myCash, accounts });
  if (skipped.length) console.log(`   ⚠ ${co.name}: 분개 못 만든 것 ${skipped.length}건 — ${skipped.slice(0, 3).map((s: any) => s.reason).join(' / ')}`);

  const anchor = buildPartnerAnchor(cid, YEAR, {
    journals: entries, statements: myStmts, cashEntries: myCash, settlements, nameOf,
  });

  const id = anchorId(cid, YEAR);
  before[id] = existing.find((x: any) => x.id === id) ?? null;

  const 받을 = anchor.rows.reduce((a, r) => a + Math.max(0, r.receivable), 0);
  const 갚을 = anchor.rows.reduce((a, r) => a + Math.max(0, r.payable), 0);
  const 미결 = anchor.rows.reduce((a, r) => a + r.openStmts.length, 0);
  console.log(`── ${co.name} (${id}) ──`);
  console.log(`   거래처 ${anchor.rows.length}곳   받을 돈 ${won(받을)}   갚을 돈 ${won(갚을)}   미결 전표 ${미결}장`);
  if (before[id]) console.log(`   ※ 이미 있다 — 덮어쓴다 (앞선 값: 거래처 ${before[id].rows?.length ?? 0}곳)`);
  for (const r of [...anchor.rows].sort((a, b) => (b.receivable + b.payable) - (a.receivable + a.payable)).slice(0, 8)) {
    console.log(`     ${(r.partnerName ?? r.partnerId).padEnd(16)} 받을 ${won(r.receivable).padStart(13)}  갚을 ${won(r.payable).padStart(13)}  미결 ${r.openStmts.length}장`);
  }

  //  **앵커 안에서 두 값이 어긋나면 안 된다** — 미결 합과 잔액이 다르면 배분이 잔액과 갈린다.
  //  선수금·선급금(259/131)은 108/251 밖이라 갈릴 수 있다. 갈리면 눈에 띄게 찍어 둔다.
  for (const r of anchor.rows) {
    for (const t of ['매출', '매입'] as const) {
      const 합 = r.openStmts.filter(o => o.type === t).reduce((a, o) => a + o.remaining, 0);
      const 잔 = t === '매출' ? r.receivable : r.payable;
      if (Math.abs(합 - 잔) > 1) console.log(`   ⚠ ${r.partnerName ?? r.partnerId} ${t}: 미결합 ${won(합)} ≠ 잔액 ${won(잔)}  (차 ${won(합 - 잔)})`);
    }
  }
  console.log('');
  writes.push({ id, doc: anchor });
}

if (!APPLY) { console.log('미리보기만 했다. 적용하려면 --apply\n'); process.exit(0); }

writeFileSync(BACKUP, JSON.stringify({ year: YEAR, at: new Date().toISOString(), before }, null, 2), 'utf8');
for (const w of writes) { const { id: _drop, ...rest } = w.doc; await setDoc(doc(db, COL, w.id), rest); }
console.log(`✅ ${writes.length}건 박았다.  백업: ${BACKUP}  (되돌리기: --undo --year=${YEAR})\n`);
process.exit(0);
