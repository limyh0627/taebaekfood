const r3 = (value: number) => Math.round(value * 1000) / 1000;

/** 화면용 품목 재고와 원자 상태는 둘 다 0.001kg로 저장한다. 차이가 있으면 정정 없이 덮지 않는다. */
export function rawMirrorMatches(itemStockKg: number, stateStockKg: number): boolean {
  return Number.isFinite(itemStockKg) && Number.isFinite(stateStockKg)
    && r3(itemStockKg) === r3(stateStockKg);
}
