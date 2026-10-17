import type {PeriodRow} from './periodicSanitation';

export const CLOSING_ITEMS_DEFAULT: { item: string; standard: string }[] = [
  { item: '마감 항목 1', standard: '기준' },
  { item: '마감 항목 2', standard: '기준' },
  { item: '마감 항목 3', standard: '기준' },
  { item: '마감 항목 4', standard: '기준' },
  { item: '마감 항목 5', standard: '기준' },
];

export interface ClosingRecord {
  id?: string;
  checkDate: string;
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
