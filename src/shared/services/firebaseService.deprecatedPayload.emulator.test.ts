import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, Timestamp, GeoPoint, Bytes, arrayUnion, vector } from 'firebase/firestore';
const gateway = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('../firebase', () => ({ get db() { return gateway.db; }, authReady: Promise.resolve(), functions: undefined,
  auth: { currentUser: { uid: 'payload-writer', getIdTokenResult: async () => ({ claims: { companyId: 'taebaek', employeeId: 'payload-writer', isAdmin: true } }) } } }));
import { addItem, updateItem, setDocument, commitCompanyWrites } from './firebaseService';

// Rules 인증 컨텍스트를 사용하는 실제 Firestore SDK 시험이며 Auth 서버 로그인 시험은 아니다.
describe.skipIf(process.env.DEPRECATED_PAYLOAD_EMULATOR_TEST !== 'true')('폐기 필드의 실제 SDK 저장 경계', () => {
  let env: RulesTestEnvironment;
  const paths = new Set<string>();
  const projectId = 'demo-payload-' + randomUUID().slice(0, 18);
  beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8082') throw Error('승인한 로컬 연결 주소가 아닙니다.');
    env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8082, rules: readFileSync('firestore.rules', 'utf8') } });
    gateway.db = env.authenticatedContext('payload-writer', { companyId: 'taebaek', employeeId: 'payload-writer', isAdmin: true }).firestore();
  }, 30_000);
  afterAll(async () => {
    if (!env) return;
    try { await env.withSecurityRulesDisabled(async ctx => { for (const path of paths) await deleteDoc(doc(ctx.firestore(), path)); }); }
    finally { await env.cleanup(); }
  }, 30_000);
  async function seed(path: string, data: Record<string, unknown>) {
    paths.add(path);
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), path), { companyId: 'taebaek', ...data }));
  }
  async function read(path: string) { return (await getDoc(doc(gateway.db, path))).data()!; }
  const writers = [
    ['add', (collection: any, id: string, data: any) => addItem(collection, { id, ...data })],
    ['update', (collection: any, id: string, data: any) => updateItem(collection, id, data)],
    ['merge', (collection: any, id: string, data: any) => setDocument(collection, id, data)],
    ['batch', (collection: any, id: string, data: any) => commitCompanyWrites([{ kind: 'set', collection, id, data, merge: true }])],
  ] as const;
  it.each(writers)('%s 신규 재유입을 막고 다른 값을 보존한다', async (name, write) => {
    for (const collection of ['items', 'pallets'] as const) {
      const id = name + '-' + collection, path = collection + '/' + id;
      paths.add(path);
      if (name === 'update') await seed(path, { name: '합성' });
      const timestamp = new Timestamp(123, 456789123);
      const reference = doc(gateway.db, 'partners', 'reference-only');
      const point = new GeoPoint(37, 127), bytes = Bytes.fromBase64String('AQID');
      const date = new Date('2026-01-01T00:00:00.123Z'), embedding = vector([1, 2, 3]);
      const data = Object.freeze({ name: '합성', lotsAreTotal: true, 'lotsAreTotal.old': 1, inUse: 5, 'inUse.old': 6,
        nested: { lotsAreTotal: true, inUse: 7, absent: undefined, timestamp }, lotsAreTotals: 8, inUser: 9,
        timestamp, reference, point, bytes, date, embedding, tags: arrayUnion('합성'), values: [timestamp, point] });
      await write(collection, id, data);
      const saved = await read(path), field = collection === 'items' ? 'lotsAreTotal' : 'inUse';
      expect(saved).not.toHaveProperty(field); expect(Object.keys(saved)).not.toContain(field + '.old');
      expect(saved).toMatchObject({ nested: { lotsAreTotal: true, inUse: 7 }, lotsAreTotals: 8, inUser: 9, companyId: 'taebaek' });
      expect(saved.nested).not.toHaveProperty('absent'); expect(data.nested).toHaveProperty('absent');
      // Firestore 저장 정밀도는 마이크로초다. 전처리는 원본 나노초를 유지하고 서버 저장만 절삭한다.
      const storedTimestamp = new Timestamp(timestamp.seconds, 456789000);
      expect(data.timestamp.nanoseconds).toBe(456789123);
      expect(saved.timestamp.isEqual(storedTimestamp)).toBe(true); expect(saved.nested.timestamp.isEqual(storedTimestamp)).toBe(true);
      expect(saved.reference.path).toBe(reference.path); expect(saved.reference.firestore.app.options.projectId).toBe(projectId);
      expect(saved.point.isEqual(point)).toBe(true); expect(saved.bytes.isEqual(bytes)).toBe(true);
      expect(saved.date.toMillis()).toBe(date.getTime()); expect(saved.embedding.isEqual(embedding)).toBe(true);
      expect(saved.tags).toEqual(['합성']); expect(saved.values[0].isEqual(storedTimestamp)).toBe(true); expect(saved.values[1].isEqual(point)).toBe(true);
      expect(data.lotsAreTotal).toBe(true); expect(data.inUse).toBe(5);
      if (collection === 'items') { if (name === 'update') expect(saved.inUse).toEqual({ old: 6 }); else expect(saved.inUse).toBe(5); } else { if (name === 'update') expect(saved.lotsAreTotal).toEqual({ old: 1 }); else expect(saved.lotsAreTotal).toBe(true); }
    }
  }, 30_000);
  it.each(writers.filter(([name]) => name !== 'add'))('%s 기존 폐기 값을 자동 삭제하지 않는다', async (name, write) => {
    for (const collection of ['items', 'pallets'] as const) {
      const id = 'legacy-' + name + '-' + collection, path = collection + '/' + id;
      await seed(path, { name: 'before', lotsAreTotal: 'original', inUse: 12, stock: 0, lots: [] });
      await write(collection, id, { name: 'after', lotsAreTotal: 'replacement', 'lotsAreTotal.old': 1, inUse: 99, 'inUse.old': 2 });
      const saved = await read(path);
      expect(saved.name).toBe('after');
      if (collection === 'items') expect(saved.lotsAreTotal).toBe('original'); else expect(saved.inUse).toBe(12);
      expect(saved.stock).toBe(0); expect(saved.lots).toEqual([]);
    }
  });
  it('다른 컬렉션의 동명 필드를 보존한다', async () => {
    const path = 'partners/control'; paths.add(path);
    await addItem('partners', { id: 'control', name: '합성', lotsAreTotal: true, inUse: 3 });
    expect(await read(path)).toMatchObject({ lotsAreTotal: true, inUse: 3 });
  });
});
