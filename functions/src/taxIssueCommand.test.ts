import { describe, it, expect, vi } from 'vitest';
vi.mock('firebase-functions/v2/https', () => ({ HttpsError: class extends Error { constructor(public code: string, message: string, public details?: unknown) { super(message); } }, onCall: (_: unknown, handler: unknown) => handler }));
import { recordTaxIssue, recordTaxIssueCommand } from './taxIssueCommand';
import { readStatementCreation } from './statementCreationReceipt';
import { cashOriginalHash } from './cashMutationReceipt';
const source = (id: string, exempt = false) => ({ id, companyId: 'taebaek', type: '매출', partnerId: 'p', totalAmount: exempt ? 100 : 110,
 items: [{ supply: 100, tax: exempt ? 0 : 10, isTaxExempt: exempt }], docNo: id, createdBy: 'old-actor' });
function fixture() {
 const rows = new Map<string, any>(); let failAfter = -1;
 const ref = (path: string) => ({ path, id: path.split('/').pop()! });
 const collection = (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`), where: (key: string, _: string, value: unknown) => ({ name, key, value }) });
 const snapshot = (r: any) => ({ ...r, exists: rows.has(r.path), data: () => rows.get(r.path) });
 const tx = { get: async (r: any): Promise<any> => r.path ? snapshot(r) : ({ docs: [...rows].filter(([path, row]) => path.startsWith(r.name + '/') && row[r.key] === r.value).map(([path]) => snapshot(ref(path))) }),
  create: (_r: any, _data: any) => {}, update: (_r: any, _data: any) => {} };
 const db = { collection, runTransaction: async (fn: any) => {
  const writes: (() => void)[] = [];
  const add = (r: any, data: any, merge: boolean) => { if (failAfter === writes.length) throw new Error('unknown commit'); writes.push(() => rows.set(r.path, merge ? { ...rows.get(r.path), ...data } : data)); };
  const result = await fn({ ...tx, create: (r: any, data: any) => add(r, data, false), update: (r: any, data: any) => add(r, data, true) });
  writes.forEach(write => write()); return result;
 } } as any;
 const a = source('a'), b = source('b', true); for (const row of [a, b]) { const { id, ...body } = row; rows.set(`issuedStatements/${id}`, body); }
 const input = { companyId: 'taebaek' as const, operationId: 'tax-1', statements: [a, b], scope: 'all' as const, issuedAt: '2026-10-09T00:00:00Z' };
 return { db, rows, tx, input, failOnWrite: (n: number) => { failAfter = n; } };
}
describe('발행 확인 원자 명령', () => {
 it('서버 원문에서 과세·면세를 계산하고 금액·번호는 보존하며 동일 요청은 쓰기 없이 재사용한다', async () => {
  const f = fixture(), before = f.input.statements.map(cashOriginalHash);
  expect((await recordTaxIssue(f.db, 'taebaek', 'uid', f.input)).status).toBe('applied');
  expect(f.rows.get('taxIssueRecords/tax-1_taxable').amount).toBe(110);
  expect(f.rows.get('taxIssueRecords/tax-1_exempt').amount).toBe(100);
  const saved = JSON.stringify([...f.rows]); expect((await recordTaxIssue(f.db, 'taebaek', 'uid', f.input)).status).toBe('duplicate'); expect(JSON.stringify([...f.rows])).toBe(saved);
  for (let i = 0; i < 2; i++) { const row = f.rows.get(`issuedStatements/${f.input.statements[i].id}`);
   const origin = await readStatementCreation(f.db, f.tx as any, 'taebaek', f.input.statements[i].id, row, candidate => cashOriginalHash(candidate) === before[i]);
   expect(cashOriginalHash(origin)).toBe(before[i]); }
 });
 it('최신 원문 변경은 거절 감사만 확정하며 같은 요청은 거절 재사용, 새 원문은 새 ID로 저장한다', async () => {
  const f = fixture(); f.rows.get('issuedStatements/a').items[0].supply = 101;
  // 별개 client snapshot을 만들어 원문 차이를 표현한다.
  f.input.statements[0] = source('a');
  await expect(recordTaxIssue(f.db, 'taebaek', 'uid', f.input)).rejects.toMatchObject({ details: { terminalConfirmed: true, financialWrites: false } });
  expect([...f.rows.keys()].filter(key => key.startsWith('taxIssueRecords/'))).toEqual([]);
  const before = JSON.stringify([...f.rows]); await expect(recordTaxIssue(f.db, 'taebaek', 'uid', f.input)).rejects.toThrow('변경'); expect(JSON.stringify([...f.rows])).toBe(before);
  const next = { ...f.input, operationId: 'tax-2', statements: [{ ...f.rows.get('issuedStatements/a'), id: 'a' }, f.input.statements[1]] };
  expect((await recordTaxIssue(f.db, 'taebaek', 'uid', next)).status).toBe('applied');
 });
 it('두번째 쓰기 native 실패는 모든 쓰기와 거절 감사를 남기지 않는다', async () => {
  const f = fixture(), before = JSON.stringify([...f.rows]); f.failOnWrite(1);
  await expect(recordTaxIssue(f.db, 'taebaek', 'uid', f.input)).rejects.toThrow('unknown commit'); expect(JSON.stringify([...f.rows])).toBe(before);
 });
 it('회사·actor 충돌은 이전 성공을 증명하지 않고 원문을 보존한다', async () => {
  const f = fixture(); await recordTaxIssue(f.db, 'taebaek', 'uid', f.input); const before = JSON.stringify([...f.rows]);
  await expect(recordTaxIssue(f.db, 'taebaek', 'other', f.input)).rejects.toThrow('원문');
  await expect(recordTaxIssue(f.db, 'punghoe', 'uid', f.input)).rejects.toThrow('회사'); expect(JSON.stringify([...f.rows])).toBe(before);
 });
 it('관리자와 회사 employee claim을 실제 callable 진입에서 검사한다', async () => {
  const call = recordTaxIssueCommand as any;
  await expect(call({ auth: { uid: 'staff', token: { isAdmin: false, companyId: 'taebaek', employeeId: 'e' } }, data: fixture().input })).rejects.toMatchObject({ code: 'permission-denied' });
 });
 it('과거 화면의 issuedAt 빈 기본값은 허용하되 감사 원문에 새 빈 필드를 만들지 않는다', async () => {
  const f = fixture(); (f.input.statements[0] as any).issuedAt = ''; (f.input.statements[0] as any).tradeDate = '';
  expect((await recordTaxIssue(f.db, 'taebaek', 'uid', f.input)).status).toBe('applied');
  expect(f.rows.get('voucherMutationOperations/tax-1_tax_0').beforeSnapshot).not.toHaveProperty('issuedAt');
  expect((await recordTaxIssue(f.db, 'taebaek', 'uid', f.input)).status).toBe('duplicate');
 });
});
