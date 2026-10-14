import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createZeroItemPriceRestDb, ZeroPriceRestError, type ZeroPriceRestTransport } from './zeroItemPriceRest';
import { prepareZeroItemPrice, commitZeroItemPrice, type Document } from './zeroItemPriceMigration';
const documents = (): Document[] => ['a', 'b'].map(id => ({ id, data: { companyId: 'taebaek', price: 0, cost: 42, qty: 7 }, version: { seconds: 1700000000, nanoseconds: 123456789 } }));
const success = () => ({ status: 200, body: { writeResults: [{ updateTime: '2026-10-15T00:00:00.123456789Z' }, { updateTime: '2026-10-15T00:00:00.123456790Z' }] } });
const fixture = (transport = vi.fn<ZeroPriceRestTransport>().mockResolvedValue(success()), mode: 'apply' | 'undo' = 'apply') => {
  const current = documents(), plan = prepareZeroItemPrice('taebaek', current);
  const receipt = { version: 1 as const, planHash: 'hash', documents: plan.documents.map(row => ({ id: row.id, version: { seconds: 1700000001, nanoseconds: 987654321 } })) };
  const db = createZeroItemPriceRestDb({ plan, mode, receipt: mode === 'undo' ? receipt : undefined, token: 'synthetic-token', transport });
  return { db, plan, current, receipt, transport };
};

it('원 commit 함수의 삭제만 고정 프로젝트 단일 REST commit으로 전송하고 실 ns 결과를 반환한다', async () => {
  const f = fixture();
  const result = await commitZeroItemPrice(f.db, f.plan, f.current, 'apply', 'hash');
  expect(f.transport).toHaveBeenCalledTimes(1);
  const request = f.transport.mock.calls[0][0];
  expect(request.url).toBe('https://firestore.googleapis.com/v1/projects/taebaek-3abe4/databases/(default)/documents:commit');
  expect(request.method).toBe('POST');
  expect(request.headers.Authorization).toBe('Bearer synthetic-token');
  expect(request.body.writes).toEqual(f.plan.documents.map(row => ({ update: { name: `projects/taebaek-3abe4/databases/(default)/documents/items/${row.id}`, fields: {} }, updateMask: { fieldPaths: ['price'] }, currentDocument: { updateTime: '2023-11-14T22:13:20.123456789Z' } })));
  expect(result.documents.map(row => row.version.nanoseconds)).toEqual([123456789, 123456790]);
  expect(() => f.db.batch()).toThrowError(expect.objectContaining({ code: 'ADAPTER_ALREADY_USED' }));
});

it('undo는 원 적용 영수증 ns 조건으로 price +0 한 필드만 복원한다', async () => {
  const f = fixture(undefined, 'undo');
  const current = f.plan.documents.map(row => ({ id: row.id, data: row.after, version: f.receipt.documents.find(saved => saved.id === row.id)!.version }));
  await commitZeroItemPrice(f.db, f.plan, current, 'undo', 'hash', f.receipt);
  expect(f.transport.mock.calls[0][0].body.writes).toEqual(f.plan.documents.map(row => ({ update: { name: `projects/taebaek-3abe4/databases/(default)/documents/items/${row.id}`, fields: { price: { integerValue: '0' } } }, updateMask: { fieldPaths: ['price'] }, currentDocument: { updateTime: '2023-11-14T22:13:21.987654321Z' } })));
});

it('factory 이후 원 plan 수정은 허용된 쓰기 집합을 변경하지 못한다', async () => {
  const f = fixture();
  f.plan.documents.reverse();
  expect(() => f.db.batch().update(f.db.collection('items').doc('b'), { price: FieldValue.delete() }, { lastUpdateTime: new Timestamp(1700000000, 123456789) })).toThrow(ZeroPriceRestError);
  expect(f.transport).not.toHaveBeenCalled();
});

