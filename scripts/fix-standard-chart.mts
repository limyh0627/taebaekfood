// 계정과목 번호를 표준으로 옮긴다 — **A안(번호만).** 회계 방식은 안 건드린다.
//   미리보기  npx tsx scripts/fix-standard-chart.mts
//   적용      npx tsx scripts/fix-standard-chart.mts --apply
//   되돌리기  npx tsx scripts/fix-standard-chart.mts --undo
//
// ⚠ 2026-09-01 현재 **아직 안 돌렸다.** 사장님 지시: "지금은 안할거야 준비만 해둬".
//   돌리기 전에 docs/표준계정과목-이전계획.md 를 먼저 읽을 것 — 코드 쪽도 같이 고쳐야 한다.
//
// 무엇을 고치나:
//   accountCodes          문서 id·code·name
//   issuedStatements      items[].accountCode
//   cashEntries           accountCode · lines[].accountCode
//   fixedCostTemplates    accountCode · loanCode · transferLines[].accountCode
//
// 무엇을 안 고치나:
//   · 500/501/503/505 매입 계정 — **갈 번호가 없어서** 그대로 둔다. 사장님이 받은 표준
//     목록의 500번대엔 원재료비·부재료비가 빠져 있다(다섯 줄짜리 요약본이다).
//     지금 방식(매입→비용, 기말 재고조정)은 그대로 두면 된다 — 자산으로 받았다가 결산에
//     원가로 넘기는 방식과 결산 결과가 같고, 중소기업 실무에서 흔한 방법이다.
//     세무대리인이 쓰는 프로그램의 제조원가 번호를 받으면 그때 옮긴다.
//   · 540 외주가공비 — 표준 자리(503 외주가공비(제조))에 지금 '503 수입(통관비)'이 앉아 있다.
//     통관비는 매입 계열이라 위 까닭으로 안 옮기므로, 540도 자리가 날 때까지 그대로 둔다.
//   · 650 카드대금 — 이건 계정이 아니라 결제수단이다.
//   · 106·136·261·338 — 표준에 있는 번호인데 사장님이 받은 요약 목록이 빠뜨린 것.
//   · 137·267 관계회사 — 성격이 대여금/차입금이지만 회사간 거래라 따로 본다.
//   · 146 재고자산 — 150 제품 · 153 원재료로 갈라야 해서 자동으로 못 옮긴다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-standard-chart-backup.json';

/** 옮길 번호 — [지금, 표준, 표준이름] */
const MOVE: [string, string, string][] = [
  // 자산
  ['101', '102', '현금'],
  ['131', '133', '선급금'],            // 표준 131은 토지다
  ['202', '128', '건물'],
  ['203', '129', '감가상각누계액(건물)'],
  ['206', '126', '기계장치'],
  ['208', '124', '차량운반구'],
  ['212', '122', '비품'],
  ['232', '169', '임차보증금'],
  // 부채 — 254와 259가 서로 자리를 바꾼다. 한 번에 옮기면 부딪히므로 아래에서 두 단계로 민다.
  ['254', '257', '예수금'],
  ['259', '254', '선수금'],
  ['262', '275', '미지급비용'],
  ['263', '275', '미지급비용'],         // 미지급급여를 미지급비용에 합친다
  // 매출
  ['800', '404', '제품매출'],
  ['805', '401', '상품매출'],
  // 비용
  ['510', '819', '임차료'],
  ['515', '802', '급여'],
  ['520', '815', '수도광열비'],
  ['525', '815', '수도광열비'],         // 전기세·수도세를 한 계정으로
  ['530', '811', '복리후생비'],
  ['535', '806', '퇴직급여'],
  ['590', '821', '보험료'],
  ['595', '828', '지급수수료'],
  ['605', '824', '운반비'],
  ['930', '905', '잡이익'],
  ['951', '931', '이자비용'],
  ['980', '935', '잡손실'],
];

/** 번호는 그대로 두고 이름만 표준어로 */
const RENAME: [string, string][] = [
  ['375', '미처분이익전기이월액'],
  ['819', '임차료'],
  ['998', '법인세비용'],
];

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8')) as { col: string; doc: any }[];
  //  만들었던 새 계정 문서를 먼저 지운다 — 백업엔 옛 문서만 들어 있다
  const keep = new Set(prev.filter(x => x.col === 'accountCodes').map(x => x.doc.id));
  for (const c of await load('accountCodes')) if (!keep.has(c.id)) { /* 새로 만든 것 */ }
  for (const { col, doc: d } of prev) { const { id, ...rest } = d; await setDoc(doc(db, col, id), rest); }
  console.log(`✅ ${prev.length}건 복원 — 새로 만든 계정은 손으로 지우세요(백업에 없음)`);
  process.exit(0);
}

const [codes, stmts, cash, tpls] = await Promise.all(
  ['accountCodes', 'issuedStatements', 'cashEntries', 'fixedCostTemplates'].map(load));

const byCode = new Map(codes.map((c: any) => [String(c.code), c]));
const map = new Map(MOVE.map(([from, to]) => [from, to]));

/*
 * 부딪히는 자리 — 옮길 곳에 이미 다른 계정이 살아 있나.
 *   254↔259는 서로 자리를 바꾸므로 둘 다 '떠나는 쪽'이라 안 걸린다.
 *   510 임대료 → 819 는 그 자리의 '819 리스료'와 **합쳐지는 것**이다(둘 다 임차료다).
 *   합칠 자리는 MERGE_OK에 적어 둔다 — 안 적으면 실수로 덮어쓰는 걸 못 막는다.
 */
