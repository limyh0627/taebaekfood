// 서류용 품목 시골향들기름2 → 시골향들기름3 (2026-09-28 서류부터). 16.5kg 캔(반제품)은 2로 둔다.
//  사장님 결정 2026-10-08(브랜치 claude/deulgireum3-doc-pumok) + 2026-10-14(기준일 9/28).
//  ① items: 품목=3, 품목이력=[{2, until 9/28}] — 9/27까지 서류는 계속 2로 잡힌다(docPumokAt)
//  ② 진들기름/1500ml: BOM에 기름이 없어 원료 차감·원가가 품목 배합으로 떨어진다.
//     형제(진들기름 1800ml = wip-들기름 1.663)처럼 반제품 들기름 1.386kg(1.5L × 0.924)을 넣고,
//     앱이 BOM 저장 뒤 하는 것처럼 같은 원가 함수(buildCostFn)로 그 품목 원가를 다시 굴린다.
//  ③ 9/28 이후 저장된 생산판매일지(productionSalesLogs): 판매줄 품목 2→3,
//     좌측 ② 묶음 바로 아래에 같은 칸의 ③ 묶음을 넣고 수량을 옮긴다(새 판매일지 양식과 같은 모양)
//
// functions/ 가 CommonJS라 tsx로는 공용 계산을 못 불러온다 — esbuild로 묶어 돌린다:
//   npx esbuild scripts/fix-pumok-deulgireum2-to-3.mts --bundle --platform=node --format=esm --packages=external --outfile=node_modules/.cache/fix-deul3.mjs
//   node node_modules/.cache/fix-deul3.mjs            (미리보기)
//   node node_modules/.cache/fix-deul3.mjs --apply
//   node node_modules/.cache/fix-deul3.mjs --undo
import admin from 'firebase-admin';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildCostFn } from '../src/shared/bomCost';
import { buildFormula, formulaRowsOf } from '../src/features/admin/bom';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const COMPANY = 'taebaek';
const FROM = '2026-09-28';
const OLD = '시골향들기름2', NEW = '시골향들기름3';
const OLD_LABEL = '시골향들기름②', NEW_LABEL = '시골향들기름③';
const KEEP = new Set(['p-1773565128048']);   // 수입산들기름-캔 16.5kg — 사장님: 캔은 그대로
const CAN_SPEC = '16.5kg';
const BOM_PARENT = 'p-1786496156778';         // 진들기름/1500ml
const BOM_CHILD = 'wip-들기름';
const BOM_QTY = 1.386;
const BOM_ID = `bom-${BOM_PARENT}__${BOM_CHILD}`;   // 앱이 BOM 저장 때 쓰는 이름 규칙
const BACKUP = '로컬전용/백업/pumok-deulgireum2-to-3-from0928.json';

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS가 없습니다.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();
const { FieldValue } = admin.firestore;

//  before 에 없던 필드는 null 로 적는다(되돌릴 때 지운다). item_bom 은 새로 만드는 문서라 before 가 null.
type Saved = { collection: string; id: string; name: string; before: Record<string, unknown> | null; after: Record<string, unknown> };
type Backup = { savedAt: string; rows: Saved[] };
const ref = (s: Saved) => db.collection(s.collection).doc(s.id);

