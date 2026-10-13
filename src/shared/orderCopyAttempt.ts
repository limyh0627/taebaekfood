import { canonicalOrderInterpretation, sameOrderInterpretationRequest, validateOrderInterpretation,
  type OrderInterpretationRequest, type OrderInterpretationScope } from './orderInterpretation';

export class OrderCopyAttemptConflictError extends Error {}
const conflict = (): never => { throw new OrderCopyAttemptConflictError('기존 최초 주문 요청이 다르거나 손상되었습니다. 원문을 보존해 주세요.'); };

export function encodeOrderCopyAttempt(request: unknown, scope: OrderInterpretationScope): string {
  return canonicalOrderInterpretation(request, scope);
}
export function decodeOrderCopyAttempt(encoded: string, scope: OrderInterpretationScope): OrderInterpretationRequest {
  if (typeof encoded !== 'string') conflict();
  let value: unknown;
  try { value = JSON.parse(encoded); } catch { return conflict(); }
  return validateOrderInterpretation(value, scope);
}
/** 저장소 접근과 ID·시각 생성은 호출자가 맡으며 기존 최초 문자열은 다시 쓰지 않는다. */
export function prepareOrderCopyAttempt(existingEncoded: string | null, request: unknown, scope: OrderInterpretationScope): string {
  const next = validateOrderInterpretation(request, scope);
  if (existingEncoded === null) return encodeOrderCopyAttempt(next, scope);
  try {
    if (sameOrderInterpretationRequest(decodeOrderCopyAttempt(existingEncoded, scope), next, scope)) return existingEncoded;
  } catch { return conflict(); }
  return conflict();
}
/** 확정 응답이 승인한 바로 그 문자열만 지울 수 있다. 판독 동치만으로 다른 사본을 지우지 않는다. */
export function clearOrderCopyAttempt(currentEncoded: string | null, expectedEncoded: string): null {
  if (typeof currentEncoded !== 'string' || typeof expectedEncoded !== 'string' || currentEncoded !== expectedEncoded) conflict();
  return null;
}
