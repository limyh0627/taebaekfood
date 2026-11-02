import { assertClaimPartition } from './orderProductionBatchContract';
import type { BatchAssignment, BatchOutput, BatchReference } from './orderProductionBatchContract';
import { assertTransferAssignment } from './orderProductionBatchTransferPlan';

export function planBatchAssignmentReversal(input: {reference: BatchReference; ownerUid: string; at: string; assignment: BatchAssignment}): {
  assignmentAfter: BatchAssignment;
  allocationReleases: {orderId: string; lineId: string; outputId: string; fromMilli: number; toMilli: number}[];
  requiredOutputReversals: {outputId: string; role: BatchOutput['role']; itemId: string; productionEvidence: BatchOutput['productionEvidence']}[];
} {
  const {reference, ownerUid, at, assignment} = input;
  assertTransferAssignment(assignment, reference);
  if (reference.orderId !== assignment.source.reference.orderId || typeof ownerUid !== 'string' || !ownerUid || typeof at !== 'string' || !at) throw new Error('invalid-input');
  const allocationReleases: {orderId: string; lineId: string; outputId: string; fromMilli: number; toMilli: number}[] = [];
  const requiredOutputReversals: {outputId: string; role: BatchOutput['role']; itemId: string; productionEvidence: BatchOutput['productionEvidence']}[] = [];
  const outputs = [...assignment.outputs].sort((a,b) => a.outputId < b.outputId ? -1 : a.outputId > b.outputId ? 1 : 0).map(output => {
    requiredOutputReversals.push({outputId: output.outputId, role: output.role, itemId: output.itemId, productionEvidence: output.productionEvidence});
    const claims = [...output.claims].sort((a,b) => a.fromMilli-b.fromMilli).map(claim => {
      if (claim.state === 'shipped' || claim.state === 'reversed') throw new Error('invalid-input');
      if (claim.state === 'allocated') allocationReleases.push({orderId: claim.orderId, lineId: claim.lineId, outputId: output.outputId, fromMilli: claim.fromMilli, toMilli: claim.toMilli});
      return {...claim, state: 'reversed' as const, lastReference: reference};
    });
    const next = {...output, claims};
    assertClaimPartition(next);
    return next;
  });
  return {assignmentAfter: {...assignment, state: 'reversed', revision: assignment.revision + 1, outputs, lastTransfer: {reference, ownerUid, at}}, allocationReleases, requiredOutputReversals};
}

