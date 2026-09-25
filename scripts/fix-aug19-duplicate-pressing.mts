// 8/19 작업일에 8/20 입력된 태백식품의 중복 착유 750kg과 자동 기름 360kg만 제거한다.
// 이후 실사 앵커가 현재고를 확정했으므로 현재 품목·원료 상태 수량은 변경하지 않는다.
// --dry(기본) / --apply / --undo. Admin SDK는 규칙을 우회하므로 대상·백업을 직접 검증한다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { adminDb } from './_admin.mts';

type Data = Record<string, any>;
type Snapshot = Record<string, Data | null>;
const db = adminDb();
const USE = 'rawMaterialLedger/rm-use-1787204085718';
const YIELD = 'rawMaterialLedger/rm-yield-1787204085810';
const OIL_ITEM = 'items/raw-통깨참기름';
const OIL_STATE = 'rawInventories/taebaek__raw-통깨참기름';
const SESAME_ITEM = 'items/p-1779251176421';
const SESAME_STATE = 'rawInventories/taebaek__p-1779251176421';
const LOT_ID = 'lot-통깨참기름-1787204085866-9jau';
const PATHS = [USE, YIELD, OIL_ITEM, OIL_STATE, SESAME_ITEM, SESAME_STATE];
const BACKUP = '로컬전용/백업/aug19-duplicate-pressing-2026-09-25.json';
const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
if (APPLY && UNDO) throw new Error('--apply와 --undo를 함께 사용할 수 없습니다.');

