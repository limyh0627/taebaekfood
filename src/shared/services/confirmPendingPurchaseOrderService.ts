import { doc, runTransaction } from 'firebase/firestore';
import { auth, authReady, db } from '../firebase';
import { companyOf, type CompanyId, type PurchaseOrder } from '../types';

// 확정 시각은 재시도로 바뀌면 안 되고, 상태 외 업무 원문이 달라졌다면 새 확인이 필요하다.
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value instanceof Date ? { dateISO: value.toISOString() }
  : value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function' ? { timestampMillis: value.toMillis() }
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])) : value;
function businessSnapshot(po: PurchaseOrder): string {
  const { id: _id, status: _status, invoicedAt: _at, ...business } = po;
  return JSON.stringify(canonical(business));
}
export type PendingPurchaseOrderConfirmation = { status: 'confirmed' | 'already-confirmed'; poId: string; invoicedAt: string };

/** 일반 발주 확정만 한다. OEM 원료 출고와 입고 재고 처리는 각각 기존 명령을 사용한다. */
export async function confirmPendingPurchaseOrder(companyId: CompanyId, expected: PurchaseOrder): Promise<PendingPurchaseOrderConfirmation> {
  // 호출 이후 입력 객체가 바뀌어도 승인 당시 원문으로만 판정한다.
  if (!expected || !/^[A-Za-z0-9_-]{1,140}$/.test(expected.id) || companyOf(expected) !== companyId
    || expected.status !== 'pending' || expected.poType === 'oem') throw new Error('현재 회사의 일반 발주예정 원문을 확인해주세요.');
  const poId = expected.id, snapshot = businessSnapshot(expected);
  await authReady;
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 필요합니다.');
  const check = async () => {
    if (auth.currentUser?.uid !== user.uid) throw new Error('로그인 사용자가 바뀌었습니다.');
    const { claims } = await user.getIdTokenResult();
    if (auth.currentUser?.uid !== user.uid) throw new Error('로그인 사용자가 바뀌었습니다.');
    if (claims.companyId !== companyId || !claims.employeeId)
      throw new Error('현재 회사 직원 권한을 확인해주세요.');
  };
  await check();
  const invoicedAt = new Date().toISOString();
  const result = await runTransaction(db, async tx => {
    await check();
    const ref = doc(db, 'purchaseOrders', poId), saved = await tx.get(ref);
    if (!saved.exists()) throw new Error('발주가 없거나 이미 삭제됐습니다.');
    const current = { ...saved.data(), id: saved.id } as PurchaseOrder;
    if (companyOf(current) !== companyId || current.poType === 'oem') throw new Error('현재 회사의 일반 발주만 확정할 수 있습니다.');
    if (current.status !== 'pending' && current.status !== 'invoiced') throw new Error('발주가 이미 입고되거나 취소됐습니다. 새로 확인해주세요.');
    if (businessSnapshot(current) !== snapshot) throw new Error('발주 내용이 변경됐습니다. 새로 확인해주세요.');
    await check();
    if (current.status === 'invoiced') {
      if (!current.invoicedAt) throw new Error('기존 발주확정 시각을 확인해주세요.');
      return { status: 'already-confirmed' as const, poId, invoicedAt: current.invoicedAt };
    }
    tx.update(ref, { status: 'invoiced', invoicedAt });
    return { status: 'confirmed' as const, poId, invoicedAt };
  });
  await check();
  return result;
}
