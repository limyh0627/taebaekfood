import DateRangeFilter, { type DateRangeQuick } from '../../../shared/components/DateRangeFilter';

export type StatementOrderDateQuick = DateRangeQuick;

export default function StatementOrderDateFilter(props: {
  quick: StatementOrderDateQuick;
  from: string;
  to: string;
  onChange: (from: string, to: string, quick: StatementOrderDateQuick) => void;
}) {
  return (
    <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-5 py-2.5">
      <DateRangeFilter {...props} label="주문 조회" />
    </div>
  );
}
