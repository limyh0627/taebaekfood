import { describe, expect, it } from 'vitest';
import { operationDocId } from '../../shared/rawInventoryCore';
import { rawLedgerDocIds } from './orderRawInventory';

describe('rawLedgerDocIds', () => {
  it('재개된 옛 원장은 계산 ID가 아니라 실제 저장 문서 ID를 남긴다', () => {
    const operationId = 'production:order-1:line-1:a1:raw-1';
    expect(rawLedgerDocIds([{
      material: '볶음참깨', rawItemId: 'raw-1', operationId,
      ledgerId: 'rm-auto-order-1-raw-1', supplierName: '거래처', kg: 10,
    }])).toEqual(['rm-auto-order-1-raw-1']);
  });

  it('옛 trace에는 현재 계산 ID를 사용한다', () => {
    const operationId = 'production:order-1:line-1:a1:raw-1';
    expect(rawLedgerDocIds([{
      material: '볶음참깨', rawItemId: 'raw-1', operationId,
      supplierName: '거래처', kg: 10,
    }])).toEqual([operationDocId(operationId)]);
  });
});
