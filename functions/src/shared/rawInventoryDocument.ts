import type { RawInventoryState, RawInventoryMovement } from './rawInventoryCore';

/**
 * **옛 원장 화면이 읽는 칸.**
 *
 * 이력 문서(`RawInventoryMovement`)는 `reportedDeltaKg` 처럼 새 이름으로 적는데,
 * 원료수불부·입출고 기록 화면은 아직 `received`/`used`/`note`/`type` 을 읽는다.
 * **같은 문서에 둘 다 담는다** — 이관 중에 화면이 빈칸으로 보이면 안 된다(설계 §2 "이관 기간").
 * 화면들이 새 칸으로 옮겨간 뒤에 이 층을 걷어낸다.
 */
export interface LegacyLedgerFields {
  note?: string;
  type?: 'auto' | 'manual' | 'correction' | 'stocktake_unit';
  addedBy?: string;
  orderId?: string;
  /** 단위 입고 표시용 — 캔 16.5kg × 68개 같은 것 */
  canSize?: number;
  canCount?: number;
  canSizeTag?: string;
  originalAmount?: number;
  originalUnit?: 'kg' | 'L';
}

/** 이력 + 옛 칸을 한 문서로. 저장은 이 모양으로 한다. */
export function toLedgerDoc(m: RawInventoryMovement, legacy: LegacyLedgerFields = {}): Record<string, unknown> {
  //  실사는 잔량을 targetKg 로 다시 잡는 앵커라 입고·사용 합계를 안 건드린다(앱의 실사와 같은 모양).
  const 실사 = m.kind === 'stocktake';
  const d = m.reportedDeltaKg;
  /**
   * **개봉은 입고도 사용도 아니다 — 실사와 같이 합계를 안 건드린다**(2026-09-16).
   *
   * 2026-09-16 사장님: "캔으로 구매해서 입고할 때 이미 입고로 반영되니까 캔 벌크로
   * 까거나 해도 상관없지 않나".
   *
   * **맞다.** 원료수불부는 원료가 창고에 **들어오고 나간 것**을 적는 장부다. 캔에
   * 담겼든 포대에 담겼든 원료는 원료라, 캔으로 사도 입고는 그날 이미 적혔다.
   * 까는 것은 창고 **안에서** 포장만 바꾸는 일이라 원료가 들어오지도 나가지도 않는다 —
   * **총 kg 이 안 변한다.** 입고로 적으면 사지도 않은 것을 산 것이 되고, 사용 음수로
   * 적으면 쓰지도 않은 것을 무른 것이 된다. 어느 쪽이든 관청에 내는 서류가 틀어진다.
   *
   * 그래도 **줄은 남긴다**(0 으로). 누가 언제 몇 캔 깠는지 못 보면 재고가 어긋났을 때
   * 짚을 데가 없다. 실사가 잔량만 다시 잡고 합계를 안 건드리는 것과 같은 모양이다.
   *
   * 안 깐 캔이 몇 개인지는 **포장 현황**(캔 품목 재고)이 들고 있다 — 원료수불부와
   * 다른 장부다. 둘을 더하면 늘 같은 kg 이 나온다.
   */
  const 개봉 = m.source?.type === 'unpack';
  return {
    ...m,
    date: m.effectiveAt.slice(0, 10),
    material: m.materialSnapshot,
    received: (실사 || 개봉) ? 0 : (d > 0 ? d : 0),
    used: (실사 || 개봉) ? 0 : (d < 0 ? -d : 0),
    unit: 'kg',
    ...legacy,
  };
}


/** 4·5단계에서 이미 만든 문서를 새 필드명으로 안전하게 읽는다. DB 직접 수정은 하지 않는다. */
export function normalizeRawInventoryState(data: Record<string, any>): RawInventoryState {
  const legacyDate = typeof data.lastStocktakeDate === 'string' ? data.lastStocktakeDate : undefined;
  const stocktakeAnchor = data.stocktakeAnchor ?? (legacyDate ? {
    // 옛 자료에는 시각이 없었다. 당시 규칙(그 날짜 전체를 실사 전으로 봄)을 보존하고,
    // 새 실사부터 버튼을 누른 정확한 시각으로 교체한다.
    effectiveAt: `${legacyDate}T23:59:59.999+09:00`,
    operationId: String(data.lastStocktakeOperationId ?? `legacy-stocktake:${legacyDate}`),
    sequence: Number(data.version ?? 0),
  } : undefined);
  return {
    id: String(data.id),
    companyId: data.companyId,
    rawItemId: String(data.rawItemId),
    materialSnapshot: String(data.materialSnapshot ?? ''),
    stockKg: Number(data.stockKg ?? 0),
    activeLots: Array.isArray(data.activeLots) ? data.activeLots : [],
    recentDepletedLots: Array.isArray(data.recentDepletedLots) ? data.recentDepletedLots : [],
    ...(stocktakeAnchor ? { stocktakeAnchor } : {}),
    revision: Number(data.revision ?? data.version ?? 0),
    lastProcessedAt: String(data.lastProcessedAt ?? data.updatedAt ?? ''),
  };
}

/** 초기 원자화 이력을 새 코어가 읽을 수 있게 정규화한다. */
export function normalizeRawMovement(data: Record<string, any>): RawInventoryMovement {
  return {
    ...data,
    commandHash: String(data.commandHash ?? ''),
    effectiveAt: String(data.effectiveAt ?? `${data.date ?? '1970-01-01'}T12:00:00+09:00`),
    lotChanges: (Array.isArray(data.lotChanges) ? data.lotChanges : []).map((ch: Record<string, any>) => {
      const afterKg = Number(ch.afterKg ?? ch.kgAfter ?? 0);
      const deltaKg = Number(ch.deltaKg ?? 0);
      return {
        ...ch,
        deltaKg,
        beforeKg: Number(ch.beforeKg ?? afterKg - deltaKg),
        afterKg,
        lotSnapshot: ch.lotSnapshot ?? {
          id: String(ch.lotId), material: String(data.materialSnapshot ?? data.material ?? ''),
          supplierName: String(ch.supplierName ?? '이력 복원'),
          receivedDate: String(ch.receivedDate ?? data.date ?? ''),
          qtyIn: 0, kgIn: Math.max(0, afterKg - deltaKg), kgRemaining: Math.max(0, afterKg - deltaKg),
          status: afterKg - deltaKg > 0 ? 'active' : 'depleted',
          createdAt: String(data.recordedAt ?? data.createdAt ?? ''),
        },
      };
    }),
  } as RawInventoryMovement;
}


const r3 = (value: number) => Math.round(value * 1000) / 1000;

/** 화면용 품목 재고와 원자 상태는 둘 다 0.001kg로 저장한다. 차이가 있으면 정정 없이 덮지 않는다. */
export function rawMirrorMatches(itemStockKg: number, stateStockKg: number): boolean {
  return Number.isFinite(itemStockKg) && Number.isFinite(stateStockKg)
    && r3(itemStockKg) === r3(stateStockKg);
}
