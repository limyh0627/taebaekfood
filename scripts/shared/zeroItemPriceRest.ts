import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { checkPlan, type Plan, type Applied, type Version } from './zeroItemPriceMigration';
import { encode, decode } from './zeroItemPriceBackup';

type Outcome = 'not-started' | 'rejected' | 'unknown';
export type ZeroPriceRestTransport = (request: {
  url: string; method: 'POST'; headers: Record<string, string>; body: { writes: unknown[] };
}) => Promise<{ status: number; body: unknown }>;
export class ZeroPriceRestError extends Error {
  constructor(public readonly outcome: Outcome, public readonly code: string) {
    super(outcome === 'not-started' ? '전송 전 요청 검증에 실패했습니다.'
      : outcome === 'rejected' ? '서버가 원자 요청을 거절했습니다.'
        : '원격 처리 결과를 확인하지 못했습니다. 자동 재실행하지 마세요.');
    this.name = 'ZeroPriceRestError';
  }
}
const fail = (outcome: Outcome, code: string): never => { throw new ZeroPriceRestError(outcome, code); };
const database = 'projects/taebaek-3abe4/databases/(default)';
const url = `https://firestore.googleapis.com/v1/${database}/documents:commit`;
const defaultTransport: ZeroPriceRestTransport = async request => {
  const response = await fetch(request.url, { method: request.method, headers: request.headers, body: JSON.stringify(request.body), redirect: 'error' });
  return { status: response.status, body: await response.json() };
};
function version(value: Version): Timestamp {
  if (!value || !Number.isSafeInteger(value.seconds) || !Number.isInteger(value.nanoseconds)
    || value.nanoseconds < 0 || value.nanoseconds > 999999999) return fail('not-started', 'INVALID_ADAPTER_INPUT');
  try { return new Timestamp(value.seconds, value.nanoseconds); } catch { return fail('not-started', 'INVALID_ADAPTER_INPUT'); }
}
const timestampText = (value: Timestamp) => `${new Date(value.seconds * 1000).toISOString().slice(0, 19)}.${String(value.nanoseconds).padStart(9, '0')}Z`;
function resultTime(value: unknown): Timestamp {
  if (typeof value !== 'string') return fail('unknown', 'INVALID_WRITE_RESULTS');
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!match) return fail('unknown', 'INVALID_WRITE_RESULTS');
  const millis = Date.parse(`${match[1]}Z`);
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 19) !== match[1]) return fail('unknown', 'INVALID_WRITE_RESULTS');
  try { return new Timestamp(millis / 1000, Number((match[2] ?? '').padEnd(9, '0'))); }
  catch { return fail('unknown', 'INVALID_WRITE_RESULTS'); }
}
const rejectionStatuses: Record<string, number> = {
  INVALID_ARGUMENT: 400, FAILED_PRECONDITION: 400, OUT_OF_RANGE: 400,
  UNAUTHENTICATED: 401, PERMISSION_DENIED: 403, NOT_FOUND: 404, ALREADY_EXISTS: 409, ABORTED: 409,
};

