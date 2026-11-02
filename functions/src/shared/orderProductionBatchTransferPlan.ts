import { assertClaimPartition, isOpaqueLineId, normalizeBatchIntent } from './orderProductionBatchContract';
import type { BatchAssignment, BatchReference, Claim } from './orderProductionBatchContract';

const fail = (): never => { throw new Error('invalid-input'); };
const cmp = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const validReference = (reference: BatchReference): void => {
  normalizeBatchIntent({version: 1, reference, opening: {version: 1, token: '0'.repeat(64)}, action: 'reverse-production-batch', batchId: 'validation'});
};
const validText = (value: unknown): boolean => typeof value === 'string' && value.length > 0;

/** 이 검사는 원본의 진위나 현재 재고를 증명하지 않는다. */
export function assertTransferAssignment(assignment: BatchAssignment, reference: BatchReference): void {
  validReference(reference);
  if (!assignment || assignment.kind !== 'assignment' || assignment.version !== 1 || assignment.state !== 'active' ||
      assignment.companyId !== reference.companyId || !validText(assignment.batchId) ||
      !Number.isSafeInteger(assignment.revision) || assignment.revision < 0 || assignment.revision >= Number.MAX_SAFE_INTEGER ||
      !validText(assignment.createdAt) || !assignment.source || !validText(assignment.source.ownerUid) || !Array.isArray(assignment.outputs) || !assignment.outputs.length) fail();
  normalizeBatchIntent({version: 1, reference, opening: {version: 1, token: '0'.repeat(64)}, action: 'reverse-production-batch', batchId: assignment.batchId});
  validReference(assignment.source.reference);
  if (assignment.lastTransfer !== null) {
    if (!assignment.lastTransfer || !validText(assignment.lastTransfer.ownerUid) || !validText(assignment.lastTransfer.at)) fail();
    validReference(assignment.lastTransfer.reference);
    if (assignment.lastTransfer.reference.companyId !== reference.companyId) fail();
  }
  if (assignment.source.reference.companyId !== reference.companyId) fail();
  const outputs = new Set<string>();
  for (const output of assignment.outputs) {
    assertClaimPartition(output);
    if (output.claims.some(claim => claim.lastReference.companyId !== reference.companyId)) fail();
    if (output.role === 'customer' && 'order' in output.unit && output.unit.order.kind === 'box-count' &&
        (output.quantityMilli % 1000 !== 0 || output.claims.some(claim => claim.fromMilli % 1000 !== 0 || claim.toMilli % 1000 !== 0))) fail();
    if (outputs.has(output.outputId)) fail();
    outputs.add(output.outputId);
  }
}

export function planBatchAssignmentTransfer(input: {
  reference: BatchReference; ownerUid: string; at: string; sourceOrderId: string; childOrderId: string;
  assignments: readonly BatchAssignment[]; moves: readonly {lineId: string; moveCompletedMilli: number}[];
}): {assignmentsAfter: BatchAssignment[]; transfers: {batchId: string; outputId: string; sourceOrderId: string; sourceLineId: string; childOrderId: string; childLineId: string; fromMilli: number; toMilli: number}[]} {
  const {reference, ownerUid, at, sourceOrderId, childOrderId} = input;
  validReference(reference);
  if (!validText(ownerUid) || !validText(at) || reference.orderId !== sourceOrderId || !validText(childOrderId) || childOrderId === sourceOrderId || !Array.isArray(input.assignments) || !Array.isArray(input.moves)) fail();
  // child ID에도 기존 계약의 문서 ID 검사를 적용한다.
  validReference({...reference, orderId: childOrderId});
  const remaining = new Map<string, number>();
  for (const move of input.moves) {
    if (!isOpaqueLineId(move.lineId) || remaining.has(move.lineId) || !Number.isSafeInteger(move.moveCompletedMilli) || move.moveCompletedMilli < 0 || Object.is(move.moveCompletedMilli, -0)) fail();
    remaining.set(move.lineId, move.moveCompletedMilli);
  }
  const batches = new Set<string>();
  for (const assignment of input.assignments) {
    assertTransferAssignment(assignment, reference);
    if (batches.has(assignment.batchId)) fail();
    batches.add(assignment.batchId);
  }
  const transfers: {batchId: string; outputId: string; sourceOrderId: string; sourceLineId: string; childOrderId: string; childLineId: string; fromMilli: number; toMilli: number}[] = [];
  const assignmentsAfter = [...input.assignments].sort((a,b) => cmp(a.batchId,b.batchId)).map(assignment => {
    let changed = false;
    const outputs = [...assignment.outputs].sort((a,b) => cmp(a.outputId,b.outputId)).map(output => {
      if (output.role === 'stock-only') return output;
      let outputChanged = false;
      const claims: Claim[] = [];
      for (const claim of [...output.claims].sort((a,b) => a.fromMilli-b.fromMilli)) {
        const count = claim.state === 'allocated' && claim.orderId === sourceOrderId ? remaining.get(claim.lineId) ?? 0 : 0;
        if (count && 'order' in output.unit && output.unit.order.kind === 'box-count' && count % 1000 !== 0) fail();
        const amount = Math.min(count, claim.toMilli - claim.fromMilli);
        if (!amount) { claims.push(claim); continue; }
        const end = claim.fromMilli + amount;
        claims.push({...claim, orderId: childOrderId, fromMilli: claim.fromMilli, toMilli: end, lastReference: reference});
        if (end < claim.toMilli) claims.push({...claim, fromMilli: end});
        transfers.push({batchId: assignment.batchId, outputId: output.outputId, sourceOrderId, sourceLineId: claim.lineId, childOrderId, childLineId: claim.lineId, fromMilli: claim.fromMilli, toMilli: end});
        remaining.set(claim.lineId, count - amount);
        outputChanged = changed = true;
      }
      if (!outputChanged) return output;
      const next = {...output, claims};
      assertClaimPartition(next);
      return next;
    });
    return changed ? {...assignment, revision: assignment.revision + 1, outputs, lastTransfer: {reference, ownerUid, at}} : assignment;
  });
  if ([...remaining.values()].some(value => value !== 0)) fail();
  return {assignmentsAfter, transfers};
}


