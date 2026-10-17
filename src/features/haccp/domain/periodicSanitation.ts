export const WEEKLY_ITEMS_DEFAULT: { item: string; standard: string }[] = [
  { item: '주간 항목 1', standard: '기준' },
  { item: '주간 항목 2', standard: '기준' },
  { item: '주간 항목 3', standard: '기준' },
  { item: '주간 항목 4', standard: '기준' },
  { item: '주간 항목 5', standard: '기준' },
];

export const MONTHLY_ITEMS_DEFAULT: { item: string; standard: string }[] = [
  { item: '월간 항목 1', standard: '기준' },
  { item: '월간 항목 2', standard: '기준' },
  { item: '월간 항목 3', standard: '기준' },
  { item: '월간 항목 4', standard: '기준' },
  { item: '월간 항목 5', standard: '기준' },
];

export type PeriodCycle = 'weekly' | 'monthly';

export interface PeriodRow {
  result: 'pass' | 'fail' | '';
  note: string;
  inspector: string;
}

export interface PeriodRecord {
  id?: string;
  cycle: PeriodCycle;
  period: string;
  checkZone: string;
  rows: PeriodRow[];
  specialNotes: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  confirmedBy?: string;
  confirmedAt?: string;
}
