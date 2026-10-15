import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { require as loadTs } from 'tsx/cjs/api';
import { cliToken } from './diag-zero-item-price-20261015.mts';
import { decodeRestValue, timestamp } from './prepare-zero-item-price-dry-20261015.mts';

const database = 'projects/taebaek-3abe4/databases/(default)';
const documentRoot = `${database}/documents/`;
const sourcePaths = ['src/shared/types.ts', 'src/shared/partnerShipping.ts', 'scripts/migrate-partner-shipping-defaults-20261015.mts'];
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const own = (value: object, key: string) => Object.hasOwn(value, key);
function check(value: unknown, message = '배송 기본값 계획·원문·승인 해시를 확인하세요.'): asserts value { if (!value) throw Error(message); }
function object(value: any): asserts value is Record<string, any> { check(value && typeof value === 'object' && !Array.isArray(value)); }
function stable(value: any): any { return Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value; }
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
function sources() { return Object.fromEntries(sourcePaths.map(path => [path, createHash('sha256').update(readFileSync(resolve(path))).digest('hex')])); }
function helpers() {
  return {
    ...(loadTs('../src/shared/partnerShipping.ts', import.meta.url) as typeof import('../src/shared/partnerShipping.ts')),
    companyOf: (loadTs('../src/shared/types.ts', import.meta.url) as typeof import('../src/shared/types.ts')).companyOf,
  };
}
export type RestDocument = { name: string; fields: Record<string, any>; updateTime: string; createTime?: string };
export type Snapshot = { partners: RestDocument[]; orders: RestDocument[] };
type Change = { name: string; before: RestDocument; after: RestDocument; mask: string[]; scopes: { shipToId?: string; method: string; latestDate: string }[] };
export type Plan = { version: 1; project: 'taebaek-3abe4'; atomicSnapshot: false; orderDateMeaning: 'createdAt-KST-calendar-date'; sourceHashes: Record<string, string>; snapshot: Snapshot; changes: Change[]; summary: Record<string, number> };
export type Receipt = { version: 1; planHash: string; mode: 'apply' | 'undo'; operationId: string; documents: { name: string; updateTime: string }[] };

