import { doc, getDocFromServer, snapshotEqual } from 'firebase/firestore';
import { operationDocId, legacyOperationDocId } from '../rawInventoryCore';
import { companyOf, type CompanyId, type PurchaseOrder } from '../types';
import { projectOemExternalEvidence, type OemExternalRow, type OemExternalEvidence } from '../../features/admin/oemExternalStock';

import { diagnoseOemExternalCost, type OemExternalCostDiagnostic } from '../../features/admin/oemExternalCostDiagnostic';
export interface OemExternalStockEvidenceRow extends OemExternalRow { costDiagnostic: OemExternalCostDiagnostic }
function canonical(value: any): any { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') { if (typeof value.toJSON === 'function') return canonical(value.toJSON()); return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); } return value; }
const fullText = (value: unknown) => JSON.stringify(canonical(value));

/** 조회만 수행한다. PO/job 원문 및 실제 원료 명령 영수증이 없으면 미확인으로 남긴다. */
export async function readOemExternalStockEvidence(companyId: CompanyId, orders: PurchaseOrder[]): Promise<OemExternalStockEvidenceRow[]> {
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
  const ambiguous = new Set(own.filter(po => own.some(other => other.id === po.id && fullText(other) !== fullText(po))).map(po => po.id));
  const read = async (collection: string, id: string) => {
    const snapshot = await getDocFromServer(doc(db, collection, id)); await guard();
    if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) throw new Error('서버에서 확인한 원문이 아닙니다. 온라인 상태에서 다시 조회하세요.');
    return snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : null;
  };
  const movement = async (operationId: string) => {
    const current = await read('rawMaterialLedger', operationDocId(operationId));
    const legacyId = legacyOperationDocId(operationId);
    const legacy = legacyId === operationDocId(operationId) ? null : await read('rawMaterialLedger', legacyId);
    // 같은 명령의 이중 문서는 어느 하나를 임의 선택하지 않는다.
    return current && legacy ? null : current ?? legacy;
  };
  const results: OemExternalStockEvidenceRow[] = [];
  for (const po of own.filter((po, index) => own.findIndex(other => other.id === po.id) === index)) {
    if (ambiguous.has(po.id) || !po.id || po.id.includes('/')) { results.push({ ...projectOemExternalEvidence(po, companyId), reason: '같은 배치 ID의 원문이 중복되어 미확인입니다.', costDiagnostic: diagnoseOemExternalCost(po, companyId) }); continue; }
    const firstPo = await getDocFromServer(doc(db, 'purchaseOrders', po.id)); await guard();
    if (firstPo.metadata.fromCache || firstPo.metadata.hasPendingWrites) throw new Error('서버 발주 원문을 확인하지 못했습니다. 온라인 상태에서 다시 조회하세요.');
    const currentPo = firstPo.exists() ? { ...firstPo.data(), id: firstPo.id } as PurchaseOrder : null;
    const job = await read('rawInventoryJobs', `oem-issue:${po.id}`);
    const receipts: Record<string, any> = {}, reversals: Record<string, any> = {}, guards: Record<string, any> = {};
    for (const row of Array.isArray(po.oemSent) ? po.oemSent : []) {
      if (!row || typeof row.rawItemId !== 'string' || !row.rawItemId || row.rawItemId.includes('/')) continue;
      const operationId = `oem-issue:${po.id}:${row.rawItemId}`;
      receipts[operationId] = await movement(operationId);
      guards[operationId] = await read('rawInventoryReversalGuards', operationDocId(operationId));
      if (guards[operationId] || po.oemCancelledAt || po.oemCancelOperationId) reversals[operationId] = await movement(`oem-cancel:${po.id}:${row.rawItemId}`);
    }
    const lastPo = await getDocFromServer(doc(db, 'purchaseOrders', po.id)); await guard();
    // 공개 SDK 비교는 현재 원문 동치만 확인한다. 중간 변경 후 복원과 근거 전체의 원자적 시점은 증명하지 않는다.
    const stable = !lastPo.metadata.fromCache && !lastPo.metadata.hasPendingWrites && snapshotEqual(firstPo, lastPo) && fullText(po) === fullText(currentPo);
    const evidence: OemExternalEvidence = { po: currentPo, job, receipts, reversals, guards };
    const row = projectOemExternalEvidence(po, companyId, evidence);
    const costDiagnostic = stable ? diagnoseOemExternalCost(po, companyId, evidence) : { poId: po.id, classification: 'unconfirmed' as const, reason: 'cost-snapshot-mismatch' as const, sourceState: row.state, currentOnly: true as const, assetValuationConfirmed: false as const };
    results.push({ ...row, costDiagnostic });
  }
  await guard();
  return results;
}
