import { adminDb } from './_admin.mts';
import { Timestamp } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative, dirname, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { getApp } from 'firebase-admin/app';
import type { Plan, Document, Applied } from './shared/zeroItemPriceMigration';
const { prepareZeroItemPrice, checkPlan, checkMigrationState, commitZeroItemPrice } = createRequire(import.meta.url)('./shared/zeroItemPriceMigration.ts') as typeof import('./shared/zeroItemPriceMigration');
const args = process.argv.slice(2);
const value = (key: string) => args.find(arg => arg.startsWith(`${key}=`))?.slice(key.length + 1);
if (args.includes('--apply') && args.includes('--undo')) throw Error('apply/undo 동시 지정 금지');
const mode = args.includes('--undo') ? 'undo' : args.includes('--apply') ? 'apply' : 'dry';
const companyId = value('--company');
if (companyId !== 'taebaek' && companyId !== 'punghoe') throw Error('--company=taebaek|punghoe 지정이 필요합니다.');
const backup = resolve(value('--backup') ?? `work/zero-item-price-${companyId}-${Date.now()}.json`);
const inside = relative(resolve('work'), backup);
if (!inside || isAbsolute(inside) || inside.startsWith('..') || resolve(backup) === resolve('work')) throw Error('비공개 work 백업 파일을 지정하세요.');
if (process.env.FIRESTORE_EMULATOR_HOST) throw Error('이 CLI는 운영 전용이며 자동 실행하지 않습니다.');
const db = adminDb();
if (getApp().options.projectId !== 'taebaek-3abe4') throw Error('프로젝트 불일치');
// JSON은 Timestamp/비유한수/undefined를 잃으므로 원문을 명시적으로 보존한다.
const encode = (v: any): any => {
  if (v instanceof Timestamp) return { __zeroMigrationType: 'timestamp', seconds: v.seconds, nanoseconds: v.nanoseconds };
  if (v === undefined) return { __zeroMigrationType: 'undefined' };
  if (typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0))) return { __zeroMigrationType: 'number', value: Object.is(v, -0) ? '-0' : String(v) };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') {
    if (Object.getPrototypeOf(v) !== Object.prototype || Object.hasOwn(v, '__zeroMigrationType')) throw Error('지원하지 않는 원문 타입. 적용 보류');
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  }
  return v;
};
const decode = (v: any): any => v?.__zeroMigrationType === 'timestamp' ? new Timestamp(v.seconds, v.nanoseconds)
  : v?.__zeroMigrationType === 'undefined' ? undefined : v?.__zeroMigrationType === 'number' ? Number(v.value)
  : Array.isArray(v) ? v.map(decode) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)])) : v;
const stable = (v: any): any => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(stable(encode(v)))).digest('hex');
const version = (snap: any) => ({ seconds: snap.updateTime.seconds, nanoseconds: snap.updateTime.nanoseconds });
const document = (snap: any): Document => {
  if (!snap.exists) throw Error('품목 삭제/부재');
  return { id: snap.id, data: snap.data(), version: version(snap) };
};
const write = (path: string, data: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(encode(data), null, 2), { flag: 'wx' }); };
const read = (path: string) => decode(JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')));

if (mode === 'dry') {
  if (existsSync(backup)) throw Error('기존 백업 덮어쓰기 금지');
  const snapshot = await db.collection('items').get();
  const plan = prepareZeroItemPrice(companyId, snapshot.docs.map(document));
  const planHash = hash(plan);
  write(backup, { plan, planHash });
  console.log(JSON.stringify({ mode, companyId, documents: plan.documents.length, writes: 0, planHash }));
} else {
  const { plan, planHash } = read(backup) as { plan: Plan; planHash: string };
  checkPlan(plan);
  if (plan.companyId !== companyId || hash(plan) !== planHash || value('--approved-hash') !== planHash) throw Error('회사/원문/승인 hash 불일치');
  const appliedPath = `${backup}.applied.json`, undonePath = `${backup}.undone.json`;
  const refs = plan.documents.map(row => db.collection('items').doc(row.id));
  const readCurrent = async () => refs.length ? (await db.getAll(...refs)).map(document) : [];
  if ((mode === 'apply' && existsSync(appliedPath)) || (mode === 'undo' && existsSync(undonePath))) {
    const receipt = read(mode === 'apply' ? appliedPath : undonePath) as Applied;
    checkMigrationState(plan, await readCurrent(), mode === 'apply' ? 'duplicate' : 'undone', receipt, planHash);
    console.log(JSON.stringify({ mode, status: 'duplicate', companyId, writes: 0 }));
  } else {
    if (mode === 'apply' && existsSync(undonePath)) throw Error('복원된 계획 재적용 금지');
    const receipt = mode === 'undo' ? read(appliedPath) as Applied : undefined;
    const confirmed = await commitZeroItemPrice(db, plan, await readCurrent(), mode, planHash, receipt);
    // 정확한 commit 버전을 먼저 남긴다. 이후 조회는 독립 검증이며 이 버전을 교체하지 않는다.
    write(mode === 'apply' ? appliedPath : undonePath, confirmed);
    const current = await readCurrent();
    checkMigrationState(plan, current, mode === 'apply' ? 'duplicate' : 'undone', confirmed, planHash);
    console.log(JSON.stringify({ mode, status: 'applied', companyId, changedDocuments: current.length, verified: true, costWrites: 0, financialWrites: 0 }));
  }
}
