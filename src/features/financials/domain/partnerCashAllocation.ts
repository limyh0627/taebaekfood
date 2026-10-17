import {projectCashLines,cashLineReduction} from '../../../../functions/src/shared/cashLineProjection';
import {type CashEntry,type IssuedStatement,type Settlement,companyOf} from '../../../shared/types';
import {journalizeStatement,journalizeTransfer,AR} from '../../../shared/autoJournal';
import {appliedToTargets} from '../../../shared/partnerAdvance';
import {PAYABLES,isPay} from './partnerAccountCodes';

/**
 * 전표에 대해 이미 매칭(상계)된 금액.
 *
 * **근거가 살아 있는 것만 센다.** 자금줄이 지워져도 매칭 기록(settlements)은 남는데,
 * 그걸 세면 없는 돈으로 갚은 것이 된다. `allocatePartnerCash` 는 진작 그렇게 하고 있었고
 * 여기만 안 봐서 **같은 전표가 두 화면에서 다른 잔액으로 보였다**(2026-09-03 실측) —
 *
 *   260827-02 희성실업   전표 목록 1,026만 미지급   매칭 후보 창 186만
 *   260902-04 해피유통    전표 목록      0원        매칭 후보 창 **−995만**
 *
 * @param liveCashIds 살아 있는 자금줄 id. 안 넘기면 예전처럼 다 센다(옛 호출부 호환).
 */
export function settledAmount(
  statementId: string,
  settlements: Settlement[],
  liveCashIds?: Set<string>,
): number {
  return settlements
    .filter(s => s.statementId === statementId)
    .filter(s => !liveCashIds || liveCashIds.has(s.cashEntryId))
    .reduce((a, s) => a + s.amount, 0);
}

/** 전표의 미결제 잔액. 0 이하면 결제 완료. */
export function openBalance(
  stmt: IssuedStatement,
  settlements: Settlement[],
  liveCashIds?: Set<string>,
): number {
  return stmt.totalAmount - settledAmount(stmt.id, settlements, liveCashIds);
}

/**
 * 아직 안 끝난 전표들 — 자금 원장에서 매칭 대상으로 띄울 목록.
 * `cashEntries` 를 넘기면 지워진 자금줄에 매달린 매칭은 안 센다(넘기는 게 맞다).
 */
export function unsettledStatements(
  statements: IssuedStatement[],
  settlements: Settlement[],
  opts?: { type?: '매출' | '매입'; partnerId?: string; cashEntries?: CashEntry[]; projection?: {returnOperations?:readonly ReadonlyReturnOperation[];advanceStatements?:readonly IssuedStatement[]} },
): { stmt: IssuedStatement; open: number }[] {
  const live = opts?.cashEntries ? new Set(opts.cashEntries.map(e => e.id)) : undefined;
  const projected = new Map<string,number>();
  if(opts?.projection) for(const partnerId of new Set(statements.map(s=>s.partnerId))){
    if(opts.partnerId&&opts.partnerId!==partnerId)continue;
    for(const type of opts.type?[opts.type]:['매출','매입'] as const)for(const [id,open] of allocatePartnerCash(partnerId,type,statements,opts.cashEntries??[],settlements,undefined,opts.projection.returnOperations,{statements:opts.projection.advanceStatements,matchOnly:true}))projected.set(id,open);
  }
  return statements
    .filter(s => s.noncashApplication===undefined && (!opts?.type || (opts.projection ? isReceivableStmt(s,opts.type) : s.type === opts.type)) && (!opts?.partnerId || s.partnerId === opts.partnerId))
    .map(stmt => ({ stmt, open: opts?.projection ? projected.get(stmt.id)??0 : openBalance(stmt, settlements, live) }))
    .filter(r => r.open > 0)
    .sort((a, b) => (a.stmt.tradeDate || '').localeCompare(b.stmt.tradeDate || ''));
}

