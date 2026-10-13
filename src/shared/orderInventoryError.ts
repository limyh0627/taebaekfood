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

const recoveryChecks: Record<string, readonly string[]> = {
  COMPLETION_RECEIPT_PRESENT: ['주문 작업 이력에서 완료된 작업과 현재 주문 상태를 확인해 주세요.', '이미 완료된 작업을 다시 실행하지 말고, 필요한 출고 취소·삭제는 현재 주문에서 별도로 확인해 주세요.'],
  COMPLETION_RECEIPT_MISMATCH: ['주문 작업 이력의 완료 작업과 실패한 작업의 시각·처리 내용을 비교해 주세요.', '서로 다른 기록이 남아 있으면 담당자에게 해당 주문과 두 작업의 처리 내역을 확인해 주세요.'],
  RECOVERY_RECEIPT_MISMATCH: ['이전에 잠금을 해제한 기록과 현재 실패 작업의 시각·내용을 확인해 주세요.', '다른 작업의 해제 기록으로 현재 잠금을 풀지 않습니다.'],
  RECOVERY_STATE_MISMATCH: ['잠금 해제 기록과 현재 주문의 작업 상태를 다시 확인해 주세요.', '다른 창에서 같은 주문을 처리 중인지 확인한 뒤 다시 조회해 주세요.'],
  OPERATION_GENERATION_CHANGED: ['현재 주문에 새로 시작된 작업과 그 시작 시각을 확인해 주세요.', '이전 실패 작업의 확인 결과로 새 작업의 잠금을 해제하지 않습니다.'],
  OPERATION_CHANGED: ['현재 주문의 작업 이력에서 처리 중이거나 새로 시작된 작업을 확인해 주세요.'],
  OPERATION_NOT_FAILED: ['현재 주문이 처리 중인지, 이미 완료됐는지 작업 이력에서 확인해 주세요.'],
  ORDER_NOT_FOUND: ['주문 목록의 회사·검색 조건과 보존된 실패 요청의 주문을 확인해 주세요.', '주문 삭제 여부는 작업 이력이나 담당자에게 확인하며, 조회되지 않았다는 이유만으로 재고 미반영을 확정하지 않습니다.'],
  ORDER_EVIDENCE_INVALID: ['주문 품목·수량과 당시 출고·생산·원료 사용 기록을 확인해 주세요.', '누락되거나 서로 다른 기록이 있으면 담당자에게 실제 처리 내용을 확인해 주세요.'],
  LEGACY_OPERATION_UNPROVEN: ['당시 주문의 생산·출고 이력, 원료 사용 기록과 실제 처리 여부를 담당자에게 확인해 주세요.', '재고가 늘거나 줄지 않았는지 확인할 근거가 필요합니다. 기록이 없다는 이유만으로 잠금을 해제하지 않습니다.'],
  APPROVAL_EVIDENCE_CHANGED: ['확인 이후 바뀐 주문 품목·수량·출고 정보를 확인한 뒤 다시 조회해 주세요.'],
  ORDER_STATUS_CHANGED: ['현재 주문 상태와 다른 창의 처리 여부를 확인한 뒤 다시 조회해 주세요.'],
};

/** 확인 항목은 안내이며, 사용자의 확인만으로 서버 잠금 해제 조건을 대신하지 않는다. */
export function orderInventoryRecoveryChecks(reason: unknown): readonly string[] {
  return typeof reason === 'string' && recoveryChecks[reason] ? recoveryChecks[reason]
    : ['현재 주문 상태와 작업 이력, 당시 생산·출고·원료 사용 기록을 확인해 주세요.', '로그인 회사와 연결 상태를 확인한 뒤 같은 실패 작업을 다시 조회해 주세요. 결과가 미확정이면 원문과 잠금을 유지합니다.'];
}

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
