import { buildJournals, type BuildJournalsInput } from '../../shared/buildJournals';
import { computeMonthPLFromJournals } from './financials';

/** 회사별로 조회한 화면 입력을 기존 분개·월별 손익 계산에 그대로 전달한다. */
export function buildProfitPeriodProjection({ periodMonths, codeToGroup, ...input }: BuildJournalsInput & {
  periodMonths: string[];
  codeToGroup: Parameters<typeof computeMonthPLFromJournals>[3];
}) {
  const journalEntries = buildJournals(input).entries;
  const monthlyData = periodMonths.map(ym => ({
    month: `${Number(ym.split('-')[1])}월`, ym,
    ...computeMonthPLFromJournals(ym, journalEntries, input.accounts, codeToGroup),
  }));
  return { journalEntries, monthlyData };
}
