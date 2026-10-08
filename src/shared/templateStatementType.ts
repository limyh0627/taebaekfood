import { recurringType, recurringTransferItems } from '../../functions/src/shared/recurringVoucher';
export type TemplateStatementType = '매출' | '매입' | '비용';

interface TemplateSource {
  statementType?: TemplateStatementType;
  dir?: string;
  partnerId?: string;
  transferLines?: { accountCode: string; side: '차변' | '대변'; name?: string }[];
}

/** 옛 자료만 기존 판정으로 읽는다. 새 명시 종류는 거래처를 바꿔도 유지된다. */
export function templateStatementType(t: TemplateSource): TemplateStatementType {
  return recurringType(t);
}

/** 금액 하나로 자동 생성 가능한 대체는 차·대 한 줄씩인 양식뿐이다. */
export function canAutoStatement(t: TemplateSource): boolean {
  if (templateStatementConflict(t)) return false;
  if (t.transferLines?.length && !t.statementType) return false;
  if (templateStatementType(t) !== '비용') return !!t.partnerId;
  // 예전에 자동 발행 불가였던 대체 양식을 업데이트만으로 새로 발행하지 않는다.
  if (t.statementType !== '비용') return false;
  const lines = t.transferLines ?? [];
  return lines.length === 2 && lines.every(l => !!l.accountCode)
    && lines.filter(l => l.side === '차변').length === 1
    && lines.filter(l => l.side === '대변').length === 1;
}

/** 앱 월별 발행과 서버 발행이 동일한 양식·금액으로 대체전표를 만든다. */
export function templateTransferItems(t: TemplateSource & { amount: number; name?: string }) {
  if (!canAutoStatement(t) || templateStatementType(t) !== '비용') throw new Error('대체전표의 차변·대변 계정을 확인해 주세요.');
  return recurringTransferItems(t);
}
/** 줄돈·받을돈은 채무·채권 종류와 충돌하면 사용자가 바로잡아야 한다. */
export function templateStatementConflict(t: TemplateSource): string | undefined {
  if (!t.statementType) return;
  const dir = t.dir ?? '출금';
  if (dir === '줄돈' && t.statementType !== '매입') return '줄돈은 매입전표를 선택해 주세요.';
  if (dir === '받을돈' && t.statementType !== '매출') return '받을돈은 매출전표를 선택해 주세요.';
}