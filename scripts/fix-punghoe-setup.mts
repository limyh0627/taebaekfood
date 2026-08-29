// 풍회유통 장부 세우기 — 거래처를 풍회 쪽으로 복사하고, 품목을 셋으로 맞춘다.
//   기본 = --dry.  적용 = --apply.  되돌리기 = --undo
//
// 거래처는 **회사마다 문서를 따로 둔다.** 카프코·한국농수산물유통공사처럼 양쪽이 같이 쓰는 곳을
// 한 문서로 공유하면 잔액·전표가 어느 회사 것인지 흐려진다 — 장부는 회사마다 따로다.
// 그래서 태백 문서는 그대로 두고 풍회용 사본을 새로 만든 뒤, **풍회 전표·자금만** 사본으로 옮긴다.
//
// 태백푸드는 예외다. 태백 쪽 전표·자금·주문이 0건이라(풍회의 매출처일 뿐) 사본을 만들지 않고
// 이름을 '태백식품'으로 바꿔 풍회로 넘긴다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const BACKUP = 'scripts/fix-punghoe-setup-backup.json';

//  풍회 쪽으로 사본을 만들 거래처 (태백 문서는 그대로 둔다)
const COPY: [string, string][] = [
  ['c-1785818085745', '카프코'],
  ['c-1778504018504', '한국농수산물유통공사'],
  ['c-1779251400400', '따나카코리아'],
  ['c-1785823081689', '품질검사(풍회)'],
  ['c-1786079039448', '보험료'],
  ['c-1786083450787', '카드대금'],
  ['c-bank-sosangong', '소상공'],
  ['c-jungjingong', '중진공'],
  ['c-bank-1', '농협은행'],
  ['c-1785823172251', '한전'],
];
//  이름을 바꿔 통째로 넘길 거래처 (태백 쪽 쓰임이 0건이라 사본을 안 만든다)
const RENAME_MOVE: [string, string][] = [['c-taebaek-food', '태백식품']];
const PUNGHOE_ID = (src: string) => `${src}-punghoe`;

/**
 * 풍회 품목 — **태백 문서를 그대로 떠서 재고만 0으로.** 손으로 만들면 분류·단위가 태백과 미묘히
 * 달라져 나중에 같은 물건인지 못 알아본다. 재고는 회사마다 따로 세는 것이라 0에서 시작한다.
 * (태백 참깨 3,510kg은 안 건드린다 — 옮기면 태백 재고가 통째로 빈다)
 */
const COPY_ITEMS: [string, string][] = [
  ['p-1779251176421', '참깨'],
];

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error('백업이 없다.'); process.exit(1); }
  const prev = JSON.parse(readFileSync(BACKUP, 'utf8'));
  for (const id of prev.createdPartners) await deleteDoc(doc(db, 'partners', id));
  for (const [id, v] of Object.entries(prev.partners as Record<string, any>)) await setDoc(doc(db, 'partners', id), v);
  for (const [col, rows] of Object.entries(prev.repoint as Record<string, Record<string, any>>))
    for (const [id, v] of Object.entries(rows)) await updateDoc(doc(db, col, id), v);
  for (const id of prev.createdItems) await deleteDoc(doc(db, 'items', id));
  console.log(`✅ 되돌림 — 거래처 ${prev.createdPartners.length}개 삭제 · ${Object.keys(prev.partners).length}개 복원 · 품목 ${prev.createdItems.length}개 삭제`);
  process.exit(0);
}

const [partners, items, stmts, cash] = await Promise.all([load('partners'), load('items'), load('issuedStatements'), load('cashEntries')]);
const byId = new Map(partners.map((p: any) => [p.id, p]));
console.log(`\n═══ ${APPLY ? '🔴 적용(--apply)' : '🟢 미리보기(dry)'} ═══\n`);

// ── ① 거래처 사본 ──
const created: any[] = [];
const repoint: Record<string, Record<string, any>> = { issuedStatements: {}, cashEntries: {} };
console.log('── 풍회 사본 거래처 ──');
for (const [src, name] of COPY) {
  const o = byId.get(src);
  if (!o) { console.log(`   ⚠ ${name}(${src}) 원본 없음 — 건너뜀`); continue; }
  const nid = PUNGHOE_ID(src);
  const ns = stmts.filter((s: any) => s.partnerId === src && s.companyId === 'punghoe');
  const nc = cash.filter((c: any) => c.partnerId === src && c.companyId === 'punghoe');
  console.log(`   ${String(name).padEnd(20)} → ${nid}   풍회 전표 ${ns.length} · 자금 ${nc.length} 재지정`);
  created.push({ ...o, id: nid, companyId: 'punghoe' });
  for (const s of ns) repoint.issuedStatements[s.id] = { partnerId: nid };
  for (const c of nc) repoint.cashEntries[c.id] = { partnerId: nid };
}