/** 자금 이동 한 건에 대해 아직 전표에 안 붙은 금액 */
export function unmatchedCash(entry: CashEntry, settlements: Settlement[]): number {
  if (entry.balanceAdjustment) return 0;
  const matched = settlements
    .filter(s => s.cashEntryId === entry.id)
    .reduce((a, s) => a + s.amount, 0);
  return entry.amount - matched;
}

export function partnerOpenBalance(
  partnerId: string,
  type: '매출' | '매입',
  statements: IssuedStatement[],
  cashEntries: CashEntry[],
): number {
  const gross = statements
    .filter(s => s.partnerId === partnerId && isReceivableStmt(s, type))
    .reduce((a, s) => a + (returnClaimAmount(s, type) ?? s.totalAmount ?? 0), 0);
  return gross - partnerPaid(partnerId, type, cashEntries);
}

/**
 * 전표별 남은 금액 — 거래처로 들어온 돈을 전표에 나눠 붙인다.
 *
 *   1) 사람이 지정한 매칭(settlement)을 **먼저** 채운다 — "이 입금은 이 청구서"라고 찍은 것
 *   2) 남은 돈은 오래된 전표부터 자동으로 채운다(선입선출)
 *
 * **잔액식은 이걸 안 쓴다.** 거래처 잔액은 늘 `partnerOpenBalance`(청구액 − 자금원장)로 낸다.
 * 그래서 매칭이 틀리거나 고아가 돼도 잔액은 안 흔들리고, "어느 청구서냐"만 틀린다.
 * 전에 payments[]가 금액까지 들고 있어서 화면마다 잔액이 달랐던 게 그 반대 경우다.
 *
 * 근거(cashEntry)가 사라진 매칭은 안 친다 — 근거 없이 갚은 것으로 치면 안 받은 돈이 사라진다.
 */
/**
 * **이 전표가 그 거래처의 채권(매출)·채무(매입)를 세우는가 — 분개로 판단한다.**
 *
 * 타입(매출/매입)으로 보면 근거가 약하다. 갈래는 "어떻게 끊었는지"일 뿐이고
 * **잔액은 계정이 정한다.** 그래서 실제로 108/251이 서는지를 본다.
 *
 * 분개가 안 서는 전표(품목에 계정이 안 붙은 것)는 **애초에 있으면 안 된다** — 대변을 못 채우면
 * 차·대가 안 맞는다. 그래서 여기서 감싸 주지 않는다. 만드는 길은 발행 때 막는다
 * (TradeStatement가 계정 없는 줄이 있으면 저장을 거부한다).
 *
 * 다만 **기초이월은 분개가 안 선다** — 차·대를 직접 세운 일반전표라 type이 '비용'이고
 * journalizeStatement는 매출·매입만 만든다. 그건 줄에 적힌 108 차변 / 251 대변으로 읽는다.
 * 이걸 빠뜨리면 기초를 갚은 수금이 새 전표를 오래된 순으로 갉아먹는다
 * (유통가교: 기초 1,755,000 수금에 08-25·08-28이 다 갚아진 걸로 잡혔다. 실제 미수 620,000).
 */
function returnClaimAmount(s: IssuedStatement, type: '매출' | '매입'): number | undefined {
  if (s.type !== '비용' || !(s as IssuedStatement & { returnOperationId?: string }).returnOperationId) return undefined;
  const codes = type === '매출' ? [AR] : PAYABLES;
  return (journalizeTransfer(s)?.lines ?? []).filter(line => codes.includes(String(line.accountCode)))
    .reduce((sum, line) => sum + (type === '매출' ? (line.debit ?? 0) - (line.credit ?? 0) : (line.credit ?? 0) - (line.debit ?? 0)), 0);
}

