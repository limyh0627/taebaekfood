/**
 * **원료 재고 코어 — 순수 계산부.**
 *
 * 설계: [원료실제원장-로트-원자화-설계.md](../../docs/원료실제원장-로트-원자화-설계.md)
 *
 * 지금 앱은 로트와 실제 원장(`rawMaterialLedger`)을 **따로** 쓴다. 한쪽만 성공하면 그대로
 * 갈리고, 재시도하면 새 id 로 로트가 한 번 더 움직인다. 2026-09-09 조사에서 원료 홀더 18개 중
 * **7개가 갈려 있었다(절대값 합 2,719kg)** — 풍회 깨분은 원장 2,000kg 에 로트 0kg 이었다.
 *
 * 쓰는 순서를 바꾸는 걸로는 못 막는다. 둘을 **한 트랜잭션**에 넣고, 같은 작업 id 는 한 번만
 * 먹게 해야 한다. 이 파일은 그 트랜잭션 안에서 돌 **계산만** 맡는다 —
 * Firestore 도, 시각도, 난수도 여기 없다(§6: 콜백은 경합하면 여러 번 돈다).
 *
 * 쓰기(트랜잭션)는 이 계산기를 부르는 쪽이 맡는다.
 */
import type { CompanyId, RawMaterialLot } from './types';
import { buildReceiveLot, deductFromLots, settleCarryOver, nextLotNo } from './lotUtils';

const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ─────────────────────────────────────────────────────────────────────────────
//  상태 · 이력
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 한 회사·한 원료의 **현재 상태**. `rawInventories/{companyId}__{rawItemId}`.
 *
 * 이 문서가 그 원료의 유일한 근거다. 재고를 `items.stock` 에도 복제하지 않는다 —
 * 두 곳에 있으면 어느 쪽이 진짜인지 다시 갈린다(§2).
 *
 * 등식: `stockKg === activeLots 의 kgRemaining 합`. 계산기가 늘 다시 세워 지킨다.
 */
export interface RawInventoryState {
  id: string;
  companyId: CompanyId;
  rawItemId: string;
  /** 표시용 스냅샷. **대상을 찾는 열쇠로 쓰지 않는다** — 이름으로 홀더를 고르다 남의 회사 로트를 깎았다. */
  materialSnapshot: string;
  stockKg: number;
  activeLots: RawMaterialLot[];
  /** 소진된 로트를 보존기간 동안만 남긴다. FIFO 에는 끼지 않는다. */
  recentDepletedLots: RawMaterialLot[];
  lastStocktakeDate?: string;
  lastStocktakeOperationId?: string;
  /** 원료별 적용 순번. 트랜잭션마다 +1 하고 그 값을 이력의 `sequence` 에 넣는다. */
  version: number;
  updatedAt: string;
}

/** 어느 로트에서 얼마가 움직였나 — 되돌릴 때 이대로 복원한다. */
export interface LotChange {
  lotId: string;
  supplierName?: string;
  lotNo?: string;
  receivedDate?: string;
  /** 입고 +, 사용 −. */
  deltaKg: number;
  kgAfter: number;
}

export type RawMovementKind = 'receive' | 'consume' | 'stocktake' | 'delete-lot' | 'reverse' | 'opening';

/**
 * **변경 이력이자 중복 방지 표다.** `rawMaterialLedger/{operationId}`.
 *
 * 별도 완료표를 두면 완료표와 원장이 또 갈린다. 이 문서가 있으면 그 작업은 이미 먹은 것이다.
 * 이력은 고치거나 지우지 않는다 — 오입력은 `reverse` 를 새로 쌓아 되돌린다(§9).
 */
export interface RawInventoryMovement {
  id: string;
  operationId: string;
  companyId: CompanyId;
  rawItemId: string;
  materialSnapshot: string;
  /** 실제 업무일. 기간별 보고서가 보는 날짜. */
  effectiveDate: string;
  /** 저장 시각. */
  recordedAt: string;
  /** 상태 version 과 같은 적용 순번. **잔량은 날짜가 아니라 이 순서로 센다.** */
  sequence: number;
  kind: RawMovementKind;
  /** 업무 기록 수량: 입고 +, 사용 −. 소급 입력이면 이 값만 남고 재고는 안 움직인다. */
  reportedDeltaKg: number;
  /** 이번에 현재 상태를 **실제로** 움직인 수량. */
  appliedDeltaKg: number;
  balanceAfterKg: number;
  targetKg?: number;
  lotChanges: LotChange[];
  source: { type: string; id: string };
  reversalOf?: string;
  /** 마지막 실사보다 앞선 날짜라 재고를 안 움직였다(§10). */
  backdatedBeforeStocktake?: boolean;
  actorId?: string;
  actorName?: string;
}

