import type * as admin from 'firebase-admin';
import { claimsAfterReturns, PartnerPaymentValidationError, type Claim, type ReturnApplication } from './partnerPaymentPlan';
import { deletedReturnCredits, ReturnClaimProjectionError } from './shared/returnClaimProjection';
type Row = Record<string, any>;
export function projectClaimsAfterReturns(claims: Claim[], applications: (ReturnApplication & Row)[], statements: Row[], operations: Row[]): Claim[] {
  const ids = new Set(claims.map(row => row.id));
  if (applications.every(row => ids.has(row.statementId))) return claimsAfterReturns(claims, applications);
  try { return [...claimsAfterReturns(claims, applications.filter(row => ids.has(row.statementId))),
    ...deletedReturnCredits(claims, applications, statements, operations)]; }
  catch (error) { if (error instanceof ReturnClaimProjectionError) throw new PartnerPaymentValidationError(error.message); throw error; }
}
/** Reads protected RETURN proofs in the same transaction; never changes stored history. */
export async function readClaimsAfterReturns(db: admin.firestore.Firestore, tx: admin.firestore.Transaction,
  claims: Claim[], applications: (ReturnApplication & Row)[], statements: Row[]): Promise<Claim[]> {
  const ids = new Set(claims.map(row => row.id));
  const missing = applications.filter(row => !ids.has(row.statementId));
  if (!missing.length) return claimsAfterReturns(claims, applications);
  const operationIds = [...new Set(missing.map(row => row.operationId))];
  if (operationIds.some(id => typeof id !== 'string' || !id)) throw new PartnerPaymentValidationError('반품 작업 증거가 없습니다.');
  const operations = await Promise.all(operationIds.map(async id => { const snap = await tx.get(db.collection('returnOperations').doc(id)); return { ...snap.data(), id: snap.id }; }));
  return projectClaimsAfterReturns(claims, applications, statements, operations);
}
