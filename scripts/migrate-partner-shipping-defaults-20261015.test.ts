import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { prepare, orderDate, hash, writes, options, run, readAll, checkPlan, selfCheck, type RestDocument, type Receipt } from './migrate-partner-shipping-defaults-20261015.mts';

const root = 'projects/taebaek-3abe4/databases/(default)/documents/';
const beforeTime = '2026-10-15T01:00:00.000000001Z', afterTime = '2026-10-15T01:00:00.000000002Z';
const value = (input: any): any => input === null ? { nullValue: null } : typeof input === 'string' ? { stringValue: input } : typeof input === 'boolean' ? { booleanValue: input } : typeof input === 'number' ? { integerValue: String(input) } : Array.isArray(input) ? { arrayValue: { values: input.map(value) } } : { mapValue: { fields: Object.fromEntries(Object.entries(input).map(([key, row]) => [key, value(row)])) } };
function doc(collection: string, id: string, data: any): RestDocument { return { name: root + collection + '/' + id, updateTime: beforeTime, fields: Object.fromEntries(Object.entries(data).map(([key, row]) => [key, value(row)])) }; }
const partner = (data: any = {}, id = 'p') => doc('partners', id, { companyId: 'taebaek', partnerType: '매출처', name: '합성', ...data });
const order = (data: any = {}, id = 'o') => doc('orders', id, { companyId: 'taebaek', partnerId: 'p', status: 'DELIVERED', createdAt: '2026-10-14', shipMethod: '배송', ...data });
const plan = (partners = [partner()], orders = [order()]) => prepare({ partners, orders });
const receipt = (p: ReturnType<typeof plan>): Receipt => ({ version: 1, planHash: hash(p), mode: 'apply', operationId: 'operation-1', documents: p.changes.map(row => ({ name: row.name, updateTime: afterTime })) });