/** 원래 migration의 검증·계산은 그대로 두고 단일 price CAS 쓰기만 REST로 운반한다. */
export function createZeroItemPriceRestDb(options: {
  plan: Plan; mode: 'apply' | 'undo'; receipt?: Applied; token: string; transport?: ZeroPriceRestTransport;
}): Firestore {
  let plan: Plan, receipt: Applied | undefined;
  try {
    plan = decode(encode(options.plan));
    receipt = options.receipt === undefined ? undefined : decode(encode(options.receipt));
    checkPlan(plan);
    if (!['apply', 'undo'].includes(options.mode) || typeof options.token !== 'string' || !options.token.trim()
      || /[\r\n]/.test(options.token) || options.transport !== undefined && typeof options.transport !== 'function') throw Error();
    for (const row of plan.documents) {
      if (!row.id || row.id.includes('/') || ['.', '..'].includes(row.id) || Buffer.byteLength(row.id) > 1500) throw Error();
      version(row.version);
    }
    if (options.mode === 'undo' && (!receipt || receipt.version !== 1 || typeof receipt.planHash !== 'string'
      || receipt.documents.length !== plan.documents.length || new Set(receipt.documents.map(row => row.id)).size !== plan.documents.length
      || plan.documents.some(row => !receipt!.documents.some(saved => saved.id === row.id)))) throw Error();
    if (options.mode === 'undo') receipt!.documents.forEach(row => version(row.version));
  } catch { return fail('not-started', 'INVALID_ADAPTER_INPUT'); }
  const mode = options.mode, token = options.token, transport = options.transport ?? defaultTransport;
  let used = false, batchCreated = false;
  const references = new WeakMap<object, string>();
  const expected = plan.documents.map(row => version(mode === 'apply' ? row.version : receipt!.documents.find(saved => saved.id === row.id)!.version));
  const adapter = {
    collection(name: string) {
      if (name !== 'items') return fail('not-started', 'INVALID_ADAPTER_WRITE');
      return { doc(id: string) {
        if (!plan.documents.some(row => row.id === id)) return fail('not-started', 'INVALID_ADAPTER_WRITE');
        const ref = Object.freeze({}); references.set(ref, id); return ref;
      } };
    },
    batch() {
      if (batchCreated || used) return fail('not-started', 'ADAPTER_ALREADY_USED');
      batchCreated = true;
      const writes: unknown[] = [];
      let poisoned = false;
      const batch = {
        update(ref: object, data: Record<string, unknown>, condition: { lastUpdateTime: Timestamp }) {
          try {
            const index = writes.length, row = plan.documents[index];
            if (used || !row || references.get(ref) !== row.id || !data || Object.keys(data).length !== 1
              || !Object.hasOwn(data, 'price') || !condition || Object.keys(condition).length !== 1
              || !(condition.lastUpdateTime instanceof Timestamp) || !condition.lastUpdateTime.isEqual(expected[index])
              || (mode === 'apply' ? !(data.price instanceof FieldValue) || !data.price.isEqual(FieldValue.delete()) : !Object.is(data.price, 0))) throw Error();
            writes.push({ update: { name: `${database}/documents/items/${row.id}`, fields: mode === 'apply' ? {} : { price: { integerValue: '0' } } },
              updateMask: { fieldPaths: ['price'] }, currentDocument: { updateTime: timestampText(expected[index]) } });
            return batch;
          } catch { poisoned = true; return fail('not-started', 'INVALID_ADAPTER_WRITE'); }
        },
        async commit() {
          if (used) return fail('not-started', 'ADAPTER_ALREADY_USED');
          used = true;
          if (poisoned || writes.length !== plan.documents.length || !writes.length) return fail('not-started', 'INCOMPLETE_ADAPTER_BATCH');
          let response: Awaited<ReturnType<ZeroPriceRestTransport>>;
          try { response = await transport({ url, method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: { writes } }); }
          catch { return fail('unknown', 'TRANSPORT_ERROR'); }
          if (!response || !Number.isInteger(response.status)) return fail('unknown', 'UNKNOWN_RESPONSE');
          const body = response.body as any;
          if (response.status !== 200) {
            const status = body?.error?.status;
            if (typeof status === 'string' && Object.hasOwn(rejectionStatuses, status)
              && rejectionStatuses[status] === response.status && body.error.code === response.status) return fail('rejected', status);
            return fail('unknown', 'UNKNOWN_RESPONSE');
          }
          if (!body || body.error || !Array.isArray(body.writeResults) || body.writeResults.length !== writes.length) return fail('unknown', 'INVALID_WRITE_RESULTS');
          return body.writeResults.map((result: any, index: number) => {
            if (!result || result.transformResults !== undefined && (!Array.isArray(result.transformResults) || result.transformResults.length)) return fail('unknown', 'INVALID_WRITE_RESULTS');
            const writeTime = resultTime(result.updateTime);
            if (writeTime.seconds < expected[index].seconds || writeTime.seconds === expected[index].seconds && writeTime.nanoseconds <= expected[index].nanoseconds) return fail('unknown', 'INVALID_WRITE_RESULTS');
            return { writeTime };
          });
        },
      };
      return batch;
    },
  };
  return adapter as unknown as Firestore;
}
