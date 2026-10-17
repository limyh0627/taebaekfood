export type SlotTime = '08:30' | '15:00';

export interface SanitationRow {
  result: 'pass' | 'fail' | '';
  note: string;
  inspector: string;
}

export interface SanitationRecord {
  id?: string;
  checkDate: string;
  checkZone: string;
  checkTime: SlotTime;
  rows: SanitationRow[];
  specialNotes: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  revisionCount: number;
  confirmedBy?: string;
  confirmedAt?: string;
}
