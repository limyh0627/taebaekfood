const fallback = '재고 작업의 완료 여부를 확인하지 못했습니다. 같은 작업의 처리 결과를 확인해 주세요.';
const reasons: Record<string, string> = {
  COMPLETION_RECEIPT_PRESENT: '완료된 재고 작업 기록이 있어 잠금을 해제할 수 없습니다.',
  COMPLETION_RECEIPT_MISMATCH: '완료 기록과 현재 작업의 근거가 달라 확인이 필요합니다.',
  RECOVERY_RECEIPT_MISMATCH: '잠금 해제 기록과 현재 작업의 근거가 달라 확인이 필요합니다.',
  RECOVERY_STATE_MISMATCH: '잠금 해제 기록과 현재 잠금 상태가 달라 확인이 필요합니다.',
  OPERATION_GENERATION_CHANGED: '실패 작업이 새 작업으로 바뀌었습니다. 현재 작업을 다시 확인해 주세요.',
  OPERATION_CHANGED: '재고 작업이 변경되었습니다. 현재 작업을 다시 확인해 주세요.',
  OPERATION_NOT_FAILED: '현재 작업은 실패 상태가 아닙니다. 처리 결과를 다시 확인해 주세요.',
  ORDER_NOT_FOUND: '주문을 찾을 수 없습니다. 보존된 처리 기록을 확인해 주세요.',
  ORDER_EVIDENCE_INVALID: '주문의 재고 작업 근거를 확인할 수 없습니다.',
  LEGACY_OPERATION_UNPROVEN: '이 작업의 재고 반영 여부를 확인할 수 없어 잠금을 유지합니다.',
  APPROVAL_EVIDENCE_CHANGED: '확인했던 주문 내용이 변경되었습니다. 현재 작업을 다시 확인해 주세요.',
  ORDER_STATUS_CHANGED: '주문 상태가 변경되었습니다. 현재 작업을 다시 확인해 주세요.',
};

/** 표시만 변환한다. 저장된 오류 원문이나 복구 가능 여부를 바꾸지 않는다. */
export function orderInventoryErrorMessage(error: unknown): string {
  const source = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  const text = source.trim();
  if (reasons[text]) return reasons[text];
  // SDK·스택·내부 문서 경로는 업무 화면에 노출하지 않는다.
  if (/Firestore|FirebaseError|Transaction\.(?:set|update)|Nested arrays|invalid data|(?:rawInventoryJobs|rawMaterialLedger|rawInventories)\//i.test(text)
    || /(?:^|\n)\s*at\s+\S+|https?:\/\/|[A-Z]:[\\/]/i.test(text)) return fallback;
  return /[가-힣]/.test(text) ? text : fallback;
}