it.each(['collection', 'id', 'order', 'field', 'value', 'version', 'extra-condition'])('등록 밖 %s 쓰기를 전송 전에 거절한다', kind => {
  const f = fixture();
  const run = () => {
    const batch = f.db.batch();
    const ref = f.db.collection(kind === 'collection' ? 'orders' : 'items').doc(kind === 'id' ? 'outside' : kind === 'order' ? 'b' : 'a');
    batch.update(ref, kind === 'field' ? { price: FieldValue.delete(), cost: 0 } : { price: kind === 'value' ? 0 : FieldValue.delete() },
      { lastUpdateTime: new Timestamp(1700000000, kind === 'version' ? 123456788 : 123456789), ...(kind === 'extra-condition' ? { exists: true } : {}) });
  };
  expect(run).toThrowError(expect.objectContaining({ outcome: 'not-started' }));
  expect(f.transport).not.toHaveBeenCalled();
});

it('불완전 batch와 거절 후 재사용은 전송하지 않는다', async () => {
  const f = fixture();
  const batch = f.db.batch();
  batch.update(f.db.collection('items').doc('a'), { price: FieldValue.delete() }, { lastUpdateTime: new Timestamp(1700000000, 123456789) });
  await expect(batch.commit()).rejects.toMatchObject({ outcome: 'not-started', code: 'INCOMPLETE_ADAPTER_BATCH' });
  await expect(batch.commit()).rejects.toMatchObject({ outcome: 'not-started', code: 'ADAPTER_ALREADY_USED' });
  expect(f.transport).not.toHaveBeenCalled();
});

it.each([[400, 'INVALID_ARGUMENT'], [400, 'FAILED_PRECONDITION'], [401, 'UNAUTHENTICATED'], [403, 'PERMISSION_DENIED'], [404, 'NOT_FOUND'], [409, 'ABORTED']])('구조화된 확정 거절 %s/%s만 rejected로 분류한다', async (status, code) => {
  const f = fixture(vi.fn<ZeroPriceRestTransport>().mockResolvedValue({ status: Number(status), body: { error: { code: Number(status), status: code, message: 'SECRET_TOKEN_AND_ROW' } } }));
  try { await commitZeroItemPrice(f.db, f.plan, f.current, 'apply', 'hash'); throw Error('실패해야 함'); }
  catch (error) { expect(error).toMatchObject({ outcome: 'rejected', code }); expect(String(error)).not.toContain('SECRET'); }
  expect(f.transport).toHaveBeenCalledTimes(1);
});

it.each([
  { status: 403, body: 'forbidden' }, { status: 400, body: { error: { status: 'FAILED_PRECONDITION', code: 409 } } },
  { status: 500, body: { error: { status: 'INTERNAL', code: 500 } } }, { status: 429, body: { error: { status: 'RESOURCE_EXHAUSTED', code: 429 } } },
  { status: 200, body: { writeResults: [] } }, { status: 200, body: { writeResults: [{ updateTime: '2026-02-30T00:00:00Z' }, { updateTime: '2026-10-15T00:00:00Z' }] } },
  { status: 200, body: { writeResults: [{ updateTime: '2026-10-15T00:00:00.1234567890Z' }, { updateTime: '2026-10-15T00:00:00Z' }] } },
  { status: 200, body: { writeResults: [{ updateTime: '2023-11-14T22:13:20.123456789Z' }, { updateTime: '2026-10-15T00:00:00Z' }] } },
])('모호한 응답은 unknown이며 재송신하지 않는다 %#', async response => {
  const f = fixture(vi.fn<ZeroPriceRestTransport>().mockResolvedValue(response));
  await expect(commitZeroItemPrice(f.db, f.plan, f.current, 'apply', 'hash')).rejects.toMatchObject({ outcome: 'unknown' });
  expect(f.transport).toHaveBeenCalledTimes(1);
});

it('응답 유실은 unknown이고 내부 재시도를 하지 않는다', async () => {
  const f = fixture(vi.fn<ZeroPriceRestTransport>().mockRejectedValue(Error('SECRET')));
  await expect(commitZeroItemPrice(f.db, f.plan, f.current, 'apply', 'hash')).rejects.toMatchObject({ outcome: 'unknown', code: 'TRANSPORT_ERROR' });
  expect(f.transport).toHaveBeenCalledTimes(1);
});

