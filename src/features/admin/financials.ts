/** 기존 재무 공개 경로를 유지하고 업무별 단일 정본을 다시 내보낸다. */
export {COMPUTED_GROUP_IDS,SGNA_LEGACY_IDS,makeCodeToGroup,isCashAccountCode,filterCodesForContext} from '../financials/domain/accountClassification';
export {plMovement,plOfJournals,computeMonthPLFromJournals} from '../financials/domain/profitLoss';
export type {MonthPL} from '../financials/domain/profitLoss';
export {computeCashFlowDirect,cfSectionOf} from '../financials/domain/cashFlowDirect';
export type {CashFlowDirectLine,CashFlowDirect} from '../financials/domain/cashFlowDirect';

/** YYYY-MM에 d개월 더한/뺀 YYYY-MM */
export function addMonthStr(ym: string, d: number): string {
  const [y, m] = ym.split('-').map(Number);
  const dt = new Date(y, m - 1 + d, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}
