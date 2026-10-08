import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import { companyOf, type CompanyId } from '../types';
import { commandHash, type RawInventoryCommand } from '../rawInventoryCore';
import { readRawCommandInTransaction, prepareRawCommand, writePreparedRawCommand, normalizeRawMovement } from './rawInventoryService';

/** 송부 원료의 원래 로트를 복원하고 발주 취소 근거를 같은 거래에 남긴다. */
export async function cancelOemIssue(db: Firestore, companyId: CompanyId, poId: string): Promise<{ status: 'applied' | 'duplicate' }> {
  if (!poId || poId.includes('/')) throw new Error('OEM 발주 번호를 확인해 주세요.');
  const operationId = `oem-cancel:${poId}`;
  const now = new Date().toISOString();
  return runTransaction(db, async tx => {
    const poRef = doc(db, 'purchaseOrders', poId);
    const poSnap = await tx.get(poRef);
    if (!poSnap.exists()) throw new Error('OEM 발주가 없습니다.');
    const po = poSnap.data();
    if (companyOf(po) !== companyId || po.poType !== 'oem') throw new Error('다른 회사이거나 OEM 발주가 아닙니다.');
    const [receipt, fee, statement] = await Promise.all([
      tx.get(doc(db, 'oemReceiptOperations', `oem-receive:${poId}`)),
      tx.get(doc(db, 'adjustmentRequests', `OEMFEE-${poId}`)),
      tx.get(doc(db, 'issuedStatements', `OEMFEE-${poId}`)),
    ]);
    if (po.status !== 'invoiced' || po.oemIssueStatus !== 'complete' || po.receivedAt || po.oemReceiptOperationId || po.linkedStatementId || receipt.exists() || fee.exists() || statement.exists()) {
      throw new Error('입고나 가공비가 처리된 OEM 발주는 취소할 수 없습니다.');
    }
    const cancelled = !!po.oemCancelledAt || !!po.oemCancelOperationId;
    if (cancelled && (po.oemCancelOperationId !== operationId || typeof po.oemCancelledAt !== 'string')) throw new Error('OEM 취소 근거가 다릅니다.');
    const sent: { rawItemId: string; material: string; kg: number }[] = po.oemSent;
    if (!Array.isArray(sent) || !sent.length || new Set(sent.map(row => row?.rawItemId)).size !== sent.length ||
      sent.some(row => !row?.rawItemId || row.rawItemId.includes('/') || !Number.isFinite(row.kg) || row.kg <= 0) || !/^\d{4}-\d{2}-\d{2}$/.test(po.oemIssueDate ?? '')) {
      throw new Error('원료 품목과 원래 차감 근거가 없는 옛 OEM 발주는 확인 후 취소해야 합니다.');
    }
    const commands = sent.map(row => ({ operationId: `${operationId}:${row.rawItemId}`, companyId, rawItemId: row.rawItemId,
      materialSnapshot: row.material, effectiveAt: po.oemCancelledAt || now, source: { type: 'oem' as const, id: poId },
      kind: 'reverse' as const, originalOperationId: `oem-issue:${poId}:${row.rawItemId}` }));
    const reads = await Promise.all(commands.map(command => readRawCommandInTransaction(tx, db, command)));
    const results = reads.map((read, index) => {
      const originalSnap = read.originalSnap?.exists() ? read.originalSnap : read.oldOriginalSnap;
      if (!originalSnap?.exists()) throw new Error('원래 OEM 원료 차감 이력이 없습니다.');
      const original = normalizeRawMovement(originalSnap.data()!);
      const row = sent[index]!;
      const originalCommand: RawInventoryCommand = { operationId: commands[index]!.originalOperationId, companyId, rawItemId: row.rawItemId,
        ...(po.oemIssuedBy ? { actorName: po.oemIssuedBy } : {}),
        materialSnapshot: row.material, effectiveAt: `${po.oemIssueDate}T12:00:00+09:00`, source: { type: 'oem', id: poId }, kind: 'consume', kg: row.kg };
      if (original.kind !== 'consume' || original.commandHash !== commandHash(originalCommand) || original.source?.type !== 'oem' || original.source.id !== poId) throw new Error('원래 OEM 차감 내용이 발주와 다릅니다.');
      if (cancelled) {
        const movementSnap = read.movementSnap.exists() ? read.movementSnap : read.oldMovementSnap;
        const movement = movementSnap?.exists() ? normalizeRawMovement(movementSnap.data()!) : undefined;
        const guard = read.guardSnap?.exists() ? read.guardSnap.data() : undefined;
        const command = commands[index]!;
        if (!movement || movement.commandHash !== commandHash(command) || movement.kind !== 'reverse' || movement.companyId !== companyId ||
          movement.rawItemId !== row.rawItemId || movement.operationId !== command.operationId || movement.reversalOf !== command.originalOperationId ||
          guard?.companyId !== companyId || guard?.rawItemId !== row.rawItemId || guard?.originalOperationId !== command.originalOperationId || guard?.reverseOperationId !== command.operationId) {
          throw new Error('OEM 취소 원료 근거가 불완전합니다.');
        }
      }
      const result = prepareRawCommand(commands[index]!, read, { now });
      if (result.status !== 'applied' && result.status !== 'duplicate') throw new Error(result.status === 'rejected' ? result.message : '같은 OEM 취소 작업번호의 내용이 다릅니다.');
      if (cancelled && (result.status !== 'duplicate' || read.guardSnap?.data()?.reverseOperationId !== commands[index]!.operationId)) throw new Error('OEM 취소 원료 근거가 불완전합니다.');
      if (!cancelled && result.status === 'duplicate') throw new Error('OEM 취소 표시와 원료 이력이 다릅니다.');
      return result;
    });
    if (cancelled) return { status: 'duplicate' as const };
    results.forEach((result, index) => {
      if (result.status === 'applied') writePreparedRawCommand(tx, commands[index]!, reads[index]!, result, { legacy: { type: 'correction', note: 'OEM 발주 취소' } });
    });
    tx.update(poRef, { oemCancelledAt: now, oemCancelOperationId: operationId });
    return { status: 'applied' as const };
  });
}