it('잘못된 plan/token/undo 영수증은 전송 전에 거절한다', () => {
  const plan = prepareZeroItemPrice('taebaek', documents());
  expect(() => createZeroItemPriceRestDb({ plan, mode: 'apply', token: '' })).toThrowError(expect.objectContaining({ outcome: 'not-started' }));
  expect(() => createZeroItemPriceRestDb({ plan, mode: 'undo', token: 'synthetic' })).toThrowError(expect.objectContaining({ outcome: 'not-started' }));
  plan.documents[0].after.cost = 0;
  expect(() => createZeroItemPriceRestDb({ plan, mode: 'apply', token: 'synthetic' })).toThrowError(expect.objectContaining({ outcome: 'not-started' }));
});

describe.skipIf(process.env.ZERO_PRICE_REST_EMULATOR !== '1')('실제 로컬 REST 원자 commit', () => {
  const base = 'http://127.0.0.1:8294/v1/projects/demo-zero-price-rest-20261015/databases/(default)/documents';
  const transport: ZeroPriceRestTransport = async request => {
    expect(request.url).toBe('https://firestore.googleapis.com/v1/projects/taebaek-3abe4/databases/(default)/documents:commit');
    const text = JSON.stringify(request.body).replaceAll('projects/taebaek-3abe4/', 'projects/demo-zero-price-rest-20261015/');
    const response = await fetch(`${base}:commit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: text });
    return { status: response.status, body: await response.json() };
  };
  it.each(['apply-undo', 'stale-atomic'])('%s는 자기 합성 문서만 변경하고 정리한다', async kind => {
    const ids = ['a', 'b'].map(letter => `zero-rest-${randomUUID()}-${letter}`);
    const current = async (): Promise<Document[]> => Promise.all(ids.map(async id => {
      const response = await fetch(`${base}/items/${id}`, { headers: { Authorization: 'Bearer owner' } }); const row = await response.json() as any;
      if (!response.ok) throw Error('local fixture read failed');
      const time = /^(.*?)(?:\.(\d+))?Z$/.exec(row.updateTime)!;
      const data = Object.fromEntries(Object.entries(row.fields).map(([key, value]: [string, any]) => [key, value.stringValue ?? Number(value.integerValue)]));
      return { id, data, version: { seconds: Date.parse(`${time[1]}Z`) / 1000, nanoseconds: Number((time[2] ?? '').padEnd(9, '0')) } };
    }));
    try {
      for (const id of ids) {
        const response = await fetch(`${base}/items/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ fields: { companyId: { stringValue: 'taebaek' }, price: { integerValue: '0' }, cost: { integerValue: '42' }, qty: { integerValue: '7' } } }) });
        expect(response.ok).toBe(true);
      }
      const before = await current(), plan = prepareZeroItemPrice('taebaek', before);
      if (kind === 'stale-atomic') {
        await fetch(`${base}/items/${ids[1]}?updateMask.fieldPaths=qty`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ fields: { qty: { integerValue: '8' } } }) });
        const observed = await current();
        const db = createZeroItemPriceRestDb({ plan, mode: 'apply', token: 'local-only', transport });
        await expect(commitZeroItemPrice(db, plan, before, 'apply', 'hash')).rejects.toMatchObject({ outcome: 'rejected', code: 'FAILED_PRECONDITION' });
        expect(await current()).toEqual(observed);
      } else {
        const receipt = await commitZeroItemPrice(createZeroItemPriceRestDb({ plan, mode: 'apply', token: 'local-only', transport }), plan, before, 'apply', 'hash');
        const after = await current();
        expect(after.every(row => !Object.hasOwn(row.data, 'price') && row.data.cost === 42 && row.data.qty === 7)).toBe(true);
        const undone = await commitZeroItemPrice(createZeroItemPriceRestDb({ plan, mode: 'undo', receipt, token: 'local-only', transport }), plan, after, 'undo', 'hash', receipt);
        expect(undone.documents).toHaveLength(2);
        expect((await current()).map(row => row.data)).toEqual(before.map(row => row.data));
      }
    } finally { for (const id of ids) await fetch(`${base}/items/${id}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } }); }
  });
});
