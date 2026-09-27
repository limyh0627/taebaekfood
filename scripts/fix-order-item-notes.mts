/** 주문 품목 메모를 주문 비고로 이관한다. 운영 기본값은 읽기 전용 dry다. */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrateOrderItemNotes } from '../src/shared/orderNote.ts';
import { adminDb } from './_admin.mts';

const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--plan') {
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('--plan 파일 경로가 필요합니다.');
    index++;
  } else if (!['--dry', '--apply', '--undo', '--emulator'].includes(args[index])) throw new Error(`모르는 옵션: ${args[index]}`);
}
if (['--dry', '--apply', '--undo'].filter(mode => args.includes(mode)).length > 1) throw new Error('실행 모드는 하나만 지정하세요.');
const apply = args.includes('--apply');
const undo = args.includes('--undo');
if (apply && undo) throw new Error('--apply와 --undo를 같이 쓸 수 없습니다.');
const local = args.includes('--emulator');
const projectId = local ? 'demo-taebaekfood-local' : 'taebaek-3abe4';
if (local) process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8082';
if (!local && process.env.FIRESTORE_EMULATOR_HOST) throw new Error('에뮬레이터는 --emulator를 명시해야 합니다.');
if (local && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST!)) throw new Error('로컬 에뮬레이터 주소만 허용합니다.');
const option = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const planPath = option('--plan') || `로컬전용/order-item-notes/${local ? 'emulator' : 'production'}-plan.json`;
const backupPath = `${planPath}.backup.json`;
const db = local ? getFirestore(initializeApp({ projectId })) : adminDb();
const fields = ['items', 'note', 'noteImportant', 'noteBy', 'noteAt'] as const;
const scope = (data: Record<string, any>) => Object.fromEntries(fields.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]));
const tag = '__orderNoteTimestamp';
const encode = (value: any): any => {
  if (value instanceof Timestamp) return { [tag]: [value.seconds, value.nanoseconds] };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.hasOwn(value, tag)) throw new Error('지원하지 않는 특수 객체/백업 표식 충돌이 있어 중단합니다.');
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, encode(value[key])]));
  }
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('JSON으로 보존할 수 없는 값이 있어 중단합니다.');
  return value;
};
const decode = (value: any): any => {
  if (value && typeof value === 'object' && Object.hasOwn(value, tag)) {
    if (Object.keys(value).length !== 1 || !Array.isArray(value[tag]) || value[tag].length !== 2 || !value[tag].every(Number.isInteger)) throw new Error('잘못된 Timestamp 백업 표식입니다.');
    return new Timestamp(...value[tag] as [number, number]);
  }
  return Array.isArray(value) ? value.map(decode) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, decode(entry)])) : value;
};
const fingerprint = (value: any) => JSON.stringify(encode(value));
type Row = { id: string; companyId?: string; before: Record<string, any>; after: Record<string, any> };
type Plan = { projectId: string; createdAt: string; rows: Row[] };
const save = (path: string, value: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(encode(value), null, 2), { flag: 'wx' }); };
const read = (path: string): Plan => decode(JSON.parse(readFileSync(path, 'utf8')));
const verify = (plan: Plan) => {
  if (plan.projectId !== projectId || !Array.isArray(plan.rows)) throw new Error('계획의 프로젝트/형식이 현재 대상과 다릅니다.');
  if (plan.rows.length > 400) throw new Error('400건 초과라 원자 이관을 중단합니다. 팀장 검토가 필요합니다.');
  if (new Set(plan.rows.map(row => row.id)).size !== plan.rows.length) throw new Error('중복 주문이 있는 계획입니다.');
  for (const row of plan.rows) {
    if (!row.id || row.id.includes('/') || !Array.isArray(row.before.items)) throw new Error('잘못된 주문 계획입니다.');
    if (Object.keys(row.before).some(key => !fields.includes(key as any)) || Object.keys(row.after).some(key => !fields.includes(key as any))) throw new Error('허용 필드 밖의 변경 계획입니다.');
    if (fingerprint(scope(migrateOrderItemNotes(row.before as any))) !== fingerprint(row.after)) throw new Error('공용 이관 함수와 다른 변경 계획입니다.');
    for (const value of [row.before, row.after]) if (fingerprint(decode(encode(value))) !== fingerprint(value)) throw new Error('백업 왕복 검증 실패입니다.');
  }
};
const patch = (target: Record<string, any>) => Object.fromEntries(fields.map(key => [key, Object.hasOwn(target, key) ? target[key] : FieldValue.delete()]));
const change = async (rows: Row[], reverse: boolean) => db.runTransaction(async tx => {
  if (!rows.length) return 0;
  const docs = await tx.getAll(...rows.map(row => db.collection('orders').doc(row.id)));
  const changes = rows.flatMap((row, index) => {
    const current = docs[index];
    const expected = reverse ? row.after : row.before;
    const target = reverse ? row.before : row.after;
    if (!current.exists || current.data()!.companyId !== row.companyId) throw new Error(`${row.id}: 주문/회사 동시변경이 있어 전체 중단합니다.`);
    const actual = scope(current.data()!);
    if (reverse && fingerprint(actual) === fingerprint(target)) return [];
    if (fingerprint(actual) !== fingerprint(expected)) throw new Error(`${row.id}: 비고/품목 동시변경이 있어 전체 중단합니다.`);
    return [{ ref: current.ref, target }];
  });
  for (const entry of changes) tx.update(entry.ref, patch(entry.target));
  return changes.length;
});
const confirm = async (rows: Row[], reverse: boolean) => {
  for (const row of rows) {
    const current = await db.collection('orders').doc(row.id).get();
    if (!current.exists || fingerprint(scope(current.data()!)) !== fingerprint(reverse ? row.before : row.after)) throw new Error(`${row.id}: 적용 후 재조회 검증 실패입니다.`);
  }
};