export function isReceivableStmt(s: IssuedStatement, type: '매출' | '매입'): boolean {
  if (s.noncashApplication !== undefined) return false;
  const returned = returnClaimAmount(s, type);
  if (returned !== undefined) return returned !== 0;
  const wantCodes = type === '매출' ? [AR] : PAYABLES;
  for (const l of journalizeStatement(s)?.lines ?? []) {
    if (!wantCodes.includes(String(l.accountCode))) continue;
    const moved = type === '매출' ? (l.debit ?? 0) - (l.credit ?? 0) : (l.credit ?? 0) - (l.debit ?? 0);
    if (moved !== 0) return true;
  }
  const side = type === '매출' ? '차변' : '대변';
  return (s.items ?? []).some(it => wantCodes.includes(String(it.accountCode)) && it.side === side);
}

export type ReadonlyReturnOperation = { id: string; companyId: string; journalId: string;
  sourcePresence?: Readonly<Record<string, boolean>>; amount?: number; applications?: { id: string; statementId: string; amount: number }[] };

export function allocatePartnerCash(
  partnerId: string,
  type: '매출' | '매입',
  statements: IssuedStatement[],
  cashEntries: CashEntry[],
  settlements: Settlement[] = [],
  /**
   * **앵커에서 이어받은 시작 잔액** (전표 id → 그때 남아 있던 금액).
   *
   * 앵커 이전을 안 읽을 때 쓴다. 앵커에 담긴 미결 전표는 이미 얼마쯤 갚힌 상태라
   * 총액부터 다시 시작하면 그만큼 덜 갚은 것으로 보인다. 없으면 총액부터.
   */
  opening?: Map<string, number>,
  returnOperations?: readonly ReadonlyReturnOperation[],
  advance?: { statements?: readonly IssuedStatement[]; asOf?: string; matchOnly?:boolean },
): Map<string, number> {
  //  기초이월 전표도 후보에 넣는다 — 안 넣으면 그걸 갚은 수금이 새 전표를 갉아먹는다(isReceivableStmt 주석 참조).
  const eligible = statements
    .filter(s => s.partnerId === partnerId && isReceivableStmt(s, type))
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.id.localeCompare(b.id));
  const amountOf = (s: IssuedStatement) => opening?.get(s.id) ?? returnClaimAmount(s, type) ?? s.totalAmount ?? 0;
  let mine = eligible.filter(s => amountOf(s) > 0);
  let returnCredit = -eligible.filter(s => returnClaimAmount(s, type) === undefined)
    .reduce((sum, s) => sum + Math.min(0, amountOf(s)), 0);
  const left = new Map(mine.map(s => [s.id, amountOf(s)]));
  for (const statement of eligible) if (opening?.get(statement.id) === 0) left.set(statement.id, 0);
  const returned = eligible.filter(s => returnClaimAmount(s, type) !== undefined);
  const pending = () => new Map(eligible.map(s => [s.id, Number.NaN]));
  // A subscription not yet loaded cannot establish invoice allocations.
  if (returned.length && returnOperations === undefined) return pending();
  for (const journal of returned) {
    const operationId = (journal as IssuedStatement & { returnOperationId?: string }).returnOperationId;
    const operation = returnOperations?.find(row => row.id === operationId && row.companyId === companyOf(journal) && row.journalId === journal.id);
    const applications = operation?.applications;
    const amount = -returnClaimAmount(journal, type)!;
    if (!operation || !applications || new Set(applications.map(row => row.id)).size !== applications.length
      || applications.some(row => !Number.isSafeInteger(row.amount) || row.amount <= 0)
      || applications.reduce((sum, row) => sum + row.amount, 0) !== amount || operation.amount !== amount) return pending();
    for (const row of applications) {
      const target = eligible.find(s => s.id === row.statementId);
      if (!target) {
        if (statements.some(s => s.id === row.statementId) || operation.sourcePresence?.[row.statementId] !== false) return pending();
        returnCredit += row.amount;
      } else {
        const old = left.get(row.statementId);
        if (old === undefined || row.amount > old) return pending();
        left.set(row.statementId, old - row.amount);
      }
    }
  }
  for (const journal of returned) left.set(journal.id, 0);
  const tagged = statements.filter(s => s.partnerId === partnerId && s.noncashApplication !== undefined);
  if (tagged.some(s => !advance?.statements?.some(verified => verified.id === s.id))) return pending();
  if (advance?.statements) {
    try {
      const companyId = companyOf(eligible[0] ?? tagged[0] ?? advance.statements.find(s => s.partnerId === partnerId)!);
      for (const [id, applied] of appliedToTargets([...advance.statements], companyId, partnerId, advance.asOf)) {
        if (!(type === '매출' ? applied.accountCode === AR : isPay(applied.accountCode))) continue;
        const old = left.get(id);
        if (old === undefined || applied.amount > old) return pending();
        left.set(id, old - applied.amount);
      }
    } catch { return pending(); }
  }
  mine = eligible.filter(s => (left.get(s.id) ?? 0) > 0);
  if (!mine.length) return left;

  const liveCash = new Set(cashEntries.map(e => e.id));
  const mineIds = new Set(mine.map(s => s.id));

  // 1) 지정 매칭 — 근거가 살아 있는 것만, 전표 잔액을 넘지 않게
  let pinned = 0;
  for (const st of settlements) {
    if (!mineIds.has(st.statementId) || !liveCash.has(st.cashEntryId)) continue;
    const open = left.get(st.statementId) ?? 0;
    const apply = Math.min(Math.max(st.amount ?? 0, 0), open);
    if (apply <= 0) continue;
    left.set(st.statementId, open - apply);
    pinned += apply;
  }

  // 2) 남은 돈은 오래된 순으로
  let rem = Math.max(0, (advance?.matchOnly ? 0 : partnerPaid(partnerId, type, cashEntries) - pinned) + returnCredit);
  for (const s of mine) {
    if (rem <= 0) break;
    const open = left.get(s.id) ?? 0;
    const apply = Math.min(rem, open);
    if (apply <= 0) continue;
    left.set(s.id, open - apply);
    rem -= apply;
  }
  return left;
}

