/**
 * 일성 흰정사각 특A 낱개에 기존 특A와 같은 벌크 원액을 연결한다.
 * 포장재 BOM만 있는 현재 상태에서는 품목명 배합(통깨 25%)으로 빠지므로,
 * 기존 특A의 벌크 BOM(통깨 50%)을 그대로 쓰게 하는 정정이다.
 * 과거 주문·원료 원장·재고는 건드리지 않는다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { adminDb, 실행모드 } from './_admin.mts';

const COMPANY = 'taebaek';
const TARGET_ID = 'p-1786500348033';
const BOX_ID = 'p-1786500400800';
const WIP_ID = 'wip-참기름특A';
const SOURCE_IDS = ['p-25', 'p-203'] as const;
const KG_PER_BOTTLE = 1.603;
const BOM_ID = `bom-${TARGET_ID}__${WIP_ID}`;
const BACKUP = '로컬전용/백업/ilsung-square-special-a-bom-2026-09-25.json';
const { APPLY, UNDO, 나머지 } = 실행모드();
if (APPLY && UNDO) throw new Error('--apply와 --undo는 함께 쓸 수 없습니다.');
if (나머지.length || process.argv.slice(2).some(a => !['--dry', '--apply', '--undo'].includes(a))) {
  throw new Error('지원하는 옵션은 --dry, --apply, --undo뿐입니다.');
}

const db = adminDb();
const bom = db.collection('item_bom');
const newRef = bom.doc(BOM_ID);
const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);
type BomRow = { id: string; data: FirebaseFirestore.DocumentData };
type Context = {
  target: FirebaseFirestore.DocumentData;
  box: FirebaseFirestore.DocumentData;
  wip: FirebaseFirestore.DocumentData;
  sources: FirebaseFirestore.DocumentData[];
  targetRows: BomRow[];
  boxRows: BomRow[];
  sourceRows: BomRow[][];
  formulaRows: BomRow[];
  newBom: FirebaseFirestore.DocumentData | null;
};
type Backup = {
  projectId: 'taebaek-3abe4';
  path: string;
  savedAt: string;
  before: null;
  after: { parent_id: string; child_id: string; quantity: number; companyId: string };
  context: Context;
};

const asRows = (snap: FirebaseFirestore.QuerySnapshot): BomRow[] =>
  snap.docs.map(doc => ({ id: doc.id, data: doc.data() })).sort((a, b) => a.id.localeCompare(b.id));

async function readContext(tx?: FirebaseFirestore.Transaction): Promise<Context> {
  const getDoc = (ref: FirebaseFirestore.DocumentReference) => tx ? tx.get(ref) : ref.get();
  const getQuery = (query: FirebaseFirestore.Query) => tx ? tx.get(query) : query.get();
  const itemRef = (id: string) => db.collection('items').doc(id);
  const rowsQuery = (id: string) => bom.where('parent_id', '==', id);
  const [target, boxItem, wip, source0, source1, newBom,
    targetBom, boxBom, sourceBom0, sourceBom1, formula] = await Promise.all([
    getDoc(itemRef(TARGET_ID)), getDoc(itemRef(BOX_ID)), getDoc(itemRef(WIP_ID)),
    getDoc(itemRef(SOURCE_IDS[0])), getDoc(itemRef(SOURCE_IDS[1])), getDoc(newRef),
    getQuery(rowsQuery(TARGET_ID)), getQuery(rowsQuery(BOX_ID)),
    getQuery(rowsQuery(SOURCE_IDS[0])), getQuery(rowsQuery(SOURCE_IDS[1])),
    getQuery(db.collection('item_formula').where('parent_key', '==', '참기름특A')),
  ]);
  const snapshots = [target, boxItem, wip, source0, source1];
  if (snapshots.some(s => !s.exists)) throw new Error('대상·박스·벌크·기준 특A 품목 중 없는 문서가 있습니다.');
  return {
    target: target.data()!, box: boxItem.data()!, wip: wip.data()!,
    sources: snapshots.slice(3).map(s => s.data()!),
    targetRows: asRows(targetBom), boxRows: asRows(boxBom),
    sourceRows: [asRows(sourceBom0), asRows(sourceBom1)],
    formulaRows: asRows(formula), newBom: newBom.exists ? newBom.data()! : null,
  };
}

function checkContext(c: Context): void {
  const named: [string, FirebaseFirestore.DocumentData][] = [
    [TARGET_ID, c.target], [BOX_ID, c.box], [WIP_ID, c.wip],
    ...SOURCE_IDS.map((id, index): [string, FirebaseFirestore.DocumentData] => [id, c.sources[index]]),
  ];
  for (const [id, item] of named) {
    if (item?.companyId !== COMPANY) throw new Error(`회사값이 예상과 다릅니다: items/${id}`);
  }
  if (c.target.type !== 'product' || c.target.subtype !== '낱개' ||
      c.target.spec !== '1750ml' || c.target.품목 !== '시골향참기름4' ||
      !String(c.target.name ?? '').includes('특A') || !String(c.target.name ?? '').includes('흰정사각')) {
    throw new Error('흰정사각 특A 낱개 품목의 분류·규격·이름이 예상과 다릅니다.');
  }
  if (c.box.type !== 'product' || c.box.subtype !== '박스' || c.box.spec !== '1750ml * 10') {
    throw new Error('흰정사각 특A 박스의 분류·규격이 예상과 다릅니다.');
  }
  const boxChild = c.boxRows.filter(r => r.data.child_id === TARGET_ID);
  if (boxChild.length !== 1 || boxChild[0].data.quantity !== 10 || c.boxRows.some(r => r.data.companyId !== COMPANY)) {
    throw new Error('흰정사각 박스가 해당 낱개 10개를 물고 있는지 확인할 수 없습니다.');
  }
  if (c.wip.type !== 'wip' || c.wip.subtype !== '벌크' || c.wip.phantom !== true || c.wip.name !== '참기름특A') {
    throw new Error('참기름특A가 벌크 phantom 반제품인지 확인할 수 없습니다.');
  }
  if (c.newBom !== null || c.targetRows.some(r => r.id === BOM_ID || r.data.child_id === WIP_ID)) {
    throw new Error('대상 특A 벌크 BOM이 이미 있어 중복 적용을 중단합니다.');
  }
  if (c.targetRows.some(r => r.data.companyId !== COMPANY || r.data.parent_id !== TARGET_ID)) {
    throw new Error('대상 BOM의 회사·부모 ID가 예상과 다릅니다.');
  }
  // 포장재는 별도 작업으로 4행에서 2행이 될 수 있다. 여기서는 복원·수정하지 않는다.
  // 두 상태 모두 병마개·라벨은 같고 벌크 원액은 없으므로 이 정정과 충돌하지 않는다.
  const packaging = new Map([['C-BL01', 1], ['label-태백-참1-흰정사각-350ml', 1]]);
  const optionalPackaging = new Map([['B-04', 1], ['T-BL', 0]]);
  const rowsByChild = new Map(c.targetRows.map(r => [String(r.data.child_id), r]));
  if (c.targetRows.length !== rowsByChild.size || [...packaging].some(([id, qty]) => rowsByChild.get(id)?.data.quantity !== qty) ||
      (rowsByChild.has('B-04') !== rowsByChild.has('T-BL')) ||
      c.targetRows.some(r => !packaging.has(r.data.child_id) && optionalPackaging.get(r.data.child_id) !== r.data.quantity)) {
    throw new Error(`대상 특A의 기존 포장재 BOM이 확인한 상태와 달라졌습니다: ${JSON.stringify(c.targetRows.map(r => ({ id: r.id, child: r.data.child_id, qty: r.data.quantity })))}`);
  }
  for (let i = 0; i < SOURCE_IDS.length; i++) {
    const source = c.sources[i];
    if (source.type !== 'product' || source.subtype !== '낱개' || source.spec !== '1750ml' ||
        !String(source.name ?? '').includes('특A')) throw new Error(`기준 특A 품목이 예상과 다릅니다: ${SOURCE_IDS[i]}`);
    const rows = c.sourceRows[i];
    const oil = rows.filter(r => r.data.child_id === WIP_ID);
    if (oil.length !== 1 || oil[0].data.quantity !== KG_PER_BOTTLE || oil[0].data.companyId !== COMPANY ||
        rows.some(r => r.data.companyId !== COMPANY || r.data.parent_id !== SOURCE_IDS[i])) {
      throw new Error(`기준 특A 벌크 BOM 1.603kg/병을 확인할 수 없습니다: ${SOURCE_IDS[i]}`);
    }
  }
  const formula = new Map(c.formulaRows.map(r => [String(r.data.child_name), r.data]));
  if (c.formulaRows.length !== 2 || formula.size !== 2 ||
      c.formulaRows.some(r => r.data.companyId !== COMPANY || r.data.parent_key !== '참기름특A') ||
      formula.get('통깨참기름')?.ratio !== 0.5 || formula.get('깨분참기름')?.ratio !== 0.5 ||
      c.formulaRows.some(r => r.data.yield_rate !== undefined && r.data.yield_rate !== 1)) {
    throw new Error('참기름특A 반제품의 DB 배합이 통깨/깨분 50:50과 다릅니다.');
  }
}

const after = { parent_id: TARGET_ID, child_id: WIP_ID, quantity: KG_PER_BOTTLE, companyId: COMPANY };
if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없습니다: ${BACKUP}`);
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as Backup;
  if (backup.projectId !== 'taebaek-3abe4' || backup.path !== `item_bom/${BOM_ID}` || backup.before !== null || !same(backup.after, after)) {
    throw new Error('백업 대상·변경값이 이 스크립트와 다릅니다.');
  }
  await db.runTransaction(async tx => {
    const [current, targetItem] = await Promise.all([tx.get(newRef), tx.get(db.collection('items').doc(TARGET_ID))]);
    if (targetItem.data()?.companyId !== COMPANY || !current.exists || !same(current.data(), backup.after)) {
      throw new Error('회사 또는 적용된 BOM 문서가 변경돼 복원을 중단합니다.');
    }
    tx.delete(newRef);
  });
  if ((await newRef.get()).exists) throw new Error('복원 후 재조회에서 BOM 문서가 남아 있습니다.');
  console.log(`복원 완료: item_bom/${BOM_ID} 삭제. 포장재·원료·주문·재고는 변경하지 않았습니다.`);
  process.exit(0);
}

const before = await readContext();
checkContext(before);
if (existsSync(BACKUP)) throw new Error(`백업이 이미 있습니다. 중복 적용을 중단합니다: ${BACKUP}`);
console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry',
  projectId: 'taebaek-3abe4', companyId: COMPANY,
  newDocument: `item_bom/${BOM_ID}`,
  before: null, after,
  sourceBom: SOURCE_IDS.map((id, i) => ({ itemId: id, oilBomId: before.sourceRows[i].find(r => r.data.child_id === WIP_ID)?.id, kgPerBottle: KG_PER_BOTTLE })),
  boxCount: 10,
  expectedRawKgPerBottle: { 통깨참기름: 0.8015, 깨분참기름: 0.8015 },
  historicalOrdersAndInventoryUntouched: true,
  backupOnApply: BACKUP,
}, null, 2));
if (!APPLY) process.exit(0);

mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ projectId: 'taebaek-3abe4', path: `item_bom/${BOM_ID}`,
  savedAt: new Date().toISOString(), before: null, after, context: before } satisfies Backup, null, 2),
{ encoding: 'utf8', flag: 'wx' });
try {
  await db.runTransaction(async tx => {
    const current = await readContext(tx);
    checkContext(current);
    if (!same(current, before)) throw new Error('dry 이후 품목·BOM이 변경돼 적용을 중단합니다.');
    tx.create(newRef, after);
  });
} catch (error) {
  console.error(`적용 결과가 불명확합니다. 백업을 보존하고 item_bom/${BOM_ID}를 재조회하세요: ${error instanceof Error ? error.message : String(error)}`);
  throw error;
}
const verified = await newRef.get();
if (!same(verified.data(), after)) throw new Error('적용 후 재조회가 예상 BOM과 다릅니다.');
console.log(`적용·재조회 완료. 백업: ${BACKUP}. 되돌리기: npx tsx scripts/fix-ilsung-square-special-a-bom.mts --undo`);
