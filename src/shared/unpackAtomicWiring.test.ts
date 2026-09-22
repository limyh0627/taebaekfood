import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('src/shared/services/unpackService.ts', 'utf8');

describe('캔 개봉 원자화 연결', () => {
  it('캔·벌크·원자화 상태·원장 이력을 같은 트랜잭션에서 쓴다', () => {
    expect(src).toContain('runTransaction(db');
    expect(src).toContain('COL.rawInventories');
    expect(src).toContain('COL.rawMaterialLedger');
    expect(src).toContain('tx.update(canRef');
    expect(src).toContain('tx.update(bulkRef');
    expect(src).toContain('tx.set(stateRef');
    expect(src).toContain('tx.set(movementRef');
  });

  it('벌크 계산은 items.lots가 아니라 원자화 상태의 활성 로트를 기준으로 한다', () => {
    expect(src).toContain('withCarryOverLot(state.activeLots, state.stockKg');
    expect(src).not.toContain('withCarryOverLot(\n        (bulkData.lots ?? [])');
  });

  it('기존 원장 작업번호가 있으면 개봉을 다시 적용하지 않는다', () => {
    expect(src).toContain('if (movementSnap.exists())');
    expect(src).toContain('movementSnap.data().unpackMoves');
  });
});