/** 자금기록 한 건이 채권·채무를 턴 몫 */
export interface PartnerCashPart {
  /** 108 외상매출금(채권) · 251 외상매입금(채무) */
  code: string;
  /** 양수 = 그만큼 줄었다(수금·지불·상계), 음수 = 되돌림 */
  reduce: number;
  note?: string;
}

/**
 * 자금기록 한 건에서 **거래처 채권·채무(108/251)를 턴 몫**을 뽑는다.
 *
 * 잔액·이월·타임라인·미수금 상세가 전부 이 한 곳을 본다. 화면마다 따로 세면
 * 같은 거래처가 화면마다 다른 잔액으로 보인다 — 실제로 그래서 상계가 어떤 화면에선
 * 안 보이고 어떤 화면에선 부호가 뒤집혀 보였다.
 *
 * **상계(대체)가 까다롭다.** 줄 부호가 차·대를 뜻해서 108이 음수로 적힌다.
 * `amount > 0`으로 거르면 그 줄이 통째로 사라지고, 부호를 그대로 쓰면 채권이 늘어난 것처럼 읽힌다.
 * 실제 차대 방향을 읽는다. 108 대변·251/253 차변은 감소이고 반대는 증가다.
 */
export function partnerCashParts(e: CashEntry): PartnerCashPart[] {
  return projectCashLines(e).parts
    .filter(part => part.accountCode === AR || isPay(part.accountCode))
    .map(part => ({ code: part.accountCode, reduce: cashLineReduction(e.dir, part.accountCode, part.amount), note: part.note }));
}

/** 그 거래처로 오간 채권·채무(108/251) 자금 합계. 반대 방향은 되돌림(음수). */
export function partnerPaid(
  partnerId: string,
  type: '매출' | '매입',
  cashEntries: CashEntry[],
): number {
  const wantCodes = type === '매출' ? [AR] : PAYABLES;
  return cashEntries
    .filter(e => e.partnerId === partnerId)
    .reduce((a, e) => a + partnerCashParts(e)
      .reduce((b, p) => b + (wantCodes.includes(p.code) ? p.reduce : 0), 0), 0);
}