// ── 되돌리기가 맨 앞이다. 급할 때 찾기 쉬우라고. ──
if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없습니다: ${BACKUP}`);
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as Backup;
  const batch = db.batch();
  for (const s of backup.rows) {
    if (s.before === null) { batch.delete(ref(s)); continue; }
    batch.update(ref(s), Object.fromEntries(Object.keys(s.after).map(f => [f, s.before![f] ?? FieldValue.delete()])));
  }
  await batch.commit();
  console.log(`${backup.rows.length}건을 적용 전 값으로 복구했습니다.`);
  process.exit(0);
}

// ── 회사 조건은 항상 건다. 태백·풍회가 한 DB에 있다. ──
const load = async (name: string) => (await db.collection(name).where('companyId', '==', COMPANY).get())
  .docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
const [items, logs, boms, formulas] = await Promise.all([load('items'), load('productionSalesLogs'), load('item_bom'), load('item_formula')]);

const rows: Saved[] = [];
const itemRow = new Map<string, Saved>();

// ① 품목
for (const i of items) {
  if (String(i.품목 ?? '').trim() !== OLD || KEEP.has(i.id)) continue;
  if (i.품목이력?.length) throw new Error(`${i.name} [${i.id}] 에 이미 품목이력이 있습니다 — 손으로 봐야 합니다`);
  const s: Saved = {
    collection: 'items', id: i.id, name: `${i.name} (${i.spec ?? ''})`,
    before: { 품목: i.품목, 품목이력: null },
    after: { 품목: NEW, 품목이력: [{ 품목: OLD, until: FROM }] },
  };
  rows.push(s); itemRow.set(i.id, s);
}

// ② 진들기름/1500ml BOM + 원가
const parent = items.find(i => i.id === BOM_PARENT);
const child = items.find(i => i.id === BOM_CHILD);
if (!parent || !itemRow.has(BOM_PARENT)) throw new Error(`${BOM_PARENT}: 진들기름/1500ml이 아니거나 이미 바뀌었습니다`);
if (!child || child.type !== 'wip' || child.subtype !== '벌크') throw new Error(`${BOM_CHILD}: 반제품 들기름(벌크)이 아닙니다`);
if (boms.some(b => b.parent_id === BOM_PARENT && items.find(i => i.id === b.child_id)?.subtype === '벌크'))
  throw new Error(`${BOM_PARENT}: 이미 BOM에 기름이 있습니다`);
if ((await db.collection('item_bom').doc(BOM_ID).get()).exists) throw new Error(`${BOM_ID}: 문서가 이미 있습니다`);
const bomData = { id: BOM_ID, parent_id: BOM_PARENT, child_id: BOM_CHILD, quantity: BOM_QTY, companyId: COMPANY };
rows.push({ collection: 'item_bom', id: BOM_ID, name: `${parent.name} ← ${child.name} ×${BOM_QTY}`, before: null, after: bomData });

//  앱 recomputeAllCosts 와 같은 함수 — 바뀐 품목·BOM으로 굴려 진들기름/1500ml만 반영한다.
const 바뀐품목 = items.map(i => itemRow.has(i.id) ? { ...i, ...itemRow.get(i.id)!.after } : i);
const roll = buildCostFn({
  allItems: 바뀐품목, itemBoms: [...boms, bomData],
  formulaOf: k => buildFormula(k, formulas, 바뀐품목), formulaRowsOf: k => formulaRowsOf(k, formulas),
});
const 새원가 = Math.round(roll(바뀐품목.find(i => i.id === BOM_PARENT)!));
const 원가줄 = parent.costSource === 'manual' ? '손으로 정한 원가라 그대로'
  : 새원가 > 0 && Math.abs(새원가 - (parent.cost ?? 0)) > 0.5 ? `${parent.cost ?? 0} → ${새원가}` : `${parent.cost ?? 0} 그대로`;
if (parent.costSource !== 'manual' && 새원가 > 0 && Math.abs(새원가 - (parent.cost ?? 0)) > 0.5) {
  const s = itemRow.get(BOM_PARENT)!;
  s.before!.cost = parent.cost ?? null; s.after.cost = 새원가;
}

// ③ 저장된 생산판매일지 — 9/28 이후
const 바꿀줄 = (r: any) => r.품목 === OLD && r.용량 !== CAN_SPEC;
const 로그요약: string[] = [];
for (const l of logs) {
  if (String(l.date) < FROM) continue;
  const after: Record<string, unknown> = {}, before: Record<string, unknown> = {};
  const sales = l.salesRows ?? [];
  if (sales.some(바꿀줄)) { before.salesRows = sales; after.salesRows = sales.map((r: any) => 바꿀줄(r) ? { ...r, 품목: NEW } : r); }
  const extra = l.extraRows ?? [];
  if (extra.some(바꿀줄)) { before.extraRows = extra; after.extraRows = extra.map((r: any) => 바꿀줄(r) ? { ...r, 품목: NEW } : r); }
  const prod = l.productionRows ?? [];
  const at = prod.findIndex((r: any) => r.groupLabel === OLD_LABEL);
  let 새묶음줄 = '';
  if (at >= 0) {
    if (prod.some((r: any) => r.groupLabel === NEW_LABEL || r.groupLabel === NEW))
      throw new Error(`${l.date} [${l.id}] 에 이미 3 묶음이 있습니다 — 합쳐야 해서 손으로 봐야 합니다`);
    // ② 묶음 = 머리줄부터 다음 머리줄 전까지. 16.5kg 칸은 캔(2로 남음) 몫이라 ②에 그대로 둔다.
    const end0 = prod.findIndex((r: any, k: number) => k > at && r.groupLabel);
    const end = end0 < 0 ? prod.length : end0;
    const 묶음 = prod.slice(at, end);
    const 남길 = 묶음.map((r: any) => r.spec === CAN_SPEC ? r : { ...r, 수량: 0, 소비기한: '', 비고: '' });
    const 새묶음 = 묶음.filter((r: any) => r.spec !== CAN_SPEC).map((r: any, k: number) => ({ ...r, groupLabel: k === 0 ? NEW_LABEL : '' }));
    before.productionRows = prod;
    after.productionRows = [...prod.slice(0, at), ...남길, ...새묶음, ...prod.slice(end)];
    새묶음줄 = 새묶음.map((r: any) => `${r.spec} ${r.수량}`).join(', ');
  }
  if (!Object.keys(after).length) continue;
  rows.push({ collection: 'productionSalesLogs', id: l.id, name: `판매일지 ${l.date}`, before, after });
  const 판매줄 = (after.salesRows as any[] | undefined)?.filter((r, k) => r !== sales[k]).length ?? 0;
  로그요약.push(`${l.date} 판매줄 ${판매줄}줄${after.extraRows ? ' · 기타' : ''}${새묶음줄 ? ` · ③ 묶음 [${새묶음줄}]` : ''}`);
}

// ── 미리보기 ──
const 품목줄 = rows.filter(s => s.collection === 'items');
const 일지줄 = rows.filter(s => s.collection === 'productionSalesLogs');
console.log(`① 품목 ${품목줄.length}건: 품목 ${OLD} → ${NEW}, 품목이력 [${OLD} until ${FROM}]`);
for (const s of 품목줄) console.log(`   - ${s.name} [${s.id}]`);
console.log(`② BOM 추가: ${parent.name} [${BOM_PARENT}] ← ${child.name} [${BOM_CHILD}] × ${BOM_QTY} (문서 ${BOM_ID})`);
console.log(`   지금 BOM: ${boms.filter(b => b.parent_id === BOM_PARENT).map(b => `${items.find(i => i.id === b.child_id)?.name ?? b.child_id} ×${b.quantity}`).join(' | ')}`);
console.log(`   원가: ${원가줄}`);
console.log(`③ 저장된 생산판매일지 ${일지줄.length}건 (${FROM} 이후)`);
for (const line of 로그요약.sort()) console.log(`   - ${line}`);
console.log(`그대로 두는 것: ${[...KEEP].map(id => items.find(i => i.id === id)?.name ?? id).join(', ')}`);
console.log(`쓰기 합계 ${rows.length}건 — ${APPLY ? '실제 적용' : '미리보기(dry) — 쓰기 없음'}`);
if (!APPLY) process.exit(0);

if (existsSync(BACKUP)) throw new Error(`기존 백업이 있습니다: ${BACKUP}`);
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ savedAt: new Date().toISOString(), rows } satisfies Backup, null, 2), 'utf8');

// ── 바꿀 필드만 update(BOM은 create). 한 배치라 같이 들어가거나 같이 안 들어간다. ──
if (rows.length > 450) throw new Error('한 배치를 넘습니다 — 나눠야 합니다');
const batch = db.batch();
for (const s of rows) {
  if (s.before === null) batch.create(ref(s), s.after);
  else batch.update(ref(s), s.after);
}
await batch.commit();

// ── 썼다고 믿지 않는다. 다시 읽어 맞는지 본다. ──
for (const s of rows) {
  const current = (await ref(s).get()).data() ?? {};
  for (const f of Object.keys(s.after))
    if (JSON.stringify(current[f]) !== JSON.stringify(s.after[f])) throw new Error(`${s.collection}/${s.id}.${f}: 적용 뒤 재조회 검증 실패`);
}
console.log(`${rows.length}건 적용·재조회 검증 완료 (품목 ${품목줄.length} · BOM 1 · 판매일지 ${일지줄.length})`);
process.exit(0);
