/** Pure shared advance accounting contract. Firebase and UI independent. */
export type CompanyId = 'taebaek' | 'punghoe';
export type AdvancePurpose = { version: 1; contractId: string; purpose: string; operationId: string };
export type IssuedStatementItem = {
  name: string; spec: string; qty: number; price: number; supply: number; tax: number; total: number;
  isTaxExempt?: boolean; accountCode?: string; side?: '차변' | '대변';
};
export type IssuedStatement = {
  id: string; companyId?: CompanyId; partnerId: string; type: string; tradeDate: string;
  totalAmount: number; items: IssuedStatementItem[]; noncashApplication?: ApplicationMetadata | CancellationMetadata;
};

export type AdvanceCode = '133' | '254';
export type TargetCode = '108' | '251' | '253';
export type SourceKey = { collection: 'cashEntries' | 'issuedStatements'; id: string; lineKey: string };
export type Allocation = { source: SourceKey; statementId: string; accountCode: TargetCode; amount: number };
export type ApplicationMetadata = {
  kind: 'advance-application'; version: 1; operationId: string; companyId: CompanyId; partnerId: string;
  purpose: string; requestFingerprint: string; sourceFingerprints: Record<string, string>;
  targetFingerprints: Record<string, string>; allocations: Allocation[];
};
export type CancellationMetadata = {
  kind: 'advance-cancellation'; version: 1; operationId: string; companyId: CompanyId;
  partnerId: string; applicationStatementId: string; applicationFingerprint: string; reason: string;
};
export type AdvanceStatement = IssuedStatement & { noncashApplication: ApplicationMetadata | CancellationMetadata };
export type SourceEvidence = {
  key: SourceKey; companyId: CompanyId; partnerId: string; code: AdvanceCode;
  /** 원본 분개의 해당 증가 줄 금액. 화면 잔액이 아니다. */
  originalAmount: number; date: string; fingerprint: string; purpose: string;
};
export type TargetEvidence = {
  statementId: string; companyId: CompanyId; partnerId: string; accountCode: TargetCode;
  /** 기존 결제·반품·기존 적용을 모두 반영한 최신 미결액. */
  remaining: number; date: string; fingerprint: string; purpose: string;
};
/** 서버 transaction이 원본·과거 감소·보류·회사별 계정 의미를 검증한 뒤 구성할 내부 입력이다. 외부 API 입력 금지. */
export type VerifiedContext = {
  companyId: CompanyId; partnerId: string; complete: boolean; unattributedReduction: boolean;
  blockedSourceKeys: string[]; sources: SourceEvidence[]; targets: TargetEvidence[];
  /** 해당 원천의 전체 기간 명시 적용액. 취소된 적용은 제외한다. */
  priorSourceUse: ReadonlyMap<string, number>;
};
export const sourceKey = (source: SourceKey) => JSON.stringify([source.collection, source.id, source.lineKey]);
const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
export class PartnerAdvanceValidationError extends Error {}
function fail(message: string): never { throw new PartnerAdvanceValidationError(message); }
const sum = (a: number, b: number) => Number.isSafeInteger(a + b) ? a + b : fail('적용액 범위를 초과했습니다.');
const calendarDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  && !Number.isNaN(new Date(`${date}T00:00:00Z`).valueOf())
  && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
