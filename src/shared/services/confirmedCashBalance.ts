import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import { auth, authReady, db } from '../firebase';
import { isCalendarDay, today } from '../day';
import { companyOf, type CashAccount, type CompanyId } from '../types';

/** 전표와 기초잔액을 바꾸지 않고 날짜별 실제 잔액 기준을 기록한다. */
export async function saveConfirmedCashBalanceWithDb(store: Firestore, companyId: CompanyId, original: CashAccount, date: string, balance: number, reason: string, recordedAt = new Date().toISOString()): Promise<void> {
  if (!original.id || companyOf(original) !== companyId || !isCalendarDay(date) || date < original.openingDate || date > today() || !Number.isSafeInteger(balance) || typeof reason !== 'string' || !reason.trim() || !Number.isFinite(Date.parse(recordedAt))) throw new Error('계좌 회사·날짜·정수 잔액·사유를 확인하세요.');
  const ref = doc(store, 'cashAccounts', original.id);
  await runTransaction(store, async tx => {
    const snap = await tx.get(ref);
    const latest = snap.data() as CashAccount | undefined;
    if (!snap.exists() || !latest || companyOf(latest) !== companyId || latest.openingDate !== original.openingDate || latest.type !== original.type || latest.active !== true) throw new Error('계좌 정보가 변경되었습니다. 다시 열어 저장하세요.');
    if (latest.confirmedBalances !== undefined && (!Array.isArray(latest.confirmedBalances) || latest.confirmedBalances.some(row => !row || !isCalendarDay(row.date) || !Number.isSafeInteger(row.balance) || typeof row.reason !== 'string' || !row.reason.trim() || typeof row.recordedAt !== 'string' || !Number.isFinite(Date.parse(row.recordedAt))))) throw new Error('기존 확정 잔액 기록을 확인하세요.');
    const confirmedBalances = [...(latest.confirmedBalances ?? []).filter(row => row.date !== date), { date, balance, recordedAt, reason: reason.trim() }].sort((a, b) => a.date.localeCompare(b.date));
    tx.update(ref, { confirmedBalances });
  });
}

export async function saveConfirmedCashBalance(companyId: CompanyId, original: CashAccount, date: string, balance: number, reason: string): Promise<void> {
  await authReady;
  const token = await auth.currentUser?.getIdTokenResult();
  if (token?.claims.companyId !== companyId || token.claims.isAdmin !== true) throw new Error('현재 회사의 관리자만 확정 잔액을 저장할 수 있습니다.');
  return saveConfirmedCashBalanceWithDb(db, companyId, original, date, balance, reason);
}
