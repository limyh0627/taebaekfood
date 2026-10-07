import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';

/** One server-owned switch shared by all financial and inventory writers at cutover. */
export const releaseGateRef = (db: admin.firestore.Firestore) => db.collection('appMeta').doc('releaseCutover');

export function assertReleaseActive(snapshot: admin.firestore.DocumentSnapshot, releaseId: string): void {
  const gate = snapshot.data();
  if (!releaseId || !snapshot.exists || gate?.status !== 'active' || gate?.releaseId !== releaseId)
    throw new HttpsError('failed-precondition', '배포 전환이 활성화되지 않았습니다.');
}

export function assertVoucherDateAllowed(snapshot: admin.firestore.DocumentSnapshot, companyId: string, date: string,
  allowCatchUp = false): 'normal' | 'catchUp' {
  const gate = snapshot.data();
  const notBefore = gate?.voucherNotBefore?.[companyId];
  const valid = (value: unknown): value is string => typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(notBefore) || !valid(date) || (companyId === 'taebaek' && notBefore < '2026-10-03'))
    throw new HttpsError('failed-precondition', '전표 발행 가능일이 준비되지 않았거나 전표일이 전환일보다 빠릅니다.');
  const catchUp = gate?.catchUp;
  if (companyId === 'taebaek' && date < notBefore) {
    const inWindow = catchUp?.tradeDate === date && date === '2026-09-30'
      || catchUp?.fromDate === '2026-09-30' && date >= catchUp.fromDate;
    if (allowCatchUp && inWindow && catchUp?.companyId === companyId && catchUp?.status === 'open')
      return 'catchUp';
    if (date === '2026-09-30')
      throw new HttpsError('failed-precondition', '추가 발행 창이 열려 있지 않거나 이 전표 종류에서 사용할 수 없습니다.');
  }
  if (date < notBefore)
    throw new HttpsError('failed-precondition', '전표 발행 가능일이 준비되지 않았거나 전표일이 전환일보다 빠릅니다.');
  return 'normal';
}
