import DateRangeFilter, { type DateRangeQuick } from '../../../shared/components/DateRangeFilter';

export type StatementOrderDateQuick = DateRangeQuick;

export default function StatementOrderDateFilter(props: {
  quick: StatementOrderDateQuick;
  from: string;
  to: string;
  onChange: (from: string, to: string, quick: StatementOrderDateQuick) => void;
}) {
  return (
    <div className="flex w-full min-w-0 max-w-full flex-shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
      <DateRangeFilter {...props} label="주문 조회" />
    </div>
  );
}