describe('마지막 주문 배송방식 이관 판정', () => {
  it('주문일 최신 날짜를 사용하며 직접수령만 정규화한다', () => {
    const p = plan(undefined, [order({ createdAt: '2026-10-13', shipMethod: '택배' }, 'old'), order({ shipMethod: '직접수령' })]);
    expect(p.changes[0].after.fields.defaultShipMethod).toEqual(value('수령'));
    expect(p.changes[0].scopes[0].latestDate).toBe('2026-10-14'); expect(p.atomicSnapshot).toBe(false);
  });
  it('배송지가 없는 이력과 정확한 배송지 이력을 독립적으로 이관한다', () => {
    const p = plan([partner({ shipTos: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'off', name: '보관', archived: true }] })], [order(), order({ shipToId: 'a', shipMethod: '화물' }, 'a'), order({ shipToId: 'b', shipMethod: '택배' }, 'b'), order({ shipToId: 'off' }, 'off'), order({ shipToId: 'unknown' }, 'unknown')]);
    expect(p.summary).toMatchObject({ partnerDefaults: 1, shipToDefaults: 2, unmatchedShipToOrders: 2 });
    expect(p.changes[0].after.fields.shipTos.arrayValue.values[0].mapValue.fields.defaultShipMethod).toEqual(value('화물'));
    expect(p.changes[0].after.fields.shipTos.arrayValue.values[2].mapValue.fields.defaultShipMethod).toBeUndefined();
  });
  it.each(['', null, 'invalid', '배송'])('기존 defaultShipMethod=%s 필드는 자동 덮어쓰지 않는다', existing => {
    expect(plan([partner({ defaultShipMethod: existing })]).changes).toHaveLength(0);
  });
  it('배송지 기본값이 존재하면 부모 설정과 별개로 그대로 둔다', () => {
    const p = plan([partner({ shipTos: [{ id: 'a', name: 'A', defaultShipMethod: '' }] })], [order({ shipToId: 'a' })]);
    expect(p.changes).toHaveLength(0); expect(p.summary.existingField).toBe(1);
  });
  it('최신 주문 방식이 비어 있으면 오래된 방식 또는 채널로 채우지 않는다', () => {
    const p = plan(undefined, [order({ createdAt: '2026-10-13', shipMethod: '화물' }, 'old'), order({ shipMethod: '', source: '택배' })]);
    expect(p.changes).toHaveLength(0); expect(p.summary.latestMissingMethod).toBe(1);
  });
  it('최신 같은 날 방식이 충돌하면 시각 순서로 임의 선택하지 않는다', () => {
    const p = plan(undefined, [order({ createdAt: '2026-10-14T01:00:00Z', shipMethod: '화물' }, 'one'), order({ createdAt: '2026-10-14T10:00:00Z', shipMethod: '택배' }, 'two')]);
    expect(p.summary.latestConflict).toBe(1); expect(p.changes).toHaveLength(0);
  });
  it('최신 같은 날 방식이 같으면 한 설정으로 이관한다', () => { expect(plan(undefined, [order({}, 'one'), order({}, 'two')]).changes).toHaveLength(1); });
  it('연결된 이력 중 날짜가 이상하면 그 범위만 보류한다', () => { expect(plan(undefined, [order({ createdAt: '2026-02-30' }), order({}, 'valid')]).summary.invalidDate).toBe(1); });
  it('회사와 문서 ID를 정확히 대조하며 이름이나 저장된 id로 연결하지 않는다', () => {
    const p = plan([partner({ id: 'wrong' }), partner({ companyId: 'punghoe' }, 'q')], [order({ companyId: 'punghoe' }), order({ partnerId: 'wrong' }, 'wrong')]);
    expect(p.changes).toHaveLength(0);
  });
  it('옛 companyId 누락은 공용 companyOf의 태백 호환을 따른다', () => {
    const p = partner(), o = order(); delete p.fields.companyId; delete o.fields.companyId;
    expect(plan([p], [o]).changes).toHaveLength(1);
  });
  it.each([{ status: 'CANCELLED' }, { cancelled: true }, { deletedAt: '2026-10-15' }, { purpose: 'stock-production' }])('취소·삭제·재고생산 이력 제외 %j', change => { expect(plan(undefined, [order(change)]).changes).toHaveLength(0); });
  it.each(['매입처', '금융기관'])('배송 대상이 아닌 %s 제외', partnerType => { expect(plan([partner({ partnerType })]).changes).toHaveLength(0); });
  it('보관 거래처 제외와 양방향 거래처 포함', () => { expect(plan([partner({ archived: true })]).changes).toHaveLength(0); expect(plan([partner({ partnerType: '매출+매입처' })]).changes).toHaveLength(1); });
  it('배송지 ID 중복이면 배송지 이관은 보류하고 부모 이력은 유지한다', () => {
    const p = plan([partner({ shipTos: [{ id: 'a' }, { id: 'a' }] })], [order(), order({ shipToId: 'a' }, 'a')]);
    expect(p.summary.invalidShipTos).toBe(1); expect(p.summary.shipToDefaults).toBe(0); expect(p.summary.partnerDefaults).toBe(1);
  });
  it('typed 원문과 관계·금액을 보존하고 허용 필드만 바꾼다', () => {
    const p = partner({ amount: 7, shipTos: [{ id: 'a', name: 'A', custom: { a: true } }] }); p.fields.bytes = { bytesValue: 'YQ==' };
    const source = structuredClone(p), result = plan([p]); expect(p).toEqual(source);
    const after = structuredClone(result.changes[0].after); delete after.fields.defaultShipMethod;
    expect(after).toEqual(source); expect(result.changes[0].mask).toEqual(['defaultShipMethod']);
  });
  it('계획 변조를 원문 재계산으로 거절한다', () => { const p = plan(); p.changes[0].after.fields.defaultShipMethod = value('화물'); expect(() => checkPlan(p)).toThrow(); });
  it.each([-0, NaN, Infinity])('JSON 백업에서 손실되는 typed doubleValue %s는 계획 전에 거절한다', number => { const p = partner(); p.fields.nonBusiness = { doubleValue: number }; expect(() => plan([p])).toThrow('손실'); });
  it('KST 날짜 경계와 불가능한 날짜·시각을 구분한다', () => {
    expect(orderDate('2026-10-14T16:00:00Z')).toBe('2026-10-15'); expect(orderDate('2026-10-14')).toBe('2026-10-14');
    for (const date of ['2026-02-30', '2026-10-14T24:00:00Z', '2026-10-14T12:00:00', '', null]) expect(orderDate(date)).toBeUndefined();
  });
});

