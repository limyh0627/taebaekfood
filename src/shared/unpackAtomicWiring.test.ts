import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('src/shared/services/unpackService.ts', 'utf8');
const timeline = readFileSync('components/LotTimeline.tsx', 'utf8');

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

  it('벌크 로트 상세 타임라인에서 개봉 이력을 캔 개봉으로 표시한다', () => {
    expect(timeline).toContain("title: unpack ? '캔 개봉'");
    expect(timeline).toContain("source?.type === 'unpack'");
  });

  it('같은 날짜 출고는 타임라인에서 한 행으로 묶고 중복 출고처 영역은 두지 않는다', () => {
    expect(timeline).toContain('const byDate = new Map');
    expect(timeline).toContain("id: `ship-${lotId}-${date}`");
    expect(timeline).toContain('거래처별 상세보기');
    const productPanel = readFileSync('components/ProductLotPanel.tsx', 'utf8');
    expect(productPanel).not.toContain('출고처</div>');
  });
});
