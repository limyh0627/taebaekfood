import type {AccountCode,FixedCostTemplate} from '../../../shared/types';
import {CASH_TEMPLATES,type CashTemplate,type VoucherDir} from './cashTemplateCatalog';

/**
 * 화면에 띄울 템플릿 — **DB(fixedCostTemplates)가 원천**이고, 위 CASH_TEMPLATES는 시드다.
 * (seed-voucher-templates.mjs로 한 번 넣었다. DB가 비어 있으면 코드 목록으로 버틴다.)
 *
 * 사용자가 이름·거래처·금액을 고치고 숨길 수 있어야 해서 DB로 옮겼다 — 코드에 있으면 배포해야 바뀐다.
 *
 * 계정과목 번호 순으로 세운다 — 계정과목 드롭다운도 같은 순서라 두 곳을 오갈 때 눈이 안 헤맨다.
 * 계정이 안 붙은 것(직접입력·대출상환·급여)은 번호가 없으니 위에 그대로 둔다.
 * 계정이 사라진 템플릿도 사유를 보여 준다. 조용히 지우면 저장 실패로 오해한다.
 */
export function missingTemplateAccountCodes(t: Pick<FixedCostTemplate, 'accountCode' | 'loanCode' | 'transferLines'>, have: Set<string>): string[] {
  return [...new Set([t.accountCode, t.loanCode, ...(t.transferLines ?? []).map(line => line.accountCode)]
    .filter((code): code is string => !!code && !have.has(code)))];
}

export function filterTemplates(
  accountCodes: AccountCode[],
  saved: FixedCostTemplate[] = [],
): CashTemplate[] {
  const have = new Set(accountCodes.map(c => c.code));
  const dirOf = (t: FixedCostTemplate): VoucherDir => t.dir ?? '출금';
  const fromDb = saved
    .filter(t => t.kind === 'voucher' && !t.hidden)
    .map((t): CashTemplate => ({
      id: t.id,
      label: t.name,
      dir: dirOf(t),
      mode: (t.mode ?? '일반') as CashTemplate['mode'],
      accountCode: t.accountCode,
      note: t.note,
      amount: t.amount || undefined,
      partnerId: t.partnerId,
      partnerName: t.partnerName,
      taxExempt: t.taxExempt,
      statementType: t.statementType,
      builtin: t.builtin,
      group: t.group,
      favorite: t.favorite,
      itemName: t.itemName,
      insCorp: t.insCorp,     insEmp: t.insEmp,
      principal: t.principal, interest: t.interest,
      gross: t.gross,         deduction: t.deduction,
      loanCode: t.loanCode,
      loanId: t.loanId,
      transferLines: t.transferLines,
      unavailableCodes: missingTemplateAccountCodes(t, have),
      ...(t.mode === '상환' ? { hint: '원금 + 이자' } : {}),
      ...(t.mode === '급여' ? { hint: '총급여 − 공제' } : {}),
      ...(t.mode === '보험' ? { hint: '회사부담 + 예수금' } : {}),
    }));
  const mine = fromDb.length ? fromDb : CASH_TEMPLATES.map(t => ({
    ...t, unavailableCodes: missingTemplateAccountCodes(t, have),
  }));
  const noCode = mine.filter(t => !t.accountCode);
  const coded = mine.filter(t => t.accountCode)
    .sort((a, b) => String(a.accountCode).localeCompare(String(b.accountCode), undefined, { numeric: true }));
  return [...noCode, ...coded];
}

/**
 * 지금 폼 상태가 어느 템플릿인지 — 고른 것이 눌린 채로 보여야 무슨 전표를 쓰는 중인지 안다.
 * **null이면 직접입력**(템플릿 없음)이다. 직접입력은 템플릿이 아니라 상태라 목록에 두지 않는다.
 */
export function activeTemplateId(
  templates: CashTemplate[],
  state: { mode: '일반' | '상환' | '급여' | '보험' | '세금'; accountCode?: string },
): string | null {
  if (state.mode !== '일반') return templates.find(t => t.mode === state.mode)?.id ?? null;
  if (!state.accountCode) return null;
  return templates.find(t => t.mode === '일반' && t.accountCode === state.accountCode)?.id ?? null;
}

/** 지금 고른 템플릿(없으면 그 방향의 직접입력) */
export function activeTemplate(
  templates: CashTemplate[],
  state: { mode: '일반' | '상환' | '급여' | '보험' | '세금'; accountCode?: string },
): CashTemplate | undefined {
  const id = activeTemplateId(templates, state);
  return templates.find(t => t.id === id);
}