// ── ② 이름 바꿔 넘길 거래처 ──
const renamed: Record<string, any> = {};
console.log('\n── 이름 바꿔 풍회로 (사본 안 만듦 — 태백 쓰임 0건) ──');
for (const [id, newName] of RENAME_MOVE) {
  const o = byId.get(id);
  if (!o) { console.log(`   ⚠ ${id} 없음`); continue; }
  console.log(`   ${o.name} → ${newName}   (${id}, companyId=punghoe)`);
  renamed[id] = { name: o.name, companyId: o.companyId ?? null };
  const hit = stmts.filter((s: any) => s.partnerId === id).length + cash.filter((c: any) => c.partnerId === id).length;
  console.log(`      전표·자금 ${hit}건의 partnerName도 함께 바꾼다`);
}

// ── ③ 풍회 품목 — 깨분·깨분참기름·참깨 셋 ──
const punghoeItems = items.filter((i: any) => i.companyId === 'punghoe' && !i.archived);
console.log('\n── 풍회 품목 ──');
for (const i of punghoeItems) console.log(`   있음  ${String(i.type).padEnd(4)} ${i.name} ${i.spec ?? ''} 원가 ${i.cost}`);
const itemCopies = COPY_ITEMS
  .filter(([, name]) => !punghoeItems.some((i: any) => i.name === name))
  .map(([src, name]) => ({ src, name, o: items.find((i: any) => i.id === src) }))
  .filter(x => x.o);
for (const c of itemCopies)
  console.log(`   복사  ${String(c.o.type).padEnd(4)} ${c.name} (${c.o.unit}) — 태백 ${c.src} 그대로, 재고 0`);
console.log(`\n되돌리기: npx tsx scripts/fix-punghoe-setup.mts --undo`);
if (!APPLY) { console.log(`\n적용: npx tsx scripts/fix-punghoe-setup.mts --apply`); process.exit(0); }

const backup = {
  createdPartners: created.map(c => c.id),
  partners: Object.fromEntries(Object.entries(renamed).map(([id]) => [id, byId.get(id)])),
  repoint: {
    issuedStatements: Object.fromEntries(Object.keys(repoint.issuedStatements).map(id => [id, { partnerId: stmts.find((s: any) => s.id === id).partnerId, partnerName: stmts.find((s: any) => s.id === id).partnerName }])),
    cashEntries: Object.fromEntries(Object.keys(repoint.cashEntries).map(id => [id, { partnerId: cash.find((c: any) => c.id === id).partnerId, partnerName: cash.find((c: any) => c.id === id).partnerName }])),
  },
  createdItems: [] as string[],
};

for (const c of created) await setDoc(doc(db, 'partners', c.id), c);
for (const [col, rows] of Object.entries(repoint))
  for (const [id, v] of Object.entries(rows)) await updateDoc(doc(db, col, id), v);
for (const [id, newName] of RENAME_MOVE) {
  await updateDoc(doc(db, 'partners', id), { name: newName, companyId: 'punghoe' });
  for (const s of stmts.filter((x: any) => x.partnerId === id)) await updateDoc(doc(db, 'issuedStatements', s.id), { partnerName: newName });
  for (const c of cash.filter((x: any) => x.partnerId === id)) await updateDoc(doc(db, 'cashEntries', c.id), { partnerName: newName });
}
for (const c of itemCopies) {
  const id = `${c.src}-punghoe`;
  //  로트·거래처연결은 안 가져온다 — 그건 태백 창고와 태백 거래처의 것이다.
  const { lots: _l, partnerIds: _p, ...rest } = c.o as Record<string, unknown>;
  await setDoc(doc(db, 'items', id), { ...rest, id, stock: 0, companyId: 'punghoe' });
  backup.createdItems.push(id);
  console.log(`   ✅ ${c.name} 복사 (${id})`);
}
writeFileSync(BACKUP, JSON.stringify(backup, null, 1), 'utf8');
console.log(`\n✅ 거래처 사본 ${created.length}개 · 이름변경 ${RENAME_MOVE.length}건 · 백업 ${BACKUP}`);
process.exit(0);