try {
  if (undo) {
    if (!existsSync(backupPath)) throw new Error('원본 백업이 없습니다.');
    const backup = read(backupPath); verify(backup);
    const changed = await change(backup.rows, true);
    await confirm(backup.rows, true);
    console.log(`되돌리기 ${changed}건, 이미 원본인 ${backup.rows.length - changed}건`);
  } else if (apply) {
    if (existsSync(backupPath)) throw new Error('기존 백업이 있어 재적용을 차단합니다.');
    const plan = read(planPath); verify(plan);
    // 전체 대조를 먼저 해 부분 적용을 줄인다. 실제 쓰기도 트랜잭션에서 다시 대조한다.
    for (const row of plan.rows) {
      const current = await db.collection('orders').doc(row.id).get();
      if (!current.exists || current.data()!.companyId !== row.companyId || fingerprint(scope(current.data()!)) !== fingerprint(row.before)) throw new Error(`${row.id}: 승인 계획 뒤 동시변경이 있어 중단합니다.`);
    }
    save(backupPath, plan);
    const changed = await change(plan.rows, false);
    await confirm(plan.rows, false);
    console.log(`이관 ${changed}건. 원본 백업: ${backupPath}`);
  } else {
    if (existsSync(planPath)) throw new Error('기존 계획을 덮어쓰지 않습니다. 새 --plan 경로를 지정하세요.');
    const docs = await db.collection('orders').get();
    const rows: Row[] = docs.docs.flatMap(doc => {
      const data = doc.data();
      if (!Array.isArray(data.items)) return [];
      const next = migrateOrderItemNotes(data as any);
      return next === data ? [] : [{ id: doc.id, ...(data.companyId ? { companyId: data.companyId } : {}), before: scope(data), after: scope(next) }];
    });
    const summary = rows.reduce<Record<string, number>>((sum, row) => { const company = row.companyId || '회사값 없음'; sum[company] = (sum[company] || 0) + 1; return sum; }, {});
    console.log(JSON.stringify({ mode: 'dry', projectId, scanned: docs.size, targets: rows.length, companies: summary, orders: rows.map(row => ({ id: row.id, companyId: row.companyId, noteLength: String(row.after.note || '').length, important: !!row.after.noteImportant })) }, null, 2));
    const plan = { projectId, createdAt: new Date().toISOString(), rows };
    verify(plan);
    save(planPath, plan);
    console.log(`계획 저장: ${planPath} (운영 쓰기 없음)`);
  }
} finally { await db.terminate(); }