function plain(value: unknown): any { return JSON.parse(JSON.stringify(value)); }
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function assertPlain(value: unknown, path: string): void {
  if (value == null || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach((v, i) => assertPlain(v, `${path}[${i}]`)); return; }
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`백업 불가능한 값: ${path}`);
  Object.entries(value).forEach(([k, v]) => assertPlain(v, `${path}.${k}`));
}
async function readPaths(): Promise<Snapshot> {
  const snaps = await Promise.all(PATHS.map(path => db.doc(path).get()));
  return Object.fromEntries(snaps.map((snap, i) => {
    const data = snap.exists ? snap.data() as Data : null;
    if (data) assertPlain(data, PATHS[i]);
    return [PATHS[i], data ? plain(data) : null];
  }));
}
function assertBaseline(before: Snapshot): void {
  const use = before[USE], oilIn = before[YIELD], oil = before[OIL_ITEM], oilState = before[OIL_STATE];
  const sesame = before[SESAME_ITEM], sesameState = before[SESAME_STATE];
  if (!use || use.companyId !== 'taebaek' || use.material !== '참깨' || use.date !== '2026-08-19'
    || use.used !== 750 || use.received !== 0 || use.addedBy !== '태백식품'
    || use.note !== '사장님 저녁 근무' || use.rawItemId !== 'p-1779251176421') {
    throw new Error('중복 참깨 사용 기록이 예상과 다릅니다.');
  }
  if (!oilIn || oilIn.companyId !== 'taebaek' || oilIn.material !== '통깨참기름'
    || oilIn.date !== '2026-08-19' || oilIn.received !== 360 || oilIn.used !== 0
    || oilIn.note !== '참깨 압착 (수율 48%)' || oilIn.rawItemId !== 'raw-통깨참기름') {
    throw new Error('연결된 기름 자동 입고 기록이 예상과 다릅니다.');
  }
  if (!oil || !oilState || !sesame || !sesameState
    || oil.companyId !== 'taebaek' || oilState.companyId !== 'taebaek'
    || sesame.companyId !== 'taebaek' || sesameState.companyId !== 'taebaek') {
    throw new Error('현재 품목·원료 상태의 회사가 예상과 다릅니다.');
  }
  const lot = (oil.lots ?? []).find((row: Data) => row.id === LOT_ID);
  if (!lot || lot.receivedDate !== '2026-08-19' || lot.kgIn !== 360
    || lot.kgRemaining !== 0 || lot.status !== 'depleted') {
    throw new Error('중복 기름의 소진 로트가 예상과 다릅니다.');
  }
  const stateLot = (oilState.recentDepletedLots ?? []).find((row: Data) => row.id === LOT_ID);
  if ((oilState.activeLots ?? []).some((row: Data) => row.id === LOT_ID)
    || !stateLot || stateLot.kgRemaining !== 0 || stateLot.status !== 'depleted'
    || stateLot.kgIn !== 360 || stateLot.receivedDate !== '2026-08-19') {
    throw new Error('중복 기름 로트의 현재 원료 상태가 예상과 다릅니다.');
  }
  if (Number(oil.stock) !== Number(oilState.stockKg)
    || Number(sesame.stock) !== Number(sesameState.stockKg)) {
    throw new Error('현재 품목·원료 상태의 재고가 서로 다릅니다.');
  }
}

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없습니다: ${BACKUP}`);
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as { before: Snapshot; after: Snapshot };
  if (!same(Object.keys(backup.before).sort(), [...PATHS].sort())) throw new Error('백업 대상이 다릅니다.');
  await db.runTransaction(async tx => {
    const snaps = await Promise.all(PATHS.map(path => tx.get(db.doc(path))));
    snaps.forEach((snap, i) => {
      if (!same(snap.exists ? snap.data() : null, backup.after[PATHS[i]])) {
        throw new Error(`적용 뒤 변경되어 되돌리기를 중단합니다: ${PATHS[i]}`);
      }
    });
    PATHS.forEach(path => backup.before[path] == null
      ? tx.delete(db.doc(path)) : tx.set(db.doc(path), backup.before[path]!));
  });
  if (!same(await readPaths(), backup.before)) throw new Error('되돌린 뒤 재조회가 백업과 다릅니다.');
  console.log('8/19 중복 착유 정정 복원 완료');
  process.exit(0);
}

const before = await readPaths();
assertBaseline(before);
const after: Snapshot = { ...before, [USE]: null, [YIELD]: null,
  [OIL_ITEM]: { ...before[OIL_ITEM]!, lots: before[OIL_ITEM]!.lots.filter((row: Data) => row.id !== LOT_ID) },
  [OIL_STATE]: { ...before[OIL_STATE]!, recentDepletedLots: before[OIL_STATE]!.recentDepletedLots.filter((row: Data) => row.id !== LOT_ID) } };
console.log(JSON.stringify({ mode: APPLY ? '적용' : '미리보기(dry)',
  removeUse: { id: USE, sesameKg: 750 }, removeYield: { id: YIELD, oilKg: 360 },
  removeDepletedLot: LOT_ID,
  currentStockUnchanged: { sesameKg: before[SESAME_ITEM]!.stock, oilKg: before[OIL_ITEM]!.stock },
  backup: BACKUP }, null, 2));
if (!APPLY) process.exit(0);
if (existsSync(BACKUP)) throw new Error(`백업이 이미 있습니다. 중복 적용을 중단합니다: ${BACKUP}`);
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ savedAt: new Date().toISOString(), before, after }, null, 2),
  { encoding: 'utf8', flag: 'wx' });
await db.runTransaction(async tx => {
  const snaps = await Promise.all(PATHS.map(path => tx.get(db.doc(path))));
  snaps.forEach((snap, i) => {
    if (!same(snap.exists ? snap.data() : null, before[PATHS[i]])) {
      throw new Error(`미리보기 뒤 문서가 변경되었습니다: ${PATHS[i]}`);
    }
  });
  tx.delete(db.doc(USE));
  tx.delete(db.doc(YIELD));
  tx.set(db.doc(OIL_ITEM), after[OIL_ITEM]!);
  tx.set(db.doc(OIL_STATE), after[OIL_STATE]!);
});
if (!same(await readPaths(), after)) throw new Error('적용 뒤 재조회가 예상과 다릅니다.');
console.log('8/19 중복 착유 정정 완료: 원장 2건·소진 로트 1건 제거, 현재고는 불변');