function validateDocument(doc: RestDocument, collection: 'partners' | 'orders') {
  object(doc); check(Object.keys(doc).every(key => ['name', 'fields', 'updateTime', 'createTime'].includes(key)));
  check(typeof doc.name === 'string' && doc.name.startsWith(documentRoot + collection + '/'));
  const id = doc.name.slice((documentRoot + collection + '/').length); check(id && !id.includes('/') && !['.', '..'].includes(id));
  object(doc.fields); timestamp(doc.updateTime); if (doc.createTime !== undefined) timestamp(doc.createTime);
  check(isDeepStrictEqual(doc, clone(doc)), 'JSON 백업으로 손실되는 원문 타입이 있어 계획을 만들지 않았습니다.');
}
function field(doc: RestDocument, key: string): any { return own(doc.fields, key) ? decodeRestValue(doc.fields[key]) : undefined; }
function company(doc: RestDocument) { const value = helpers().companyOf({ companyId: field(doc, 'companyId') }); return value === 'taebaek' || value === 'punghoe' ? value : undefined; }
/** 날짜만 적힌 옛 주문은 그대로, 시각 있는 주문은 KST 날짜로 비교한다. 불가능한 달력 날짜는 넘기지 않는다. */
export function orderDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const date = /^(\d{4}-\d\d-\d\d)(?:T|$)/.exec(value)?.[1];
  if (!date || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) return undefined;
  if (value === date) return date;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) return undefined;
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return undefined;
  return new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 10);
}
function active(doc: RestDocument) {
  for (const key of ['archived', 'deleted', 'isDeleted', 'cancelled', 'canceled']) if (own(doc.fields, key) && field(doc, key) !== false) return false;
  for (const key of ['deletedAt', 'cancelledAt', 'canceledAt']) if (own(doc.fields, key)) return false;
  return true;
}
function eligibleOrder(doc: RestDocument) {
  return active(doc) && field(doc, 'purpose') !== 'stock-production' && ['PENDING', 'PROCESSING', 'SHIPPED', 'DISPATCHED', 'DELIVERED', 'ON_HOLD'].includes(field(doc, 'status'));
}
export function prepare(snapshot: Snapshot, sourceHashes: Record<string, string> = sources()): Plan {
  object(snapshot); check(Array.isArray(snapshot.partners) && Array.isArray(snapshot.orders));
  for (const collection of ['partners', 'orders'] as const) { const names = new Set<string>(); for (const doc of snapshot[collection]) { validateDocument(doc, collection); check(!names.has(doc.name)); names.add(doc.name); } }
  const { isShipMethod, isShippingPartner } = helpers();
  const summary: Record<string, number> = { partnersRead: snapshot.partners.length, ordersRead: snapshot.orders.length, partnerDefaults: 0, shipToDefaults: 0, existingField: 0, noHistory: 0, invalidDate: 0, latestMissingMethod: 0, latestConflict: 0, invalidShipTos: 0, unmatchedShipToOrders: 0, excludedPartners: 0, excludedOrders: 0 };
  const eligible = snapshot.orders.filter(row => { const yes = eligibleOrder(row); if (!yes) summary.excludedOrders++; return yes; });
  const changes: Change[] = [];
  for (const partner of snapshot.partners) {
    const co = company(partner), partnerId = partner.name.split('/').at(-1)!;
    if (!co || !active(partner) || !isShippingPartner(field(partner, 'partnerType'))) { summary.excludedPartners++; continue; }
    const rows = eligible.filter(order => company(order) === co && field(order, 'partnerId') === partnerId);
    const after = clone(partner), mask: string[] = [], scopes: Change['scopes'] = [];
    const originalShipTos = field(partner, 'shipTos');
    let shipTos: any[] | undefined;
    if (originalShipTos !== undefined) {
      if (!Array.isArray(originalShipTos) || originalShipTos.some(row => !row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string' || !row.id || own(row, 'archived') && typeof row.archived !== 'boolean') || new Set(originalShipTos.map(row => row.id)).size !== originalShipTos.length) summary.invalidShipTos++;
      else shipTos = originalShipTos;
    }
    summary.unmatchedShipToOrders += rows.filter(row => { const id = field(row, 'shipToId'); return id !== undefined && id !== '' && (!shipTos || !shipTos.some(destination => destination.id === id && !destination.archived)); }).length;
    const consider = (shipToId?: string, index?: number) => {
      const target = index === undefined ? partner.fields : originalShipTos[index];
      if (own(target, 'defaultShipMethod')) { summary.existingField++; return; }
      const history = rows.filter(row => shipToId === undefined ? field(row, 'shipToId') === undefined || field(row, 'shipToId') === '' : field(row, 'shipToId') === shipToId);
      if (!history.length) { summary.noHistory++; return; }
      const dated = history.map(row => ({ row, date: orderDate(field(row, 'createdAt')) }));
      if (dated.some(row => !row.date)) { summary.invalidDate++; return; }
      const latestDate = dated.map(row => row.date!).sort().at(-1)!;
      const methods = dated.filter(row => row.date === latestDate).map(({ row }) => { const method = field(row, 'shipMethod'); return method === '직접수령' ? '수령' : method; });
      if (methods.some(method => !isShipMethod(method))) { summary.latestMissingMethod++; return; }
      if (new Set(methods).size !== 1) { summary.latestConflict++; return; }
      const method = methods[0]; scopes.push({ ...(shipToId === undefined ? {} : { shipToId }), method, latestDate });
      if (index === undefined) { after.fields.defaultShipMethod = { stringValue: method }; mask.push('defaultShipMethod'); summary.partnerDefaults++; }
      else {
        // 배송지는 배열 전체를 쓰되 문서 전체 원문/버전 CAS로 다른 배송지의 동시 수정을 보존한다.
        const stored = after.fields.shipTos?.arrayValue?.values?.[index]?.mapValue?.fields; object(stored); stored.defaultShipMethod = { stringValue: method };
        if (!mask.includes('shipTos')) mask.push('shipTos'); summary.shipToDefaults++;
      }
    };
    consider(); shipTos?.forEach((destination, index) => { if (!destination.archived) consider(destination.id, index); });
    if (mask.length) changes.push({ name: partner.name, before: clone(partner), after, mask: mask.sort(), scopes });
  }
  changes.sort((a, b) => a.name.localeCompare(b.name));
  check(changes.length <= 450, '단일 원자 적용 한도 450문서를 넘었습니다. 자동 분할하지 않습니다.');
  return { version: 1, project: 'taebaek-3abe4', atomicSnapshot: false, orderDateMeaning: 'createdAt-KST-calendar-date', sourceHashes, snapshot: clone(snapshot), changes, summary };
}
export function checkPlan(plan: Plan, verifySource = true) {
  check(plan?.version === 1 && plan.project === 'taebaek-3abe4');
  if (verifySource) check(isDeepStrictEqual(plan.sourceHashes, sources()), '계획 이후 도구 또는 공용 판정이 바뀌었습니다. 새 검토가 필요합니다.');
  check(isDeepStrictEqual(plan, prepare(plan.snapshot, plan.sourceHashes)), '계획이 보관된 전체 원문에서 다시 계산한 결과와 다릅니다.');
}
type Request = (url: string, init: RequestInit) => Promise<{ status: number; json(): Promise<any> }>;
class CommitFailure extends Error {
  readonly outcome: 'rejected' | 'unknown';
  constructor(outcome: 'rejected' | 'unknown') { super(outcome === 'rejected' ? '서버가 원자 요청을 거절했습니다. 새 계획으로 검토하세요.' : '처리 결과가 불확실합니다. 보관된 요청과 서버 결과를 먼저 확인하세요.'); this.outcome = outcome; }
}
async function api(path: string, token: string, request: Request, body?: any) {
  check(typeof token === 'string' && token.trim().length > 0 && !/[\r\n]/.test(token));
  const response = await request('https://firestore.googleapis.com/v1/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error' });
  if (body !== undefined && path.endsWith('/documents:commit') && response.status !== 200) {
    const result = await response.json().catch(() => undefined), codes: Record<string, number> = { INVALID_ARGUMENT: 400, FAILED_PRECONDITION: 400, OUT_OF_RANGE: 400, UNAUTHENTICATED: 401, PERMISSION_DENIED: 403, NOT_FOUND: 404, ALREADY_EXISTS: 409, ABORTED: 409 };
    throw new CommitFailure(result?.error?.code === response.status && codes[result?.error?.status] === response.status ? 'rejected' : 'unknown');
  }
  check(response.status === 200, '서버 조회 또는 적용을 확인하지 못했습니다. 자동 재실행하지 마세요.'); return response.json();
}
const documentUrl = (name: string) => name.split('/').map(part => encodeURIComponent(part)).join('/');
export async function readAll(token: string, request: Request = fetch): Promise<Snapshot> {
  const snapshot: Snapshot = { partners: [], orders: [] };
  for (const collection of ['partners', 'orders'] as const) {
    let next = ''; const pages = new Set<string>();
    do {
      check(!pages.has(next) && pages.size < 10000); pages.add(next);
      const body = await api(`${database}/documents/${collection}?pageSize=1000${next ? '&pageToken=' + encodeURIComponent(next) : ''}`, token, request); object(body);
      check(Object.keys(body).every(key => ['documents', 'nextPageToken'].includes(key)) && (body.documents === undefined || Array.isArray(body.documents)));
      snapshot[collection].push(...(body.documents ?? []).map((row: RestDocument) => ({ ...row, fields: row.fields ?? {} })));
      check(body.nextPageToken === undefined || typeof body.nextPageToken === 'string' && body.nextPageToken.length > 0); next = body.nextPageToken ?? '';
    } while (next);
    snapshot[collection].forEach(doc => validateDocument(doc, collection)); snapshot[collection].sort((a, b) => a.name.localeCompare(b.name));
  }
  return snapshot;
}
function checkReceipt(plan: Plan, receipt: Receipt) {
  check(receipt?.version === 1 && receipt.planHash === hash(plan) && receipt.mode === 'apply' && typeof receipt.operationId === 'string' && receipt.operationId.length > 0 && Array.isArray(receipt.documents) && receipt.documents.length === plan.changes.length);
  receipt.documents.forEach((row, i) => { check(row.name === plan.changes[i].name); check(timestamp(row.updateTime).valueOf() > timestamp(plan.changes[i].before.updateTime).valueOf()); });
}
export function writes(plan: Plan, mode: 'apply' | 'undo', current: RestDocument[], receipt?: Receipt) {
  checkPlan(plan); check(plan.changes.length > 0 && current.length === plan.changes.length && new Set(current.map(row => row.name)).size === current.length);
  if (mode === 'undo') checkReceipt(plan, receipt!);
  return plan.changes.map((change, index) => {
    const expected = mode === 'apply' ? change.before : { ...change.after, updateTime: receipt!.documents[index].updateTime };
    const now = current.find(row => row.name === change.name); check(isDeepStrictEqual(now, expected), '전체 원문 또는 버전이 달라 쓰지 않았습니다. 새 계획과 승인이 필요합니다.');
    const target = mode === 'apply' ? change.after : change.before;
    return { update: { name: change.name, fields: Object.fromEntries(change.mask.filter(key => own(target.fields, key)).map(key => [key, target.fields[key]])) }, updateMask: { fieldPaths: change.mask }, currentDocument: { updateTime: expected.updateTime } };
  });
}
type IO = { exists(path: string): boolean; read(path: string): string; write(path: string, text: string): void; remove(path: string): void };
const files: IO = { exists: existsSync, read: path => readFileSync(path, 'utf8'), write: (path, text) => writeFileSync(path, text, { flag: 'wx', mode: 0o600 }), remove: unlinkSync };
export function options(args: string[]) {
  const flags = args.filter(arg => ['--dry', '--apply', '--undo'].includes(arg)); check(flags.length <= 1);
  const values = new Map<string, string>(); for (const arg of args) { if (flags.includes(arg)) continue; const split = arg.indexOf('='); check(split > 0); const key = arg.slice(0, split); check(['--plan', '--summary', '--auth', '--approved-hash'].includes(key) && !values.has(key) && arg.slice(split + 1)); values.set(key, arg.slice(split + 1)); }
  const mode = (flags[0]?.slice(2) ?? 'dry') as 'dry' | 'apply' | 'undo'; check(values.get('--auth') === 'firebase-cli');
  const plan = resolve(values.get('--plan') ?? ''); check(values.has('--plan') && dirname(plan) === resolve('work') && plan.endsWith('.json'));
  const summary = values.has('--summary') ? resolve(values.get('--summary')!) : undefined;
  if (mode === 'dry') check(summary && summary !== plan && !values.has('--approved-hash')); else check(!summary && /^[a-f0-9]{64}$/.test(values.get('--approved-hash') ?? ''));
  return { mode, plan, summary, approvedHash: values.get('--approved-hash') };
}
export async function run(args: string[], dep: { io: IO; token(): Promise<string>; request: Request } = { io: files, token: cliToken, request: fetch }) {
  check(resolve('.') === resolve(fileURLToPath(new URL('../', import.meta.url))));
  check(!process.env.FIRESTORE_EMULATOR_HOST); const opt = options(args), io = dep.io;
  const side = (suffix: string) => opt.plan + suffix;
  const family = ['.lock', '.apply.intent.json', '.apply.receipt.json', '.apply.failure.json', '.undo.intent.json', '.undo.receipt.json', '.undo.failure.json'];
  if (opt.mode === 'dry') {
    check(!io.exists(opt.plan) && !io.exists(opt.summary!) && family.every(suffix => !io.exists(side(suffix))), '기존 계획 또는 실행 기록을 덮어쓰지 않았습니다.');
    const plan = prepare(await readAll(await dep.token(), dep.request)), planHash = hash(plan);
    io.write(opt.plan, JSON.stringify({ version: 1, planHash, plan }, null, 2));
    io.write(opt.summary!, JSON.stringify({ version: 1, planHash, atomicSnapshot: false, orderDateMeaning: plan.orderDateMeaning, summary: plan.summary, documents: plan.changes.length, productionWrites: 0 }, null, 2));
    return { mode: 'dry', planHash, documents: plan.changes.length, writes: 0, summary: plan.summary };
  }
  const saved = JSON.parse(io.read(opt.plan)), plan: Plan = saved.plan; checkPlan(plan); const planHash = hash(plan); check(saved.version === 1 && saved.planHash === planHash && opt.approvedHash === planHash);
  check(!io.exists(side('.lock')) && !io.exists(side('.undo.intent.json')) && !io.exists(side('.undo.receipt.json')));
  let receipt: Receipt | undefined;
  if (opt.mode === 'apply') check(!io.exists(side('.apply.intent.json')) && !io.exists(side('.apply.receipt.json')) && !io.exists(side('.apply.failure.json')));
  else { check(!io.exists(side('.apply.failure.json'))); receipt = JSON.parse(io.read(side('.apply.receipt.json'))); checkReceipt(plan, receipt!); const intent = JSON.parse(io.read(side('.apply.intent.json'))); check(intent.planHash === planHash && intent.mode === 'apply' && intent.operationId === receipt!.operationId); }
  const token = await dep.token(), operationId = randomUUID(), lock = JSON.stringify({ version: 1, planHash, mode: opt.mode, operationId }); io.write(side('.lock'), lock);
  let sent = false;
  try {
    // 최신 주문이 추가된 계획은 그대로 적용하지 않는다. 이 재조회도 원자 스냅샷은 아니며 쓰기 CAS는 거래처 문서를 보호한다.
    if (opt.mode === 'apply') check(isDeepStrictEqual(await readAll(token, dep.request), plan.snapshot), '계획 뒤 거래처 또는 주문 이력이 바뀌었습니다. 새 계획이 필요합니다.');
    const current = await Promise.all(plan.changes.map(change => api(documentUrl(change.name), token, dep.request).then(doc => ({ ...doc, fields: doc.fields ?? {} }))));
    const payload = writes(plan, opt.mode, current, receipt); io.write(side(`.${opt.mode}.intent.json`), lock); sent = true;
    const response = await api(`${database}/documents:commit`, token, dep.request, { writes: payload });
    object(response); check(Array.isArray(response.writeResults) && response.writeResults.length === plan.changes.length && !response.error);
    const proof: Receipt = { version: 1, planHash, mode: opt.mode, operationId, documents: response.writeResults.map((result: any, i: number) => { object(result); check(!result.transformResults || Array.isArray(result.transformResults) && result.transformResults.length === 0); check(timestamp(result.updateTime).valueOf() > timestamp(current[i].updateTime).valueOf()); return { name: plan.changes[i].name, updateTime: result.updateTime }; }) };
    // 영수증은 서버의 실제 버전이다. 사후 조회 실패여도 없던 요청처럼 다시 보내지 않는다.
    io.write(side(`.${opt.mode}.receipt.json`), JSON.stringify(proof, null, 2));
    for (const [i, change] of plan.changes.entries()) { const now = await api(documentUrl(change.name), token, dep.request); check(isDeepStrictEqual({ ...now, fields: now.fields ?? {} }, { ...(opt.mode === 'apply' ? change.after : change.before), updateTime: proof.documents[i].updateTime })); }
    check(io.read(side('.lock')) === lock); io.remove(side('.lock'));
    return { mode: opt.mode, planHash, documents: payload.length, writes: payload.length };
  } catch (error) {
    if (sent) { try { io.write(side(`.${opt.mode}.failure.json`), JSON.stringify({ version: 1, planHash, operationId, mode: opt.mode, outcome: error instanceof CommitFailure ? error.outcome : 'unknown' })); } catch {} }
    else if (io.exists(side('.lock')) && io.read(side('.lock')) === lock) io.remove(side('.lock'));
    throw error;
  }
}
export function selfCheck() {
  check(orderDate('2026-10-14T16:00:00Z') === '2026-10-15' && orderDate('2026-02-30') === undefined);
  return { selfCheck: 'passed', productionReads: 0, productionWrites: 0, outputWritten: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(process.argv.slice(2).join(' ') === '--self-check' ? selfCheck() : await run(process.argv.slice(2)))); } catch { console.error('배송 기본값 이관을 완료하지 못했습니다. 계획·원문·실행 기록을 확인하세요. 자동 재실행하지 마세요.'); process.exitCode = 1; }
}
