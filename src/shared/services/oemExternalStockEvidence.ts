import { doc, getDoc } from 'firebase/firestore';
import { operationDocId, legacyOperationDocId } from '../rawInventoryCore';
import { companyOf, type CompanyId, type PurchaseOrder } from '../types';
import { oemIssueEvidenceKey, projectOemExternalEvidence, type OemExternalRow } from '../../features/admin/oemExternalStock';

/** 조회만 수행한다. PO/job 원문 및 실제 원료 명령 영수증이 없으면 미확인으로 남긴다. */
export async function readOemExternalStockEvidence(companyId: CompanyId, orders: PurchaseOrder[]): Promise<OemExternalRow[]> {
  const { auth, authReady, db } = await import('../firebase');
  await authReady;
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 만료되었습니다.');
  const token = await user.getIdTokenResult();
  const guard = async () => {
    if (auth.currentUser?.uid !== user.uid) throw new Error('조회 중 로그인 계정이 바뀌었습니다.');
    const current = await auth.currentUser.getIdTokenResult();
    if (auth.currentUser?.uid !== user.uid || current.claims.companyId !== companyId || token.claims.companyId !== companyId || !current.claims.employeeId)
      throw new Error('조회 중 회사 또는 직원 권한이 바뀌었습니다.');
  };
  await guard();
  const own = orders.filter(po => po.poType === 'oem' && companyOf(po) === companyId);
  const ambiguous = new Set(own.filter(po => own.some(other => other.id === po.id && oemIssueEvidenceKey(other) !== oemIssueEvidenceKey(po))).map(po => po.id));
  const read = async (collection: string, id: string) => {
    const snapshot = await getDoc(doc(db, collection, id)); await guard();
    return snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : null;
  };
  const movement = async (operationId: string) => {
    const current = await read('rawMaterialLedger', operationDocId(operationId));
    const legacyId = legacyOperationDocId(operationId);
    const legacy = legacyId === operationDocId(operationId) ? null : await read('rawMaterialLedger', legacyId);
    // 같은 명령의 이중 문서는 어느 하나를 임의 선택하지 않는다.
    return current && legacy ? null : current ?? legacy;
  };
  const results: OemExternalRow[] = [];
  for (const po of own.filter((po, index) => own.findIndex(other => other.id === po.id) === index)) {
    if (ambiguous.has(po.id) || !po.id || po.id.includes('/')) { results.push({ ...projectOemExternalEvidence(po, companyId), reason: '같은 배치 ID의 원문이 중복되어 미확인입니다.' }); continue; }
    const currentPo = await read('purchaseOrders', po.id);
    const job = await read('rawInventoryJobs', `oem-issue:${po.id}`);
    const receipts: Record<string, any> = {}, reversals: Record<string, any> = {}, guards: Record<string, any> = {};
    for (const row of Array.isArray(po.oemSent) ? po.oemSent : []) {
      if (!row || typeof row.rawItemId !== 'string' || !row.rawItemId || row.rawItemId.includes('/')) continue;
      const operationId = `oem-issue:${po.id}:${row.rawItemId}`;
      receipts[operationId] = await movement(operationId);
      guards[operationId] = await read('rawInventoryReversalGuards', operationDocId(operationId));
      if (guards[operationId] || po.oemCancelledAt || po.oemCancelOperationId) reversals[operationId] = await movement(`oem-cancel:${po.id}:${row.rawItemId}`);
    }
    results.push(projectOemExternalEvidence(po, companyId, { po: currentPo as PurchaseOrder | null, job, receipts, reversals, guards }));
  }
  await guard();
  return results;
}