export function planAdvanceApplication(context: VerifiedContext, request: {
  operationId: string; date: string; purpose: string; allocations: Allocation[];
}) {
  if (!context.complete || context.unattributedReduction) fail('원천의 전체 미사용 근거를 확인해야 합니다.');
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(request.operationId) || !calendarDate(request.date)
    || !request.purpose.trim() || !request.allocations.length) fail('적용 날짜·목적·대상을 확인해 주세요.');
  const sources = new Map(context.sources.map(row => [sourceKey(row.key), row]));
  const targets = new Map(context.targets.map(row => [row.statementId, row]));
  if (sources.size !== context.sources.length || targets.size !== context.targets.length) fail('원천·대상 식별자가 중복됩니다.');
  const usedSources = new Map<string, number>(), usedTargets = new Map<string, number>();
  const pairs = new Set<string>(), sourceFingerprints: Record<string, string> = {}, targetFingerprints: Record<string, string> = {};
  const lines = new Map<string, number>();
  for (const row of request.allocations) {
    const key = sourceKey(row.source), source = sources.get(key), target = targets.get(row.statementId);
    const pair = JSON.stringify([key, row.statementId]);
    if (!source || !target || pairs.has(pair) || !positive(row.amount)) fail('원천·대상·적용액이 잘못되었습니다.');
    pairs.add(pair);
    if (context.blockedSourceKeys.includes(key)) fail('보류된 원천에는 적용할 수 없습니다.');
    if (source.companyId !== context.companyId || target.companyId !== context.companyId
      || source.partnerId !== context.partnerId || target.partnerId !== context.partnerId) fail('회사·거래처가 일치하지 않습니다.');
    if (!source.fingerprint || !target.fingerprint || source.purpose !== request.purpose.trim()
      || target.purpose !== request.purpose.trim()) fail('거래 목적·원본 근거를 확인해 주세요.');
    if (!calendarDate(source.date) || !calendarDate(target.date)
      || request.date < source.date || request.date < target.date) fail('원천·대상 발생 전에는 적용할 수 없습니다.');
    if (row.accountCode !== target.accountCode || !(source.code === '133' && ['251', '253'].includes(target.accountCode)
      || source.code === '254' && target.accountCode === '108')) fail('허용되지 않은 계정 짝입니다.');
    const previous = context.priorSourceUse.get(key) ?? 0;
    if (!Number.isSafeInteger(previous) || previous < 0 || !positive(source.originalAmount)
      || !Number.isSafeInteger(target.remaining) || target.remaining < 0) fail('잔량 근거가 잘못되었습니다.');
    const sourceUse = sum(usedSources.get(key) ?? 0, row.amount), targetUse = sum(usedTargets.get(target.statementId) ?? 0, row.amount);
    if (sum(previous, sourceUse) > source.originalAmount || targetUse > target.remaining) fail('원천 미사용액 또는 대상 미결액을 넘습니다.');
    usedSources.set(key, sourceUse); usedTargets.set(target.statementId, targetUse);
    sourceFingerprints[key] = source.fingerprint; targetFingerprints[target.statementId] = target.fingerprint;
    for (const [code, side] of source.code === '133'
      ? [[target.accountCode, '차변'], [source.code, '대변']] : [[source.code, '차변'], [target.accountCode, '대변']]) {
      const lineKey = `${code}:${side}`; lines.set(lineKey, sum(lines.get(lineKey) ?? 0, row.amount));
    }
  }
  const allocations = request.allocations.map(row => ({ ...row, source: { ...row.source } }))
    .sort((a, b) => sourceKey(a.source).localeCompare(sourceKey(b.source)) || a.statementId.localeCompare(b.statementId));
  const metadata: ApplicationMetadata = {
    kind: 'advance-application', version: 1, operationId: request.operationId,
    companyId: context.companyId, partnerId: context.partnerId, purpose: request.purpose.trim(),
    sourceFingerprints, targetFingerprints, allocations,
    // 순수 정규화 입력. 서버는 이 문자열의 SHA256과 저장결과를 함께 확인한다.
    requestFingerprint: JSON.stringify([context.companyId, context.partnerId, request.date, request.purpose.trim(),
      allocations.map(row => [sourceKey(row.source), row.statementId, row.accountCode, row.amount,
        sourceFingerprints[sourceKey(row.source)], targetFingerprints[row.statementId]])]),
  };
  const items: IssuedStatementItem[] = [...lines].sort(([a], [b]) => a.localeCompare(b)).map(([key, amount]) => {
    const [accountCode, side] = key.split(':');
    return { name: request.purpose.trim(), spec: '', qty: 1, price: amount, supply: amount, tax: 0,
      total: amount, isTaxExempt: true, accountCode, side: side as '차변' | '대변' };
  });
  return { metadata, items, amount: [...usedSources.values()].reduce(sum, 0) };
}

export function planAdvanceCancellation(statement: AdvanceStatement, operationId: string, reason: string) {
  if (!isAdvanceStatement(statement) || statement.noncashApplication.kind !== 'advance-application'
    || !/^[A-Za-z0-9_-]{1,120}$/.test(operationId) || !reason.trim()) fail('취소 원본·사유를 확인해 주세요.');
  const metadata: CancellationMetadata = { kind: 'advance-cancellation', version: 1, operationId,
    companyId: statement.noncashApplication.companyId, partnerId: statement.partnerId,
    applicationStatementId: statement.id, applicationFingerprint: statement.noncashApplication.requestFingerprint, reason: reason.trim() };
  return { metadata, items: statement.items.map(row => ({ ...row, side: row.side === '차변' ? '대변' as const : '차변' as const })) };
}

