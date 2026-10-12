import {describe,expect,it} from 'vitest';
import {orderInventoryErrorMessage} from './orderInventoryError';
describe('주문 재고 오류 표시',()=>{
 it.each(['Firestore Function Transaction.set() called with invalid data. Nested arrays are not supported (found rawInventoryJobs/order-raw-batch-123)', '원료 차감 실패\n at save (https://example.invalid/app.js:12)', 'rawMaterialLedger/private-id', 'UNKNOWN_INTERNAL_ERROR', undefined])('기술 오류와 알 수 없는 내부 값은 한국어로 표시한다',value=>{const result=orderInventoryErrorMessage(value);expect(result).toMatch(/처리 결과를 확인/);expect(result).not.toMatch(/Firestore|rawInventory|private-id|UNKNOWN|https:/);});
 it('한국어 업무 사유는 원문을 보존한다',()=>{const message='들깨 재고가 부족합니다. 현재 0kg, 필요 20kg';expect(orderInventoryErrorMessage(Error(message))).toBe(message);});
 it.each(['OPERATION_GENERATION_CHANGED','LEGACY_OPERATION_UNPROVEN','COMPLETION_RECEIPT_PRESENT','ORDER_STATUS_CHANGED'])('복구 사유 %s는 내부 코드를 표시하지 않는다',reason=>{expect(orderInventoryErrorMessage(reason)).toMatch(/[가-힣]/);expect(orderInventoryErrorMessage(reason)).not.toContain(reason);});
});