describe.skipIf(process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8082')('자기 UUID 문서만 사용하는 실제 REST 원자성·복원', () => {
  it('atomic2 CAS충돌 효과0 → 실제 ns 적용·undo → 후속변경 undo거절', async () => {
    const prefix = 'shipping-migration-' + randomUUID(), ids = [prefix + '-a', prefix + '-b'], names = ids.map(id => root + 'partners/' + id);
    const base = 'http://127.0.0.1:8082/v1/', headers = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, commitUrl = base + 'projects/taebaek-3abe4/databases/(default)/documents:commit';
    const commit = async (rows: any[]) => { const response = await fetch(commitUrl, { method: 'POST', headers, body: JSON.stringify({ writes: rows }) }); return { status: response.status, body: await response.json() }; };
    const get = async (name: string): Promise<RestDocument> => { const response = await fetch(base + name.split('/').map(encodeURIComponent).join('/'), { headers }); expect(response.status).toBe(200); return response.json(); };
    const current = () => Promise.all(names.map(get));
    try {
      expect((await commit(ids.map(id => ({ update: { name: root + 'partners/' + id, fields: partner().fields }, currentDocument: { exists: false } })))).status).toBe(200);
      const initial = await current(), make = (docs: RestDocument[]) => prepare({ partners: docs, orders: ids.map((partnerId, i) => order({ partnerId, shipMethod: i ? '화물' : '배송' }, prefix + '-o' + i)) });
      const stalePlan = make(initial), staleWrites = writes(stalePlan, 'apply', initial);
      expect((await commit([{ update: { name: names[1], fields: { note: value('동시변경') } }, updateMask: { fieldPaths: ['note'] }, currentDocument: { updateTime: initial[1].updateTime } }])).status).toBe(200);
      expect((await commit(staleWrites)).status).not.toBe(200); expect((await get(names[0])).fields.defaultShipMethod).toBeUndefined();
      const before = await current(), p = make(before), appliedResponse = await commit(writes(p, 'apply', before)); expect(appliedResponse.status).toBe(200);
      const actualReceipt: Receipt = { version: 1, mode: 'apply', operationId: prefix, planHash: hash(p), documents: appliedResponse.body.writeResults.map((row: any, i: number) => ({ name: p.changes[i].name, updateTime: row.updateTime })) };
      const applied = await current(); expect(applied.map(row => row.fields.defaultShipMethod)).toEqual([value('배송'), value('화물')]);
      expect((await commit(writes(p, 'undo', applied, actualReceipt))).status).toBe(200); expect((await current()).map(row => row.fields)).toEqual(before.map(row => row.fields));
      const p2 = make(await current()), r2 = await commit(writes(p2, 'apply', p2.changes.map(row => row.before))); expect(r2.status).toBe(200);
      const receipt2: Receipt = { version: 1, mode: 'apply', operationId: prefix, planHash: hash(p2), documents: r2.body.writeResults.map((row: any, i: number) => ({ name: p2.changes[i].name, updateTime: row.updateTime })) }, after2 = await current(), staleUndo = writes(p2, 'undo', after2, receipt2);
      expect((await commit([{ update: { name: names[1], fields: { note: value('복원전변경') } }, updateMask: { fieldPaths: ['note'] }, currentDocument: { updateTime: after2[1].updateTime } }])).status).toBe(200);
      expect((await commit(staleUndo)).status).not.toBe(200); expect((await get(names[0])).fields.defaultShipMethod).toEqual(value('배송'));
      expect(() => writes(p2, 'undo', [after2[0], { ...after2[1], fields: { ...after2[1].fields, note: value('복원전변경') } }], receipt2)).toThrow();
    } finally {
      expect((await commit(names.map(name => ({ delete: name })))).status).toBe(200);
      for (const name of names) expect((await fetch(base + name.split('/').map(encodeURIComponent).join('/'), { headers })).status).toBe(404);
    }
  }, 20000);
});

describe('원문·나노초 CAS와 실제 영수증 기반 복구', () => {
  it('적용은 한 필드와 계획 당시 버전만 쓰고 복원은 그 필드를 지운다', () => {
    const p = plan(); expect(writes(p, 'apply', [p.changes[0].before])[0]).toMatchObject({ update: { fields: { defaultShipMethod: value('배송') } }, updateMask: { fieldPaths: ['defaultShipMethod'] }, currentDocument: { updateTime: beforeTime } });
    const current = { ...p.changes[0].after, updateTime: afterTime };
    expect(writes(p, 'undo', [current], receipt(p))[0]).toMatchObject({ update: { fields: {} }, updateMask: { fieldPaths: ['defaultShipMethod'] }, currentDocument: { updateTime: afterTime } });
  });
  it('배송지 복원은 전체 원래 배열을 정확히 되돌린다', () => {
    const p = plan([partner({ shipTos: [{ id: 'a', name: 'A' }] })], [order({ shipToId: 'a' })]);
    expect(writes(p, 'undo', [{ ...p.changes[0].after, updateTime: afterTime }], receipt(p))[0].update.fields.shipTos).toEqual(p.changes[0].before.fields.shipTos);
  });
  it('전체 원문·나노초 버전 중 하나라도 바뀌면 적용·복원 모두 거절한다', () => {
    const p = plan(); expect(() => writes(p, 'apply', [{ ...p.changes[0].before, updateTime: afterTime }])).toThrow();
    const changed = structuredClone(p.changes[0].before); changed.fields.other = value('변경'); expect(() => writes(p, 'apply', [changed])).toThrow();
    const after = { ...p.changes[0].after, updateTime: afterTime, fields: { ...p.changes[0].after.fields, other: value('변경') } };
    expect(() => writes(p, 'undo', [after], receipt(p))).toThrow(); expect(() => writes(p, 'undo', [{ ...p.changes[0].after, updateTime: afterTime }])).toThrow();
  });
  it('오염된 복원 영수증을 거절한다', () => { const p = plan(), r = receipt(p); r.documents[0].updateTime = beforeTime; expect(() => writes(p, 'undo', [p.changes[0].after], r)).toThrow(); });
});