/** 적용/취소는 발생 채무가 아니다. 잘못된 꼬리표를 조용히 일반전표로 해석하지 않는다. */
export function isAdvanceStatement(statement: IssuedStatement): boolean {
  const meta = (statement as Partial<AdvanceStatement>).noncashApplication;
  if (meta === undefined) return false;
  if (!meta || meta.version !== 1 || !['advance-application', 'advance-cancellation'].includes(meta.kind)
    || meta.companyId !== (statement.companyId ?? 'taebaek') || meta.partnerId !== statement.partnerId
    || !meta.operationId || statement.type !== '비용') fail('비현금 적용 기록을 확인해야 합니다.');
  if (meta.kind === 'advance-application') {
    if (!Array.isArray(meta.allocations) || !meta.allocations.length || !meta.requestFingerprint
      || !meta.purpose?.trim()) fail('비현금 적용 기록을 확인해야 합니다.');
    const expected = new Map<string, number>();
    let amount = 0;
    for (const row of meta.allocations) {
      if (!row.source || !['cashEntries', 'issuedStatements'].includes(row.source.collection)
        || !row.source.id || !row.source.lineKey || !row.statementId
        || !['108', '251', '253'].includes(row.accountCode) || !positive(row.amount)
        || !meta.sourceFingerprints?.[sourceKey(row.source)] || !meta.targetFingerprints?.[row.statementId]) fail('비현금 적용 기록을 확인해야 합니다.');
      amount = sum(amount, row.amount);
      const pairs = row.accountCode === '108' ? [['254', '차변'], ['108', '대변']]
        : [[row.accountCode, '차변'], ['133', '대변']];
      for (const [code, side] of pairs) {
        const key = `${code}:${side}`; expected.set(key, sum(expected.get(key) ?? 0, row.amount));
      }
    }
    const actual = new Map<string, number>();
    for (const row of statement.items) {
      const key = `${row.accountCode}:${row.side}`;
      if (!positive(row.total) || row.tax !== 0) fail('적용 분개와 기록이 다릅니다.');
      actual.set(key, sum(actual.get(key) ?? 0, row.total));
    }
    if (statement.totalAmount !== amount || actual.size !== expected.size
      || [...expected].some(([key, value]) => actual.get(key) !== value)) fail('적용 분개와 기록이 다릅니다.');
  } else if (!meta.applicationStatementId || !meta.applicationFingerprint || !meta.reason?.trim()) {
    fail('취소 원본·사유를 확인해야 합니다.');
  }
  return true;
}

export function activeAdvanceApplications(statements: IssuedStatement[], companyId: CompanyId, partnerId: string) {
  const mine = statements.filter(row => (row.companyId ?? 'taebaek') === companyId && row.partnerId === partnerId && isAdvanceStatement(row)) as AdvanceStatement[];
  const byId = new Map(mine.map(row => [row.id, row]));
  if (byId.size !== mine.length) fail('적용 기록 ID가 중복됩니다.');
  if (new Set(mine.map(row => row.noncashApplication.operationId)).size !== mine.length) fail('적용 작업 ID가 중복됩니다.');
  const cancelled = new Set<string>();
  for (const row of mine) {
    const meta = row.noncashApplication;
    if (meta.kind !== 'advance-cancellation') continue;
    const original = byId.get(meta.applicationStatementId)?.noncashApplication;
    if (!original || original.kind !== 'advance-application' || original.requestFingerprint !== meta.applicationFingerprint
      || cancelled.has(meta.applicationStatementId)) fail('취소 원본·중복 취소를 확인해야 합니다.');
    const originalStatement = byId.get(meta.applicationStatementId)!;
    const lines = (document: IssuedStatement, reverse: boolean) => document.items.map(item =>
      [item.accountCode, reverse ? (item.side === '차변' ? '대변' : '차변') : item.side, item.total, item.tax].join(':')).sort();
    if (row.totalAmount !== originalStatement.totalAmount || row.tradeDate < originalStatement.tradeDate
      || JSON.stringify(lines(row, false)) !== JSON.stringify(lines(originalStatement, true))) fail('취소 분개가 원본과 다릅니다.');
    cancelled.add(meta.applicationStatementId);
  }
  return mine.filter(row => row.noncashApplication.kind === 'advance-application' && !cancelled.has(row.id));
}

