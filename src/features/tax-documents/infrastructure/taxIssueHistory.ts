import { collection, doc, getDocsFromServer, getDocFromServer, query, where } from 'firebase/firestore';
import { db } from '../../../shared/firebase';
import { companyOf, type CompanyId, type IssuedStatement } from '../../../shared/types';
import { dateOfLocal, isCalendarDay } from '../../../shared/day';
import { planTaxIssue } from '../domain/taxIssue';
import { taxIssueRequestHash, type TaxIssueCommand } from './applyTaxIssueWrites';

type StoredRow = Record<string, unknown> & { id: string };
export interface TaxIssueHistoryGroup {
  key: string;
  stmts: IssuedStatement[];
  totalAmount: number | null;
  isBundle: boolean;
  issuedAt: string;
  partnerId: string;
  partnerName?: string;
  kind: 'taxable' | 'exempt' | 'legacy';
  originalVerified: boolean;
  notice: string;
}
export interface TaxHistoryRange { from: string; to: string }
const inRange = (issuedAt: unknown, range: TaxHistoryRange) => { if (!range.from && !range.to) return true; if (typeof issuedAt !== 'string' || !issuedAt || Number.isNaN(Date.parse(issuedAt))) return false; const date = dateOfLocal(issuedAt); return (!range.from || date >= range.from) && (!range.to || date <= range.to); };
export interface TaxIssueHistoryResult { groups: TaxIssueHistoryGroup[]; error: string; dateUnknownCount?: number }

async function withReadTimeout<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('발행 기록 조회 시간 초과')), 15000);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

function scopedStatement(statement: IssuedStatement, kind: 'taxable' | 'exempt'): IssuedStatement {
  const items = statement.items.filter(line => kind === 'exempt' ? line.isTaxExempt : !line.isTaxExempt);
  const totalSupply = items.reduce((sum, line) => sum + line.supply, 0);
  const totalTax = items.reduce((sum, line) => sum + line.tax, 0);
  return { ...statement, items, totalSupply, totalTax, totalAmount: totalSupply + totalTax };
}

function groupStatements(key: string, statements: IssuedStatement[], issuedAt: string,
  kind: TaxIssueHistoryGroup['kind'], originalVerified: boolean, notice: string): TaxIssueHistoryGroup[] {
  const partners = new Map<string, IssuedStatement[]>();
  for (const statement of statements) {
    const rows = partners.get(statement.partnerId) ?? [];
    rows.push(statement);
    partners.set(statement.partnerId, rows);
  }
  return [...partners].map(([partnerId, rows]) => ({
    key: `${key}:${partnerId}`, stmts: rows.sort((a, b) => b.tradeDate.localeCompare(a.tradeDate)),
    totalAmount: rows.reduce((sum, row) => sum + row.totalAmount, 0),
    isBundle: rows.length > 1, issuedAt, partnerId, partnerName: rows[0].partnerName,
    kind, originalVerified, notice,
  }));
}

