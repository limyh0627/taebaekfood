/**
 * 들기름2 품목들이 쓰는 라벨의 **이름 숫자만** ② → ③ 으로 바꾼다.
 *
 * 2026-10-08 사장님: "품목들에 서류를 다 들기름 3번으로 바꿨으니까 라벨도 그거에 맞춰서 다 변경해줘봐
 * 숫자들 말하는거임". 결정:
 *   · 이름만 바꾼다 — 재고 수량·BOM 연결·id 는 그대로(BOM 은 id 로 물려 있다).
 *   · 실물 인쇄와 상관없이 이름만(사장님 확인).
 *   · 품목의 서류 품목(들기름2→3)은 아직 안 바꿨다 — 그건 fix-deulgireum2-to-3-20261008.mts(배포 뒤).
 *   · 어느 품목에도 안 물린 '시골향들기름2(중국산) 1.75L' 도 3 으로(사장님 선택).
 *   · 숫자가 없는 라벨(원조방앗간 들·모란 들 1.75L 등)과 알이네 참④-350ml 은 건드리지 않는다.
 *
 *   npx tsx scripts/fix-label-deul2-to-3-20261008.mts          (미리보기)
 *   npx tsx scripts/fix-label-deul2-to-3-20261008.mts --apply
 *   npx tsx scripts/fix-label-deul2-to-3-20261008.mts --undo
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { adminDb, 실행모드 } from './_admin.mts';

const COMPANY_ID = 'taebaek';
const BACKUP = '로컬전용/백업/label-deul2-to-3-20261008.json';
//  id → 지금 이름. 이름이 이것과 다르면(그새 누가 고쳤으면) 멈춘다.
const LABELS: Record<string, string> = {
  'label-태백-들2-1-75l': '시골향들② 1.75L',
  'label-태백-들2-흰정사각-350ml': '시골향들②-흰정사각 350ml/1.75L',
  'label-태백-들2-1-8l': '시골향들② 1.8L',
  'p-1778024430890': '시골향들② 300ml(사각)',
  'label-양념나라-들2-1-75l': '양념나라 들② 1.75L',
  'label-양념나라-들2-350ml': '양념나라 들② (병합)',
  'p-1784790843654': '라이스에그 들② 1.8L',
  'p-1784790548108': '우리식품 들② 1.75L',
  'label-지구-들2-1-8l': '지구 들② 1.8L',
  'p-1784791626594': '해내음 들② 1.8L',
  'p-1784789004903': '대왕 들② 1.8L',
  'p-1784789021178': '대왕 들② 350ml',
  'label-태백-들기름2-중국산-1-75l': '시골향들기름2(중국산) 1.75L',
};
const 새이름 = (name: string) => name.replace('들②', '들③').replace('들기름2(', '들기름3(');

type Row = { id: string; before: string; after: string };
const { APPLY, UNDO } = 실행모드();
const db = adminDb();
const ref = (id: string) => db.collection('items').doc(id);

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없습니다: ${BACKUP}`);
  const rows = JSON.parse(readFileSync(BACKUP, 'utf8')).rows as Row[];
  await db.runTransaction(async tx => {
    const curs = await Promise.all(rows.map(r => tx.get(ref(r.id))));
    curs.forEach((s, i) => { if (s.data()?.name !== rows[i].after) throw new Error(`${rows[i].id}: 그 뒤에 이름이 바뀌어 되돌리지 않습니다.`); });
    rows.forEach(r => tx.update(ref(r.id), { name: r.before }));
  });
  console.log(`${rows.length}건 라벨 이름을 되돌렸습니다.`);
  process.exit(0);
}

const items = (await db.collection('items').where('companyId', '==', COMPANY_ID).get()).docs.map(d => ({ id: d.id, ...d.data() } as any));
const boms = (await db.collection('item_bom').where('companyId', '==', COMPANY_ID).get()).docs.map(d => d.data() as any);
const 멈춤: string[] = [];
const rows: Row[] = [];
console.log('| 라벨 id | 지금 이름 | 바꿀 이름 | 재고 | 쓰는 품목(서류품목) |');
for (const [id, 예상] of Object.entries(LABELS)) {
  const l = items.find(i => i.id === id);
  if (!l) { 멈춤.push(`${id}: 없다`); continue; }
  if (l.name !== 예상) 멈춤.push(`${id}: 이름이 "${예상}"가 아니라 "${l.name}"`);
  if (l.category !== '라벨') 멈춤.push(`${id}: 라벨이 아니다(${l.category})`);
  const after = 새이름(l.name);
  if (after === l.name) 멈춤.push(`${id}: 바꿀 숫자가 없다`);
  if (items.some(i => i.id !== id && i.name === after)) 멈춤.push(`${id}: "${after}" 이름이 이미 있다`);
  const 쓰는곳 = boms.filter(b => b.child_id === id).map(b => items.find(i => i.id === b.parent_id)).filter(Boolean);
  console.log(`| ${id} | ${l.name} | ${after} | ${l.stock ?? 0} | ${쓰는곳.map((p: any) => `${p.name}(${p.품목 || '-'})`).join(', ') || '없음'} |`);
  rows.push({ id, before: l.name, after });
}
if (멈춤.length) { console.log(`\n⛔ ${멈춤.join('\n⛔ ')}\n아무것도 쓰지 않습니다.`); process.exit(1); }
console.log(`\n총 ${rows.length}건 — name 한 칸만 바꾼다(재고·BOM·id 그대로).`);
if (!APPLY) { console.log('미리보기(dry) — 쓰기 없음. --apply 로 적용.'); process.exit(0); }

if (existsSync(BACKUP)) throw new Error(`기존 백업이 있습니다: ${BACKUP}`);
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ savedAt: new Date().toISOString(), rows }, null, 2), 'utf8');
console.log(`백업 저장: ${BACKUP}`);
await db.runTransaction(async tx => {
  const curs = await Promise.all(rows.map(r => tx.get(ref(r.id))));
  curs.forEach((s, i) => { if (s.data()?.name !== rows[i].before) throw new Error(`${rows[i].id}: 그 사이 이름이 바뀌었습니다.`); });
  rows.forEach(r => tx.update(ref(r.id), { name: r.after }));
});
for (const r of rows) if ((await ref(r.id).get()).data()?.name !== r.after) throw new Error(`${r.id}: 재조회 검증 실패`);
console.log(`${rows.length}건 이름 변경·재조회 확인 완료.`);
process.exit(0);