/** 여러 원료가 차례로 처리되는 작업의 진행 상태. `rawInventoryJobs/{jobId}` (§8). */
export interface RawInventoryJob {
  id: string;
  companyId: CompanyId;
  source: { type: 'production' | 'production-reversal' | 'oem'; id: string };
  /** 완료 여부는 `status` 가 아니라 **이 id 들의 이력이 다 있는지**로 다시 셀 수 있어야 한다. */
  expectedOperationIds: string[];
  status: 'pending' | 'processing' | 'complete' | 'failed';
  lastError?: string;
  createdAt: string;
  completedAt?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  명령
// ─────────────────────────────────────────────────────────────────────────────

export type RawSourceType =
  | 'purchase' | 'production' | 'manual' | 'adjustment'
  | 'stocktake' | 'lot-delete' | 'reversal' | 'opening';

interface CommandBase {
  /** 같은 id 로 두 번 보내도 수량은 한 번만 움직인다. 규칙은 §7. */
  operationId: string;
  companyId: CompanyId;
  rawItemId: string;
  materialSnapshot: string;
  effectiveDate: string;
  source: { type: RawSourceType; id: string };
  actorId?: string;
  actorName?: string;
}

export interface ReceiveLotInput {
  supplierId?: string;
  supplierName: string;
  packageType?: string;
  packageKg?: number;
  qtyIn?: number;
  poId?: string;
}

export type RawInventoryCommand = CommandBase & (
  | { kind: 'receive'; kg: number; lot: ReceiveLotInput }
  | { kind: 'consume'; kg: number; mix?: { topPercent: number } }
  | { kind: 'stocktake'; targetKg: number }
  | { kind: 'delete-lot'; lotId: string }
  | { kind: 'reverse'; originalOperationId: string }
  | { kind: 'opening'; kg: number; supplierName?: string }
);

/**
 * 세 결과를 **서로 다르게** 낸다. 예전에는 불일치 경고를 띄운 직후 성공 토스트가 덮어썼다(§14).
 *  · `applied`   — 상태와 이력을 같이 쓴다.
 *  · `duplicate` — 이미 먹은 작업. 아무것도 안 움직이고 저장된 이력을 돌려준다.
 *  · `rejected`  — 검증 실패. 상태도 이력도 안 쓴다.
 */
export type RawApplyResult =
  | { status: 'applied'; state: RawInventoryState; movement: RawInventoryMovement }
  | { status: 'duplicate'; movement: RawInventoryMovement }
  | { status: 'rejected'; reason: string };

/** 트랜잭션 밖에서 미리 정해 넣는 값 — 안에서 만들면 재시도마다 달라진다(§6). */
export interface ApplyDeterministic {
  /** 저장 시각. */
  now: string;
  /** 새 로트 id (receive·opening·양수 실사). */
  newLotId?: string;
  /** 초과 출고 때 세울 '이월' 버킷 id. */
  carryOverLotId?: string;
}

/** 소진 로트를 얼마나 들고 있을지 — 문서가 커지면 FIFO 가 아니라 문서 한도가 먼저 걸린다(§3). */
export const DEPLETED_RETENTION = 40;

/**
 * Firestore 문서 id 로 쓸 수 있게 다듬는다.
 * 업무 원본 문자를 그대로 이어 붙이면 `/` 하나에 컬렉션 경로가 갈라진다(§7).
 */
export function operationDocId(operationId: string): string {
  const safe = operationId.replace(/[/\\.#$[\]]/g, '_').slice(0, 400);
  return safe === '' || /^__.*__$/.test(safe) ? `op_${safe}` : safe;
}

export const inventoryDocId = (companyId: CompanyId, rawItemId: string): string =>
  `${companyId}__${rawItemId}`;

/** 빈 상태 — 아직 문서가 없는 원료. */
export function emptyRawInventory(
  companyId: CompanyId, rawItemId: string, materialSnapshot: string, now: string,
): RawInventoryState {
  return {
    id: inventoryDocId(companyId, rawItemId),
    companyId, rawItemId, materialSnapshot,
    stockKg: 0, activeLots: [], recentDepletedLots: [],
    version: 0, updatedAt: now,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  계산
// ─────────────────────────────────────────────────────────────────────────────

const lotSum = (lots: RawMaterialLot[]): number =>
  r3(lots.reduce((a, l) => a + Number(l.kgRemaining ?? 0), 0));

/** 활성/소진을 갈라 담는다. FIFO 순서는 활성 배열이 그대로 지킨다. */
function partition(
  worked: RawMaterialLot[], prevDepleted: RawMaterialLot[],
): Pick<RawInventoryState, 'activeLots' | 'recentDepletedLots'> {
  const active = worked.filter(l => l.status !== 'depleted');
  const justDepleted = worked.filter(l => l.status === 'depleted');
  //  새로 소진된 것을 앞에 둔다 — 보존기간에서 잘려나가는 건 가장 오래된 쪽이어야 한다.
  const depleted = [...justDepleted, ...prevDepleted].slice(0, DEPLETED_RETENTION);
  return { activeLots: active, recentDepletedLots: depleted };
}

/** 앞뒤 로트 배열을 견줘 움직인 것만 뽑는다. */
function changesBetween(before: RawMaterialLot[], after: RawMaterialLot[]): LotChange[] {
  const prev = new Map(before.map(l => [l.id, Number(l.kgRemaining ?? 0)]));
  const out: LotChange[] = [];
  for (const l of after) {
    const was = prev.get(l.id) ?? 0;
    const now = Number(l.kgRemaining ?? 0);
    const d = r3(now - was);
    if (d === 0 && prev.has(l.id)) continue;
    out.push({
      lotId: l.id, supplierName: l.supplierName, lotNo: l.lotNo,
      receivedDate: l.receivedDate, deltaKg: d, kgAfter: r3(now),
    });
  }
  return out;
}

/**
 * **명령 하나를 상태에 적용한다.** 순수 함수 — 같은 입력이면 언제나 같은 결과다.
 *
 * @param state    지금 상태. 없으면 null(첫 문서).
 * @param existing 같은 `operationId` 로 이미 저장된 이력. 있으면 아무것도 안 움직인다.
 * @param original `reverse` 가 되돌릴 원본 이력.
 */
export function applyRawCommand(input: {
  state: RawInventoryState | null;
  command: RawInventoryCommand;
  existing?: RawInventoryMovement | null;
  original?: RawInventoryMovement | null;
  det: ApplyDeterministic;
}): RawApplyResult {
  const { command: c, existing, original, det } = input;

  //  ① 이미 먹은 작업이면 그대로 돌려준다. 재고를 다시 움직이지 않는다.
  if (existing) return { status: 'duplicate', movement: existing };

  const state = input.state
    ?? emptyRawInventory(c.companyId, c.rawItemId, c.materialSnapshot, det.now);

  //  ② 회사·품목이 다르면 거절한다. 이름이 같은 태백·풍회 원료가 서로를 깎던 자리다.
  if (state.companyId !== c.companyId || state.rawItemId !== c.rawItemId) {
    return {
      status: 'rejected',
      reason: `대상이 다르다: 상태 ${state.companyId}/${state.rawItemId} ≠ 명령 ${c.companyId}/${c.rawItemId}`,
    };
  }

  const sequence = state.version + 1;
  const base = {
    id: operationDocId(c.operationId),
    operationId: c.operationId,
    companyId: c.companyId,
    rawItemId: c.rawItemId,
    materialSnapshot: c.materialSnapshot,
    effectiveDate: c.effectiveDate,
    recordedAt: det.now,
    sequence,
    source: c.source,
    ...(c.actorId ? { actorId: c.actorId } : {}),
    ...(c.actorName ? { actorName: c.actorName } : {}),
  };

  const commit = (
    kind: RawMovementKind, worked: RawMaterialLot[], lotChanges: LotChange[],
    reportedDeltaKg: number, extra: Partial<RawInventoryMovement> = {},
  ): RawApplyResult => {
    const split = partition(worked, state.recentDepletedLots);
    const stockKg = lotSum(split.activeLots);
    const nextState: RawInventoryState = {
      ...state, ...split,
      materialSnapshot: c.materialSnapshot,
      stockKg, version: sequence, updatedAt: det.now,
      ...(kind === 'stocktake'
        ? { lastStocktakeDate: c.effectiveDate, lastStocktakeOperationId: c.operationId }
        : {}),
    };
    const movement: RawInventoryMovement = {
      ...base, kind,
      reportedDeltaKg: r3(reportedDeltaKg),
      appliedDeltaKg: r3(stockKg - state.stockKg),
      balanceAfterKg: stockKg,
      lotChanges,
      ...extra,
    };
    return { status: 'applied', state: nextState, movement };
  };

  /**
   * ③ 마지막 실사보다 앞선 날짜면 **현재 상태를 안 움직인다**(§10).
   *    실사는 그날 창고에 실제로 있던 양이라, 그 이전 일은 이미 그 안에 들어 있다.
   *    업무 수량은 남겨야 서류에 잡히므로 이력만 쌓고 `appliedDeltaKg: 0` 으로 둔다.
   *    판정은 화면이 든 배열이 아니라 **트랜잭션에서 읽은 상태**의 실사 정보로 한다.
   */
  const backdated = state.lastStocktakeDate != null && c.effectiveDate < state.lastStocktakeDate;
  const skipBackdated = (kind: RawMovementKind, reportedDeltaKg: number): RawApplyResult => ({
    status: 'applied',
    state: { ...state, version: sequence, updatedAt: det.now },
    movement: {
      ...base, kind,
      reportedDeltaKg: r3(reportedDeltaKg),
      appliedDeltaKg: 0,
      balanceAfterKg: state.stockKg,
      lotChanges: [],
      backdatedBeforeStocktake: true,
    },
  });

  const working = [...state.activeLots];

  switch (c.kind) {
    case 'receive':
    case 'opening': {
      const kg = r3(c.kg);
      if (!(kg > 0)) return { status: 'rejected', reason: '입고 수량은 0보다 커야 한다' };
      if (backdated) return skipBackdated(c.kind, kg);
      if (!det.newLotId) return { status: 'rejected', reason: '새 로트 id 를 밖에서 정해 넘겨야 한다' };
      const lotIn: ReceiveLotInput = c.kind === 'receive'
        ? c.lot
        : { supplierName: c.supplierName ?? '이월' };
      const lot = buildReceiveLot({
        material: c.materialSnapshot,
        supplierId: lotIn.supplierId,
        supplierName: lotIn.supplierName,
        packageType: lotIn.packageType,
        packageKg: lotIn.packageKg,
        qtyIn: lotIn.qtyIn ?? 0,
        kgIn: kg,
        receivedDate: c.effectiveDate,
        poId: lotIn.poId,
        id: det.newLotId,
        createdAt: det.now,
      });
      //  입고로 음수 '이월' 빚을 먼저 갚는다 — 안 갚으면 재고가 두 번 잡힌다.
      const after = settleCarryOver([...working, { ...lot, lotNo: nextLotNo(working, lot.receivedDate) }]);
      return commit(c.kind, after, changesBetween(working, after), kg);
    }

    case 'consume': {
      const kg = r3(c.kg);
      if (!(kg > 0)) return { status: 'rejected', reason: '사용 수량은 0보다 커야 한다' };
      if (backdated) return skipBackdated('consume', -kg);
      const { lots: after } = deductFromLots(working, kg, c.mix, det.carryOverLotId
        ? { id: det.carryOverLotId, createdAt: det.now, receivedDate: c.effectiveDate }
        : undefined);
      return commit('consume', after, changesBetween(working, after), -kg);
    }

    case 'stocktake': {
      const target = r3(c.targetKg);
      if (!Number.isFinite(target)) return { status: 'rejected', reason: '실사 목표량이 숫자가 아니다' };
      const delta = r3(target - state.stockKg);
      //  실사는 소급 판정을 받지 않는다 — 실사 자체가 새 앵커다.
      if (Math.abs(delta) < 0.0001) return commit('stocktake', working, [], 0, { targetKg: target });
      if (delta > 0) {
        if (!det.newLotId) return { status: 'rejected', reason: '새 로트 id 를 밖에서 정해 넘겨야 한다' };
        const lot = buildReceiveLot({
          material: c.materialSnapshot, supplierName: '재고실사', qtyIn: 0, kgIn: delta,
          receivedDate: c.effectiveDate, id: det.newLotId, createdAt: det.now,
        });
        const after = settleCarryOver([...working, { ...lot, lotNo: nextLotNo(working, lot.receivedDate) }]);
        return commit('stocktake', after, changesBetween(working, after), delta, { targetKg: target });
      }
      const { lots: after } = deductFromLots(working, -delta, undefined, det.carryOverLotId
        ? { id: det.carryOverLotId, createdAt: det.now, receivedDate: c.effectiveDate }
        : undefined);
      return commit('stocktake', after, changesBetween(working, after), delta, { targetKg: target });
    }

    case 'delete-lot': {
      const idx = working.findIndex(l => l.id === c.lotId);
      if (idx < 0) return { status: 'rejected', reason: `활성 로트에 없다: ${c.lotId}` };
      const gone = working[idx];
      const removed = r3(Number(gone.kgRemaining ?? 0));
      //  hard delete 하지 않는다 — 소진 처리하고 이력을 남긴다(§9).
      const after = working.map((l, i) => (i === idx ? { ...l, kgRemaining: 0, status: 'depleted' as const } : l));
      return commit('delete-lot', after, [{
        lotId: gone.id, supplierName: gone.supplierName, lotNo: gone.lotNo,
        receivedDate: gone.receivedDate, deltaKg: r3(-removed), kgAfter: 0,
      }], -removed);
    }

    case 'reverse': {
      if (!original) return { status: 'rejected', reason: `되돌릴 원본이 없다: ${c.originalOperationId}` };
      if (original.companyId !== c.companyId || original.rawItemId !== c.rawItemId) {
        return { status: 'rejected', reason: '원본이 다른 회사·품목이다' };
      }
      if (original.kind === 'reverse') return { status: 'rejected', reason: '되돌리기를 또 되돌릴 수 없다' };
      if (original.backdatedBeforeStocktake || original.appliedDeltaKg === 0) {
        //  재고를 안 움직인 줄이라 되돌릴 것도 없다. 이력만 남긴다.
        return commit('reverse', working, [], r3(-original.reportedDeltaKg), { reversalOf: original.operationId });
      }
      //  원본이 적은 로트 그대로 되돌린다 — FIFO 로 다시 계산하면 다른 로트가 움직인다.
      const byId = new Map(working.map((l, i) => [l.id, i]));
      const next = working.map(l => ({ ...l }));
      const revived: RawMaterialLot[] = [];
      const changes: LotChange[] = [];
      for (const ch of original.lotChanges) {
        const back = r3(-ch.deltaKg);
        if (back === 0) continue;
        const i = byId.get(ch.lotId);
        if (i != null) {
          const l = next[i];
          l.kgRemaining = r3(Number(l.kgRemaining ?? 0) + back);
          //  입고 취소는 **남은 양 안에서만** — 이미 쓴 것까지 지우면 재고가 사라진다(§9).
          if (back < 0 && l.kgRemaining < 0) {
            return { status: 'rejected', reason: `이미 사용된 입고는 취소할 수 없다: 로트 ${ch.lotId}` };
          }
          if (l.kgRemaining > 0) l.status = 'active';
          changes.push({
            lotId: l.id, supplierName: l.supplierName, lotNo: l.lotNo,
            receivedDate: l.receivedDate, deltaKg: back, kgAfter: l.kgRemaining,
          });
          continue;
        }
        //  소진돼 물러난 로트를 되살린다.
        const old = state.recentDepletedLots.find(l => l.id === ch.lotId);
        if (!old) return { status: 'rejected', reason: `되돌릴 로트를 찾지 못했다: ${ch.lotId}` };
        if (back < 0) return { status: 'rejected', reason: `이미 사용된 입고는 취소할 수 없다: 로트 ${ch.lotId}` };
        const l = { ...old, kgRemaining: back, status: 'active' as const };
        revived.push(l);
        changes.push({
          lotId: l.id, supplierName: l.supplierName, lotNo: l.lotNo,
          receivedDate: l.receivedDate, deltaKg: back, kgAfter: back,
        });
      }
      //  되살린 로트는 앞(먼저 쓸 자리)에 — 원래 그 자리에 있던 오래된 로트다.
      const after = [...revived, ...next];
      const keptDepleted = state.recentDepletedLots.filter(l => !revived.some(rv => rv.id === l.id));
      const split = partition(after, keptDepleted);
      const stockKg = lotSum(split.activeLots);
      return {
        status: 'applied',
        state: {
          ...state, ...split, materialSnapshot: c.materialSnapshot,
          stockKg, version: sequence, updatedAt: det.now,
        },
        movement: {
          ...base, kind: 'reverse',
          reportedDeltaKg: r3(-original.reportedDeltaKg),
          appliedDeltaKg: r3(stockKg - state.stockKg),
          balanceAfterKg: stockKg,
          lotChanges: changes,
          reversalOf: original.operationId,
        },
      };
    }
  }
}