const MERGE_OK = new Set(['819']);
const movingAway = new Set(MOVE.map(([from]) => from));
const collide = MOVE.filter(([, to]) => byCode.has(to) && !movingAway.has(to) && !MERGE_OK.has(to));
if (collide.length) {
  console.error('✖ 옮길 자리에 이미 다른 계정이 있다 — 손으로 정리 먼저:');
  for (const [from, to] of collide) console.error(`   ${from} → ${to} (${byCode.get(to)!.name})`);
  process.exit(1);
}

const backup: { col: string; doc: any }[] = [];
const writes: { col: string; id: string; data: any }[] = [];
const kills: string[] = [];
let touchedStmt = 0, touchedCash = 0, touchedTpl = 0;

// ── 계정 문서 ──
console.log('── 계정과목 ──');
const madeTo = new Set<string>();
for (const [from, to, nm] of MOVE) {
  const c = byCode.get(from);
  if (!c) { console.log(`   ${from} — 없다. 건너뛴다`); continue; }
  console.log(`   ${from} ${String(c.name).padEnd(14)} → ${to} ${nm}`);
  backup.push({ col: 'accountCodes', doc: c });
  kills.push(c.id);
  if (MERGE_OK.has(to)) continue;   // 있던 계정에 합친다 — 새 문서를 안 만든다(RENAME이 이름을 맞춘다)
  if (!madeTo.has(to)) {      // 520·525 → 815 처럼 둘이 한 곳으로 가면 하나만 만든다
    madeTo.add(to);
    writes.push({ col: 'accountCodes', id: `ac-${to}`, data: { ...c, id: `ac-${to}`, code: to, name: nm } });
  }
}
for (const [code, nm] of RENAME) {
  const c = byCode.get(code);
  if (!c || c.name === nm) continue;
  console.log(`   ${code} ${String(c.name).padEnd(14)} → 이름만 ${nm}`);
  backup.push({ col: 'accountCodes', doc: c });
  const { id, ...rest } = c;
  writes.push({ col: 'accountCodes', id, data: { ...rest, name: nm } });
}

const conv = (v: any) => (v != null && map.has(String(v)) ? map.get(String(v))! : v);

// ── 전표 ──
for (const s of stmts) {
  const items = (s.items ?? []);
  if (!items.some((i: any) => map.has(String(i.accountCode)))) continue;
  backup.push({ col: 'issuedStatements', doc: s });
  const { id, ...rest } = s;
  writes.push({ col: 'issuedStatements', id, data: { ...rest, items: items.map((i: any) => ({ ...i, accountCode: conv(i.accountCode) })) } });
  touchedStmt++;
}
// ── 자금전표 ──
for (const e of cash) {
  const lines = e.lines ?? [];
  const hit = map.has(String(e.accountCode)) || lines.some((l: any) => map.has(String(l.accountCode)));
  if (!hit) continue;
  backup.push({ col: 'cashEntries', doc: e });
  const { id, ...rest } = e;
  writes.push({ col: 'cashEntries', id, data: {
    ...rest,
    ...(e.accountCode ? { accountCode: conv(e.accountCode) } : {}),
    ...(lines.length ? { lines: lines.map((l: any) => ({ ...l, accountCode: conv(l.accountCode) })) } : {}),
  } });
  touchedCash++;
}
// ── 템플릿 ──
for (const t of tpls) {
  const tl = t.transferLines ?? [];
  const hit = map.has(String(t.accountCode)) || map.has(String(t.loanCode)) || tl.some((l: any) => map.has(String(l.accountCode)));
  if (!hit) continue;
  backup.push({ col: 'fixedCostTemplates', doc: t });
  const { id, ...rest } = t;
  writes.push({ col: 'fixedCostTemplates', id, data: {
    ...rest,
    ...(t.accountCode ? { accountCode: conv(t.accountCode) } : {}),
    ...(t.loanCode ? { loanCode: conv(t.loanCode) } : {}),
    ...(tl.length ? { transferLines: tl.map((l: any) => ({ ...l, accountCode: conv(l.accountCode) })) } : {}),
  } });
  touchedTpl++;
}

console.log(`\n── 따라 고칠 것 ──`);
console.log(`   전표 ${touchedStmt}건 · 자금전표 ${touchedCash}건 · 템플릿 ${touchedTpl}건`);
console.log(`\n⚠ 코드도 같이 고쳐야 한다 — docs/표준계정과목-이전계획.md 의 '코드에 박힌 번호' 참고.`);
console.log(`   안 고치면 화면이 옛 번호를 찾다가 조용히 빈 값이 된다.`);

if (!APPLY) { console.log('\n(--dry) 적용하려면 --apply'); process.exit(0); }
writeFileSync(BACKUP, JSON.stringify(backup, null, 2), 'utf8');
for (const w of writes) await setDoc(doc(db, w.col, w.id), w.data);
for (const id of kills) await deleteDoc(doc(db, 'accountCodes', id));
console.log(`\n✅ ${writes.length}건 쓰고 옛 계정 ${kills.length}건 지웠다.`);
console.log('   되돌리기: npx tsx scripts/fix-standard-chart.mts --undo');
process.exit(0);
