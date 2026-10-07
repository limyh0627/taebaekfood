import { collection, doc, getDocs, query, runTransaction, where, type Firestore } from 'firebase/firestore';
import { auth, authReady, db } from '../firebase';
import { cashOpeningBalanceForCurrent, openingCashAccountCode } from '../cashOpening';
import { isCalendarDay, today } from '../day';
import { companyOf, type CashAccount, type CashEntry, type CompanyId, type IssuedStatement } from '../types';

/** 계좌 ID와 연결 전표를 유지하면서 표시 정보와 잔액 기준을 정정한다. */
export async function updateCashAccountOpeningWithDb(store: Firestore, companyId: CompanyId, original: CashAccount, name: string, newDate: string, targetBalance: number, asOf = today()): Promise<void> {
  if (original.companyId !== companyId || !original.id || !name.trim() || !isCalendarDay(newDate) || !isCalendarDay(asOf) || !Number.isSafeInteger(targetBalance)) throw new Error('계좌 회사·이름·기준일·잔액을 확인하세요.');
  const entries = await getDocs(query(collection(store, 'cashEntries'), where('companyId', '==', companyId), where('cashAccountId', '==', original.id)));
  const accountRef = doc(store, 'cashAccounts', original.id);
  const voucherRef = doc(store, 'issuedStatements', `opening-cash-${companyId}-${original.id}`);
  await runTransaction(store, async tx => {
    const [accountSnap, voucherSnap, cashSnaps] = await Promise.all([tx.get(accountRef), tx.get(voucherRef), Promise.all(entries.docs.map(row => tx.get(row.ref)))]);
    const latest = accountSnap.data();
    const fields = ['companyId', 'name', 'type', 'openingDate', 'openingBalance', 'active', 'createdAt'] as const;
    if (!accountSnap.exists() || latest?.companyId !== companyId || fields.some(key => (latest?.[key] ?? '') !== (original[key] ?? ''))) throw new Error('계좌 정보가 변경되었습니다. 다시 열어 저장하세요.');
    const movements = cashSnaps.filter(snap => snap.exists()).map(snap => ({ ...snap.data(), id: snap.id })) as CashEntry[];
    if (movements.some(entry => companyOf(entry) !== companyId || entry.cashAccountId !== original.id)) throw new Error('계좌 연결 전표가 변경되었습니다. 다시 조회하세요.');
    const openingBalance = cashOpeningBalanceForCurrent(original, movements, newDate, targetBalance, asOf);
    let voucherPatch: Record<string, unknown> | undefined;
    if (voucherSnap.exists()) {
      const voucher = voucherSnap.data() as IssuedStatement;
      const date = voucher.tradeDate || voucher.issuedAt?.slice(0, 10);
      const [asset, equity] = voucher.items || [];
      if (original.type === '카드' || voucher.companyId !== companyId || voucher.id !== voucherRef.id || voucher.docNo !== `기초계좌-${original.id}` || voucher.type !== '비용' || voucher.orderId !== '' || !isCalendarDay(date) || voucher.items?.length !== 2 ||
          asset.accountCode !== openingCashAccountCode(original) || equity.accountCode !== '375' || !['차변', '대변'].includes(asset.side || '') || equity.side === asset.side || !['차변', '대변'].includes(equity.side || '') ||
          !Number.isSafeInteger(voucher.totalAmount) || voucher.totalAmount < 0 || voucher.totalSupply !== voucher.totalAmount || voucher.totalTax !== 0 || voucher.items.some(line => line.qty !== 1 || line.tax !== 0 || line.lineKind !== 'account' || line.price !== voucher.totalAmount || line.supply !== voucher.totalAmount || line.total !== voucher.totalAmount)) throw new Error('계좌 기초 전표의 회사·일자·분개를 확인하세요.');
      const signed = cashOpeningBalanceForCurrent(original, movements, date, targetBalance, asOf);
      const amount = Math.abs(signed);
      voucherPatch = { totalSupply: amount, totalTax: 0, totalAmount: amount, items: voucher.items.map((line, index) => ({ ...line, ...(index === 0 ? { name: name.trim() } : {}), side: (index === 0) === (signed >= 0) ? '차변' : '대변', price: amount, supply: amount, total: amount })) };
    }
    tx.update(accountRef, { name: name.trim(), openingDate: newDate, openingBalance });
    if (voucherPatch) tx.update(voucherRef, voucherPatch);
  });
}

export async function updateCashAccountOpening(companyId: CompanyId, original: CashAccount, name: string, newDate: string, targetBalance: number, asOf = today()): Promise<void> {
  await authReady;
  const token = await auth.currentUser?.getIdTokenResult();
  if (token?.claims.companyId !== companyId || token.claims.isAdmin !== true) throw new Error('현재 회사의 관리자만 계좌를 수정할 수 있습니다.');
  return updateCashAccountOpeningWithDb(db, companyId, original, name, newDate, targetBalance, asOf);
}