/** 현재 전표가 수정돼도 최초 발행 command와 서버 영수증을 대조한 원문만 재출력한다. */
export async function projectTaxIssueHistory(companyId: CompanyId, statements: IssuedStatement[],
  records: StoredRow[], operations: Map<string, StoredRow | null>): Promise<TaxIssueHistoryGroup[]> {
  const current = new Map(statements.filter(row => companyOf(row) === companyId && row.type === '매출').map(row => [row.id, row]));
  const covered = new Set<string>();
  const groups: TaxIssueHistoryGroup[] = [];
  for (const record of records) {
    if (record.companyId !== companyId) continue;
    const ids = Array.isArray(record.statementIds) ? record.statementIds.filter((id): id is string => typeof id === 'string') : [];
    const relevant = ids.filter(id => current.has(id));
    const kind = record.kind === 'taxable' || record.kind === 'exempt' ? record.kind : null;
    relevant.forEach(id => covered.add(`${id}:${kind ?? 'unknown'}`));
    let original: IssuedStatement[] | null = null;
    try {
      const operation = operations.get(String(record.operationId));
      const command = operation?.command as TaxIssueCommand | undefined;
      if (!kind || !operation || operation.companyId !== companyId || operation.status !== 'applied' ||
          operation.operationId !== record.operationId || operation.id !== record.operationId ||
          !command || command.companyId !== companyId || command.operationId !== record.operationId ||
          operation.createdAt !== command.issuedAt ||
          !['all', 'taxable', 'exempt'].includes(command.scope) || !Array.isArray(command.statements) ||
          !command.statements.length || command.statements.some(row => !row || companyOf(row) !== companyId || row.type !== '매출' || !Array.isArray(row.items)) ||
          new Set(command.statements.map(row => row.id)).size !== command.statements.length ||
          operation.requestHash !== await taxIssueRequestHash(command)) throw new Error();
      const expected = planTaxIssue({ ...command, actorId: String(operation.actorId ?? '') }).writes
        .find(write => write.collection === 'taxIssueRecords' && write.id === record.id);
      if (!expected || Object.entries(expected.data).some(([key, value]) => JSON.stringify(record[key]) !== JSON.stringify(value))) throw new Error();
      original = command.statements.filter(row => ids.includes(row.id)).map(row => scopedStatement(row, kind));
    } catch {
      // 손상·조회 실패는 이력 자체를 숨기거나 현재 전표를 최초 원문으로 둔갑시키지 않는다.
    }
    if (original && kind) {
      groups.push(...groupStatements(record.id, original, String(record.issuedAt), kind, true, ''));
    } else {
      const notice = '원본 확인 필요: 최초 발행 원문과 처리 기록을 확인하지 못해 재출력할 수 없습니다. 다시 불러와 주세요.';
      if (relevant.length) groups.push(...groupStatements(record.id, relevant.map(id => current.get(id)!), typeof record.issuedAt === 'string' ? record.issuedAt : '', kind ?? 'legacy', false, notice));
      else groups.push({key: `${record.id}:unverified`, stmts: [], totalAmount: null, isBundle: false, issuedAt: typeof record.issuedAt === 'string' ? record.issuedAt : '', partnerId: '', kind: kind ?? 'legacy', originalVerified: false, notice});
    }
  }
  for (const statement of current.values()) {
    const kinds = [
      ['taxable', statement.taxIssuedAt], ['exempt', statement.exemptIssuedAt],
    ] as const;
    for (const [kind, issuedAt] of kinds) {
      if (!issuedAt || covered.has(`${statement.id}:${kind}`)) continue;
      // 순수 면세의 taxIssuedAt은 같은 면세 발행을 가리키는 옛 호환 표시다.
      if (kind === 'taxable' && !statement.items.some(line => !line.isTaxExempt) && statement.exemptIssuedAt) continue;
      groups.push(...groupStatements(`legacy:${statement.id}:${kind}`, [statement], issuedAt, 'legacy', false,
        '원본 확인 필요: 과거 전표의 발행 표시입니다. 최초 발행 원문이 없어 재출력할 수 없습니다.'));
    }
  }
  return groups.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}

export async function readTaxIssueHistory(companyId: CompanyId, statements: IssuedStatement[], isCurrent = () => true, range: TaxHistoryRange = {from:'',to:''}): Promise<TaxIssueHistoryResult> {
  if ((range.from && !isCalendarDay(range.from)) || (range.to && !isCalendarDay(range.to)) || (range.from && range.to && range.from > range.to)) throw new Error('발행일 시작일과 종료일을 올바르게 확인해 주세요.');
  if (!isCurrent()) throw new Error('조회 범위가 변경됐습니다.');
  const snapshot = await withReadTimeout(getDocsFromServer(query(collection(db, 'taxIssueRecords'), where('companyId', '==', companyId))));
  const companyRecords = snapshot.docs.map(row => ({ ...row.data(), id: row.id } as StoredRow)).filter(row => row.companyId === companyId);
  const dateUnknownCount = (range.from || range.to) ? companyRecords.filter(row => typeof row.issuedAt !== 'string' || !row.issuedAt || Number.isNaN(Date.parse(row.issuedAt))).length : 0;
  const records = companyRecords.filter(row => inRange(row.issuedAt, range));
  const operations = new Map<string, StoredRow | null>();
  let failures = 0;
  // 한꺼번에 무제한 요청하지 않고 연결된 고유 원문만 읽는다.
  for (const operationId of new Set(records.map(row => row.operationId))) {
    if (!isCurrent()) throw new Error('조회 범위가 변경됐습니다.');
    if (typeof operationId !== 'string' || !operationId || operationId.includes('/')) { failures++; continue; }
    try {
      const row = await withReadTimeout(getDocFromServer(doc(db, 'taxIssueOperations', operationId)));
      operations.set(operationId, row.exists() ? { ...row.data(), id: row.id } : null);
    } catch { operations.set(operationId, null); failures++; }
  }
  if (!isCurrent()) throw new Error('조회 범위가 변경됐습니다.');
  const groups = await projectTaxIssueHistory(companyId, statements, records, operations);
  if (!isCurrent()) throw new Error('조회 범위가 변경됐습니다.');
  return { groups: groups.filter(group => inRange(group.issuedAt, range)), dateUnknownCount: dateUnknownCount + ((range.from || range.to) ? groups.filter(group => group.kind === 'legacy' && !inRange(group.issuedAt, {from:'0001-01-01',to:'9999-12-31'})).length : 0),
    error: failures ? `발행 원문 ${failures}건을 불러오지 못했습니다. 해당 기록은 원본 확인이 필요합니다. 다시 불러와 주세요.` : '' };
}
