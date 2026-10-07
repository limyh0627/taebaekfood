import { doc, getDoc } from 'firebase/firestore';
import { authReady, db } from '../firebase';
import type { CashEntry } from '../types';
import { loanCashInput } from './loanCashAdapter';
import { recordLoanMovement } from './recordLoanMovement';

/** AdminApp 공통 addCashEntry의 loanId 분기에서만 사용한다. */
export async function recordLoanCashEntry(companyId: string, entry: CashEntry) {
  await authReady;
  if (!entry.loanId || entry.loanId.includes('/')) throw new Error('대출 계약 ID를 확인하세요.');
  const snapshot = await getDoc(doc(db, 'loanContracts', entry.loanId));
  const contract = snapshot.data();
  if (!snapshot.exists() || !contract || typeof contract.accountCode !== 'string') throw new Error('대출 계약을 찾을 수 없습니다.');
  return recordLoanMovement(companyId, loanCashInput(companyId, entry, {
    id: snapshot.id, companyId: contract.companyId, accountCode: contract.accountCode,
  }));
}