describe('명시 경로·CLI 인증·전수읽기·재실행 방지', () => {
  const path = resolve('work/synthetic-shipping-test.json'), summary = resolve('work/synthetic-shipping-summary.json');
  const args = ['--auth=firebase-cli', `--plan=${path}`, `--summary=${summary}`];
  function memory() { const rows = new Map<string, string>(); return { rows, io: { exists: (p: string) => rows.has(p), read: (p: string) => { if (!rows.has(p)) throw Error('missing'); return rows.get(p)!; }, write: (p: string, text: string) => { if (rows.has(p)) throw Error('exists'); rows.set(p, text); }, remove: (p: string) => { rows.delete(p); } } }; }
  const ok = (body: any) => ({ status: 200, json: async () => body });
  it('dry가 기본이며 승인·출력 경로 누락과 중복 옵션을 거절한다', () => {
    expect(options(args).mode).toBe('dry'); for (const bad of [[], ['--auth=adc', ...args.slice(1)], [...args, '--apply'], [...args, '--dry', '--undo'], [...args, `--plan=${path}`], ['--auth=firebase-cli', '--plan=public/x.json', `--summary=${summary}`]]) expect(() => options(bad)).toThrow();
  });
  it('전 페이지를 읽고 중복 토큰 또는 실패 페이지를 성공으로 표시하지 않는다', async () => {
    const request = vi.fn().mockResolvedValueOnce(ok({ documents: [partner()], nextPageToken: 'next' })).mockResolvedValueOnce(ok({ documents: [partner({}, 'q')] })).mockResolvedValueOnce(ok({ documents: [order()] }));
    expect((await readAll('synthetic-token', request)).partners).toHaveLength(2); expect(request.mock.calls[1][0]).toContain('pageToken=next');
    await expect(readAll('synthetic-token', vi.fn().mockResolvedValue(ok({ nextPageToken: 'same' })))).rejects.toThrow();
    await expect(readAll('synthetic-token', vi.fn().mockResolvedValue({ status: 403, json: async () => ({ secret: 'never-print' }) }))).rejects.toThrow();
  });
  it('dry는 private 전체 원문과 집계만 따로 남기며 재실행은 조회 전 거절한다', async () => {
    const m = memory(), request = vi.fn().mockResolvedValueOnce(ok({ documents: [partner()] })).mockResolvedValueOnce(ok({ documents: [order()] })), token = vi.fn(async () => 'synthetic-token');
    const result = await run(args, { io: m.io, token, request }); expect(result.writes).toBe(0); expect(request.mock.calls.every(call => call[1].method === 'GET')).toBe(true);
    expect(m.rows.get(path)).toContain('fields'); expect(m.rows.get(summary)).not.toContain('합성'); expect(m.rows.get(summary)).not.toContain(root);
    await expect(run(args, { io: m.io, token, request })).rejects.toThrow(); expect(token).toHaveBeenCalledTimes(1);
  });
  it('전송 후 응답을 잃으면 intent·잠금·unknown을 남겨 자동 재전송을 막는다', async () => {
    const p = plan(), m = memory(); m.rows.set(path, JSON.stringify({ version: 1, planHash: hash(p), plan: p }));
    const request = vi.fn().mockResolvedValueOnce(ok({ documents: p.snapshot.partners })).mockResolvedValueOnce(ok({ documents: p.snapshot.orders })).mockResolvedValueOnce(ok(p.changes[0].before)).mockRejectedValueOnce(Error('connection lost'));
    const apply = ['--apply', '--auth=firebase-cli', `--plan=${path}`, `--approved-hash=${hash(p)}`];
    await expect(run(apply, { io: m.io, token: async () => 'synthetic-token', request })).rejects.toThrow();
    expect(m.rows.has(path + '.apply.intent.json')).toBe(true); expect(m.rows.has(path + '.lock')).toBe(true); expect(m.rows.get(path + '.apply.failure.json')).toContain('unknown');
    await expect(run(apply, { io: m.io, token: async () => 'synthetic-token', request })).rejects.toThrow(); expect(request).toHaveBeenCalledTimes(4);
  });
  it('계획 뒤 새 주문이 생기면 쓰기 전 거절하고 자기 잠금만 해제한다', async () => {
    const p = plan(), m = memory(); m.rows.set(path, JSON.stringify({ version: 1, planHash: hash(p), plan: p }));
    const request = vi.fn().mockResolvedValueOnce(ok({ documents: p.snapshot.partners })).mockResolvedValueOnce(ok({ documents: [...p.snapshot.orders, order({}, 'new')] }));
    await expect(run(['--apply', '--auth=firebase-cli', `--plan=${path}`, `--approved-hash=${hash(p)}`], { io: m.io, token: async () => 'synthetic-token', request })).rejects.toThrow();
    expect(m.rows.has(path + '.lock')).toBe(false); expect(m.rows.has(path + '.apply.intent.json')).toBe(false);
  });
  it('적용·복원의 실제 응답 버전을 보존하고 각각 사후 원문을 확인한다', async () => {
    const p = plan(), m = memory(); m.rows.set(path, JSON.stringify({ version: 1, planHash: hash(p), plan: p }));
    const applied = { ...p.changes[0].after, updateTime: afterTime }, undoneTime = '2026-10-15T01:00:00.000000003Z', undone = { ...p.changes[0].before, updateTime: undoneTime };
    const request = vi.fn().mockResolvedValueOnce(ok({ documents: p.snapshot.partners })).mockResolvedValueOnce(ok({ documents: p.snapshot.orders })).mockResolvedValueOnce(ok(p.changes[0].before)).mockResolvedValueOnce(ok({ writeResults: [{ updateTime: afterTime }] })).mockResolvedValueOnce(ok(applied));
    const dep = { io: m.io, token: async () => 'synthetic-token', request }, base = ['--auth=firebase-cli', `--plan=${path}`, `--approved-hash=${hash(p)}`];
    expect(await run(['--apply', ...base], dep)).toMatchObject({ writes: 1 }); expect(m.rows.has(path + '.lock')).toBe(false);
    const actual = JSON.parse(m.rows.get(path + '.apply.receipt.json')!); expect(actual.documents[0].updateTime).toBe(afterTime);
    const sent = JSON.parse(request.mock.calls[3][1].body); expect(sent.writes).toHaveLength(1); expect(sent.writes[0].currentDocument.updateTime).toBe(beforeTime);
    request.mockResolvedValueOnce(ok(applied)).mockResolvedValueOnce(ok({ writeResults: [{ updateTime: undoneTime }] })).mockResolvedValueOnce(ok(undone));
    expect(await run(['--undo', ...base], dep)).toMatchObject({ writes: 1 }); expect(m.rows.has(path + '.undo.receipt.json')).toBe(true);
    await expect(run(['--apply', ...base], dep)).rejects.toThrow(); expect(request).toHaveBeenCalledTimes(8);
  });
  it('명확한 서버 거절과 응답 유실을 구분하며 모두 자동 재전송하지 않는다', async () => {
    const p = plan(), m = memory(); m.rows.set(path, JSON.stringify({ version: 1, planHash: hash(p), plan: p }));
    const request = vi.fn().mockResolvedValueOnce(ok({ documents: p.snapshot.partners })).mockResolvedValueOnce(ok({ documents: p.snapshot.orders })).mockResolvedValueOnce(ok(p.changes[0].before)).mockResolvedValueOnce({ status: 409, json: async () => ({ error: { code: 409, status: 'ABORTED', message: 'private-error' } }) });
    await expect(run(['--apply', '--auth=firebase-cli', `--plan=${path}`, `--approved-hash=${hash(p)}`], { io: m.io, token: async () => 'synthetic-token', request })).rejects.toThrow('거절');
    expect(m.rows.get(path + '.apply.failure.json')).toContain('rejected'); expect(m.rows.get(path + '.apply.failure.json')).not.toContain('private-error');
  });
  it('자체검증은 인증·조회·출력을 하지 않는다', () => { expect(selfCheck()).toEqual({ selfCheck: 'passed', productionReads: 0, productionWrites: 0, outputWritten: false }); });
});