type Claim = { id: string; companyId: string; partnerId: string; accountCode: TargetCode; amount: number };
/** 서버의 기존 claimFromStatement를 주입한다. 적용·취소 모두 새 채무로 만들지 않는다. */
export function claimWithoutAdvance<T>(id: string, statement: IssuedStatement,
  adapter: (id: string, row: IssuedStatement) => T): T | null {
  return isAdvanceStatement(statement) ? null : adapter(id, statement);
}
export function appliedToTargets(statements: IssuedStatement[], companyId: CompanyId, partnerId: string, after?: string) {
  const result = new Map<string, { accountCode: TargetCode; amount: number }>();
  const active = activeAdvanceApplications(statements, companyId, partnerId);
  const events = after ? statements.filter(row => (row.companyId ?? 'taebaek') === companyId && row.partnerId === partnerId && isAdvanceStatement(row)) : active;
  for (const statement of events) {
    // 앵커 잔량은 그 날짜까지 적용을 이미 포함한다. 이후 적용만 추가 차감한다.
    if (after && statement.tradeDate <= after) continue;
    const event = statement.noncashApplication!;
    const meta = event.kind === 'advance-application' ? event : statements.find(row => row.id === event.applicationStatementId)!.noncashApplication as ApplicationMetadata;
    const sign = event.kind === 'advance-cancellation' ? -1 : 1;
    for (const row of meta.allocations) {
      const old = result.get(row.statementId);
      if (old && old.accountCode !== row.accountCode) throw new Error('대상 계정이 서로 다릅니다.');
      const amount = (old?.amount ?? 0) + sign * row.amount;
      if (!Number.isSafeInteger(row.amount) || row.amount <= 0 || !Number.isSafeInteger(amount)) throw new Error('적용액이 잘못되었습니다.');
      result.set(row.statementId, { accountCode: row.accountCode, amount });
    }
  }
  return result;
}
/** 반품 투영 이후, 현금 배분 전에 한 번만 호출한다. 원본 분개 입력에는 사용하지 않는다. */
export function claimsAfterAdvance<T extends Claim>(claims: T[], statements: IssuedStatement[], companyId: CompanyId, partnerId: string) {
  const used = appliedToTargets(statements, companyId, partnerId);
  const byId = new Map(claims.map(row => [row.id, row]));
  for (const [id, row] of used) {
    const claim = byId.get(id);
    if (!claim || claim.companyId !== companyId || claim.partnerId !== partnerId || claim.accountCode !== row.accountCode
      || !Number.isSafeInteger(claim.amount) || row.amount > claim.amount) throw new Error('대상 원전표·계정·미결을 확인해야 합니다.');
  }
  return claims.map(claim => ({ ...claim, amount: claim.amount - (used.get(claim.id)?.amount ?? 0) }));
}


/** Public command DTO: exactly one source, one target and one amount. */
export type ApplyPartnerAdvanceInput = {
  operationId: string; partnerId: string; date: string; source: SourceKey;
  statementId: string; accountCode: TargetCode; amount: number;
  expectedSourceFingerprint: string; expectedTargetFingerprint: string;
  expectedRevision: number; releaseId: string;
};
export type CancelPartnerAdvanceInput = {
  operationId: string; partnerId: string; date: string; applicationStatementId: string;
  reason: string; expectedRevision: number; releaseId: string;
};

export type PreparedPartnerAdvance = {
 enabled:boolean; blockedReason?:string; revision:number; releaseId:string;
 sources:{key:SourceKey;code:AdvanceCode;originalAmount:number;remaining:number;date:string;docNo:string;note:string;fingerprint:string}[];
 targets:{statementId:string;accountCode:TargetCode;remaining:number;date:string;docNo:string;fingerprint:string}[];
 applications:{statementId:string;amount:number;date:string;docNo:string;source:SourceKey;targetStatementId:string}[];
 diagnostics:{id:string;reason:string}[];
};
