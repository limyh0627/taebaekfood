/**
 * **원료 재고 코어 — 순수 계산부.**
 *
 * 설계: [원료실제원장-로트-원자화-설계.md](../../docs/원료실제원장-로트-원자화-설계.md)
 *
 * 지금 앱은 로트와 실제 원장(`rawMaterialLedger`)을 **따로** 쓴다. 한쪽만 성공하면 그대로
 * 갈리고, 재시도하면 새 id 로 로트가 한 번 더 움직인다. 2026-09-09 조사에서 원료 홀더 18개 중
 * **7개가 갈려 있었다(절대값 합 2,719kg)** — 풍회 깨분은 원장 2,000kg 에 로트 0kg 이었다.
 *
 * 쓰는 순서를 바꾸는 걸로는 못 막는다. 둘을 **한 트랜잭션**에 넣고, 같은 작업 id + 같은 내용은
 * 한 번만 먹고 같은 id 인데 내용이 다르면 **거절(conflict)** 해야 한다. 이 파일은 그 트랜잭션
 * 안에서 돌 **계산만** 맡는다 — Firestore 도, 시각도, 난수도 여기 없다(§6: 콜백은 경합하면
 * 여러 번 돈다).
 *
 * 쓰기(트랜잭션)는 이 계산기를 부르는 쪽이 맡는다.
 */
import type { CompanyId, RawMaterialLot } from './types';
import { buildReceiveLot, deductFromLots, settleCarryOver, nextLotNo } from './lotUtils';

const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ─────────────────────────────────────────────────────────────────────────────
//  상태 · 이력 · 취소 표
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 마지막 실사를 한 묶음으로 담는다.
 *
 * `effectiveAt` 은 **실사 버튼을 누른 시각**이다(2026-09-10 사장님 결정) — 그날 마감이 아니다.
 * 소급 판정은 `effectiveAt < anchor.effectiveAt` 일 때만 소급이다.
 * **같은 시각은 실사 뒤로 본다** — 같으면 소급으로 치면 실사 당일 입력한 사용이 영영 재고에
 * 안 잡힌다(그날 것을 그날 넣는 게 가장 흔한 입력이다). 날짜만 아는 소급 입력이 실사 당일과
 * 겹치면 화면이 실사 전/후를 사람에게 묻는다.
 */
export interface StocktakeAnchor {
  effectiveAt: string;
  operationId: string;
  sequence: number;
}

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
  /** 표시용 스냅샷. **서비스가 `rawItemId` 로 채운다** — 화면이 준 이름을 안 믿는다. */
  materialSnapshot: string;
  stockKg: number;
  activeLots: RawMaterialLot[];
  /**
   * 화면 호환 캐시 — `items.lots` 를 활성+소진으로 보는 이관 기간의 꼬리.
   *
   * **되돌리기는 이 배열을 쓰지 않는다**(2026-09-10 Codex 승인). 40개 밖으로 밀려난 로트도
   * 복원해야 하므로 이력의 `lotChanges.lotSnapshot` 으로 되살린다(§9).
   * 새 화면이 `rawInventories` 를 직접 읽게 되면 mirror 와 함께 지운다(설계 §15 10단계).
   */
  recentDepletedLots: RawMaterialLot[];
  stocktakeAnchor?: StocktakeAnchor;
  /**
   * 그 원료에 **정상 적용된 명령 수** — 앱 배포 버전이 아니다.
   * `applied` 에서만 +1. `duplicate`·`conflict`·`rejected` 는 안 올린다.
   * 수량이 0인 소급 이력은 적용됐으므로 올린다.
   * 언제나 `revision === 가장 최근 Movement.sequence`.
   */
  revision: number;
  /**
   * 마지막 명령을 처리한 시각. 수량이 0인 소급 명령도 갱신된다.
   * 트랜잭션에서 서버가 확정한 값(밖에서 넘긴 `det.now`)을 저장한다.
   */
  lastProcessedAt: string;
}

/** 어느 로트에서 얼마가 움직였나 — 되돌릴 때 이대로 복원한다. */
export interface LotChange {
  lotId: string;
  supplierName?: string;
  lotNo?: string;
  receivedDate?: string;
  /** 입고 +, 사용 −. */
  deltaKg: number;
  beforeKg: number;
  afterKg: number;
  /**
   * 그 명령이 건드리기 **직전** 그 로트의 모습.
   * 40개보다 오래 전에 소진돼 상태에서 빠져도 이걸로 되살릴 수 있다.
   * (전체 로트 배열이 아니라 **건드린 로트만** — 이력 한 줄을 가볍게 유지한다)
   */
  lotSnapshot: RawMaterialLot;
}

export type RawMovementKind = 'receive' | 'consume' | 'stocktake' | 'deplete-lot' | 'reverse' | 'opening';

/**
 * **변경 이력이자 중복 방지 표다.** `rawMaterialLedger/{operationDocId}`.
 *
 * 별도 완료표를 두면 완료표와 원장이 또 갈린다. `operationId` + `commandHash` 가 있으면
 * 그 작업은 이미 먹은 것이다. 이력은 고치거나 지우지 않는다 — 오입력은 `reverse` 를 새로
 * 쌓아 되돌린다(§9).
 */
export interface RawInventoryMovement {
  id: string;
  operationId: string;
  /** 명령 내용의 지문. 같은 id 인데 다른 내용이면 `conflict` 로 막는다. */
  commandHash: string;
  companyId: CompanyId;
  rawItemId: string;
  materialSnapshot: string;
  /** 현실에서 일어난 업무 시각. 기간별 원장 기준. */
  effectiveAt: string;
  /** DB 에 기록된 시각. 늦게 넣은 자료를 찾는 감사 기준. */
  recordedAt: string;
  /** 상태 revision 과 같은 적용 순번. **잔량은 날짜가 아니라 이 순서로 센다.** */
  sequence: number;
  kind: RawMovementKind;
  /** 업무 기록 수량: 입고 +, 사용 −. 소급 입력이면 이 값만 남고 재고는 안 움직인다. */
  reportedDeltaKg: number;
  /** 이번에 현재 상태를 **실제로** 움직인 수량. 소급이면 0. */
  appliedDeltaKg: number;
  balanceAfterKg: number;
  targetKg?: number;
  lotChanges: LotChange[];
  source: { type: string; id: string };
  reversalOf?: string;
  /** 실사 취소가 직전 앵커를 되살릴 때 쓴다. 실사 movement에만 있다. */
  stocktakeAnchorBefore?: StocktakeAnchor;
  /** 마지막 실사보다 앞선 시각이라 재고를 안 움직였다(§10). */
  backdatedBeforeStocktake?: boolean;
  actorId?: string;
  actorName?: string;
}

/**
 * **같은 원본을 두 번 취소하지 못하게 한다.** `reversalGuards/{원본 operationDocId}`.
 *
 * 원본 이력이 있다는 것만으로는 못 막는다 — 취소는 다른 `operationId` 라, id 를 바꿔 두 번
 * 보내면 둘 다 통과해 원본이 두 번 되돌아간다. 원본당 이 문서 하나만 만들고, 취소 명령은
 * 트랜잭션 안에서 이 문서를 **읽고 없을 때만** 쓴다(설계 §9).
 */
export interface ReversalGuard {
  id: string;
  originalOperationId: string;
  reverseOperationId: string;
  companyId: CompanyId;
  rawItemId: string;
  createdAt: string;
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
  /** 같은 id + 같은 내용은 한 번만 먹는다. 같은 id 인데 다른 내용이면 `conflict`(§7). */
  operationId: string;
  companyId: CompanyId;
  rawItemId: string;
  /** **표시용 스냅샷.** 서비스가 `rawItemId` 로 채워 넣는다 — 부르는 쪽이 임의로 못 준다. */
  materialSnapshot: string;
  /** 현실 시각(ISO). 실사면 버튼을 누른 순간이다. */
  effectiveAt: string;
  source: { type: RawSourceType; id: string };
  actorId?: string;
  actorName?: string;
  /**
   * 소급 판정을 화면이 이미 물어봤다면 답을 넘긴다.
   * `after` = 실사 뒤로 본다(같은 시각의 기본 동작).
   * `before` = 실사 전이었다고 확정 — 소급으로 처리한다(같은 시각이어도).
   * 안 넘기면 시각 비교로 판정한다.
   */
  backdatedIntent?: 'before' | 'after';
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
  | { kind: 'deplete-lot'; lotId: string }
  | { kind: 'reverse'; originalOperationId: string }
  | { kind: 'opening'; kg: number; supplierName?: string }
);

/** `rejected` 이유를 화면이 문구로 뜯어보지 않게 code 로 나눈다(설계 §6). */
export type RawRejectCode =
  | 'ITEM_NOT_FOUND'
  | 'NOT_MIGRATED'
  | 'STOCK_MISMATCH'
  | 'INVALID_QUANTITY'
  | 'MISSING_LOT_ID'
  | 'LOT_NOT_FOUND'
  | 'ORIGINAL_NOT_FOUND'
  | 'ORIGINAL_MISMATCH'
  | 'ALREADY_REVERSED'
  | 'RECEIPT_CONSUMED'
  | 'CANNOT_REVERSE_REVERSAL'
  | 'STOCKTAKE_HAS_FOLLOWING_MOVEMENT'
  | 'COMPANY_MISMATCH'
  | 'TARGET_MISMATCH';

/**
 * 결과는 **넷**이다. 예전에는 불일치 경고를 띄운 직후 성공 토스트가 덮어썼다(§14).
 *  · `applied`   — 상태와 이력을 같이 쓴다.
 *  · `duplicate` — 이미 먹은 작업(같은 id + 같은 hash). 아무것도 안 움직이고 저장된 이력을 돌려준다.
 *  · `conflict`  — 같은 id 인데 **다른 내용**. 조용히 통과시키지 않는다.
 *  · `rejected`  — 검증 실패. `code` 와 `message` 를 나눠 준다.
 */
export type RawApplyResult =
  | { status: 'applied'; state: RawInventoryState; movement: RawInventoryMovement; guard?: ReversalGuard }
  | { status: 'duplicate'; movement: RawInventoryMovement }
  | { status: 'conflict'; movement: RawInventoryMovement }
  | { status: 'rejected'; code: RawRejectCode; message: string };

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
 *
 * **치환·잘라내기는 충돌한다** — `/` 를 `_` 로 바꾸면 `po1/x` 와 `po1_x` 가 한 문서가 되고,
 * 400자에서 자르면 앞이 같은 두 작업이 겹친다. 겹치면 뒤에 온 작업이 `duplicate` 로 조용히
 * 사라진다(§7). 그래서 사람이 읽을 수 있는 앞부분 + 원본 전체의 **해시**로 만든다.
 * 원본은 문서 안 `operationId` 필드에 그대로 남는다.
 */
export function operationDocId(operationId: string): string {
  const encoded = base64Url(operationId);
  // Firestore 문서 id 한도(1,500 bytes)보다 여유 있게 둔다. 보통 id 는 원문 전체를
  // 가역 인코딩하므로 서로 다른 값이 절대 겹치지 않는다. 비정상적으로 긴 id 만 고정 길이
  // 지문으로 줄인다.
  return encoded.length <= 1_400 ? `op_${encoded}` : `op_long_${fingerprint128(operationId)}`;
}

/** 5단계 초기에 쓰던 문서 id. 이미 기록된 명령을 새 id 로 다시 먹지 않게 서비스가 같이 읽는다. */
export function legacyOperationDocId(operationId: string): string {
  const safe = operationId.replace(/[/\\.#$[\]]/g, '_').slice(0, 400);
  return safe === '' || /^__.*__$/.test(safe) ? `op_${safe}` : safe;
}

/** 명령의 내용을 hash 한다 — 같은 id 인데 내용이 다르면 `conflict` 로 잡히도록. */
export function commandHash(c: RawInventoryCommand): string {
  // 객체 키 순서에 흔들리지 않게 정렬한다. 짧은 32-bit hash는 충돌하면 서로 다른 명령을
  // duplicate로 오인하므로, 정규화한 명령 전체를 가역 인코딩해 비교한다.
  return `v1_${base64Url(stableStringify(hashPayload(c)))}`;
}

/** hash 대상만 뽑는다 — 기록 작성자(actor)는 빼되 재고 결과를 바꾸는 backdatedIntent는 넣는다. */
function hashPayload(c: RawInventoryCommand): Record<string, unknown> {
  const base: Record<string, unknown> = {
    kind: c.kind,
    operationId: c.operationId,
    companyId: c.companyId,
    rawItemId: c.rawItemId,
    effectiveAt: c.effectiveAt,
    backdatedIntent: c.backdatedIntent ?? null,
    source: c.source,
  };
  switch (c.kind) {
    case 'receive':
      return { ...base, kg: r3(c.kg), lot: sortedLot(c.lot) };
    case 'opening':
      return { ...base, kg: r3(c.kg), supplierName: c.supplierName ?? '' };
    case 'consume':
      return { ...base, kg: r3(c.kg), mix: c.mix ?? null };
    case 'stocktake':
      return { ...base, targetKg: r3(c.targetKg) };
    case 'deplete-lot':
      return { ...base, lotId: c.lotId };
    case 'reverse':
      return { ...base, originalOperationId: c.originalOperationId };
  }
}

function sortedLot(lot: ReceiveLotInput): Record<string, unknown> {
  return {
    supplierId: lot.supplierId ?? '',
    supplierName: lot.supplierName,
    packageType: lot.packageType ?? '',
    packageKg: lot.packageKg ?? 0,
    qtyIn: lot.qtyIn ?? 0,
    poId: lot.poId ?? '',
  };
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify((v as Record<string, unknown>)[k])).join(',') + '}';
}

function base64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += alphabet[a >> 2];
    out += alphabet[((a & 3) << 4) | (b === undefined ? 0 : b >> 4)];
    if (b !== undefined) out += alphabet[((b & 15) << 2) | (c === undefined ? 0 : c >> 6)];
    if (c !== undefined) out += alphabet[c & 63];
  }
  return out;
}

/** 아주 긴 operationId만 줄일 때 쓰는 128-bit 결정적 지문. */
function fingerprint128(s: string): string {
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  return seeds.map(seed => {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }).join('');
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
    revision: 0, lastProcessedAt: now,
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
  const prev = new Map(before.map(l => [l.id, l]));
  const out: LotChange[] = [];
  for (const l of after) {
    const was = prev.get(l.id);
    const beforeKg = Number(was?.kgRemaining ?? 0);
    const nowKg = Number(l.kgRemaining ?? 0);
    const d = r3(nowKg - beforeKg);
    if (d === 0 && prev.has(l.id)) continue;
    //  스냅샷은 그 명령 직전의 로트다 — 없던 로트(입고로 새로 선 것)면 잔량 0 짜리 자기 자신.
    const snap: RawMaterialLot = was ?? { ...l, kgRemaining: 0, status: 'active' };
    out.push({
      lotId: l.id, supplierName: l.supplierName, lotNo: l.lotNo, receivedDate: l.receivedDate,
      deltaKg: d, beforeKg: r3(beforeKg), afterKg: r3(nowKg), lotSnapshot: snap,
    });
  }
  return out;
}

/**
 * **명령 하나를 상태에 적용한다.** 순수 함수 — 같은 입력이면 언제나 같은 결과다.
 *
 * @param state    지금 상태. 없으면 null(첫 문서).
 * @param existing 같은 `operationId` 로 이미 저장된 이력. hash 가 같으면 `duplicate`, 다르면 `conflict`.
 * @param original `reverse` 가 되돌릴 원본 이력.
 * @param guard    원본을 이미 취소한 표. 있으면 `ALREADY_REVERSED` 로 거절.
 */
export function applyRawCommand(input: {
  state: RawInventoryState | null;
  command: RawInventoryCommand;
  existing?: RawInventoryMovement | null;
  original?: RawInventoryMovement | null;
  guard?: ReversalGuard | null;
  det: ApplyDeterministic;
}): RawApplyResult {
  const { command: c, existing, original, guard, det } = input;
  const hash = commandHash(c);

  //  ① 이미 먹은 작업이면 hash 를 견준다. 같으면 duplicate, 다르면 conflict — 조용히 통과 X.
  if (existing) {
    // 5단계 초기에 저장된 이력에는 commandHash가 없다. 내용 비교가 불가능하므로 재적용해
    // 수량을 두 번 움직이는 것보다 기존 작업으로 보는 편이 안전하다.
    return !existing.commandHash || existing.commandHash === hash
      ? { status: 'duplicate', movement: existing }
      : { status: 'conflict', movement: existing };
  }

  const state = input.state
    ?? emptyRawInventory(c.companyId, c.rawItemId, c.materialSnapshot, det.now);

  //  ② 회사·품목이 다르면 거절한다. 이름이 같은 태백·풍회 원료가 서로를 깎던 자리다.
  if (state.companyId !== c.companyId || state.rawItemId !== c.rawItemId) {
    return {
      status: 'rejected', code: 'COMPANY_MISMATCH',
      message: `대상이 다르다: 상태 ${state.companyId}/${state.rawItemId} ≠ 명령 ${c.companyId}/${c.rawItemId}`,
    };
  }

  const sequence = state.revision + 1;
  const base = {
    id: operationDocId(c.operationId),
    operationId: c.operationId,
    commandHash: hash,
    companyId: c.companyId,
    rawItemId: c.rawItemId,
    materialSnapshot: c.materialSnapshot,
    effectiveAt: c.effectiveAt,
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
      stockKg, revision: sequence, lastProcessedAt: det.now,
      ...(kind === 'stocktake'
        ? { stocktakeAnchor: { effectiveAt: c.effectiveAt, operationId: c.operationId, sequence } }
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
   * ③ 소급 판정 — `effectiveAt < anchor.effectiveAt` 일 때만 소급이다(§10).
   *    **같은 시각은 실사 뒤로 본다.** 그날 것을 그날 넣는 게 가장 흔한 입력이라, 같으면
   *    소급으로 치면 실사 당일 사용이 영영 재고에 안 잡힌다.
   *    화면이 `backdatedIntent: 'before'` 를 명시하면 그 뜻대로 소급 처리한다.
   */
  const anchor = state.stocktakeAnchor;
  const 시각소급 = anchor != null && c.effectiveAt < anchor.effectiveAt;
  const backdated = c.backdatedIntent === 'before' ? true
    : c.backdatedIntent === 'after' ? false
    : 시각소급;
  const skipBackdated = (kind: RawMovementKind, reportedDeltaKg: number): RawApplyResult => {
    //  소급 이력도 `revision` 은 올린다(설계 §4·§10). 잔량만 안 움직인다.
    return {
      status: 'applied',
      state: { ...state, revision: sequence, lastProcessedAt: det.now },
      movement: {
        ...base, kind,
        reportedDeltaKg: r3(reportedDeltaKg),
        appliedDeltaKg: 0,
        balanceAfterKg: state.stockKg,
        lotChanges: [],
        backdatedBeforeStocktake: true,
      },
    };
  };

  const working = [...state.activeLots];

  switch (c.kind) {
    case 'receive':
    case 'opening': {
      const kg = r3(c.kg);
      if (!(kg > 0)) return { status: 'rejected', code: 'INVALID_QUANTITY', message: '입고 수량은 0보다 커야 한다' };
      if (backdated) return skipBackdated(c.kind, kg);
      if (!det.newLotId) return { status: 'rejected', code: 'MISSING_LOT_ID', message: '새 로트 id 를 밖에서 정해 넘겨야 한다' };
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
        receivedDate: c.effectiveAt.slice(0, 10),
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
      if (!(kg > 0)) return { status: 'rejected', code: 'INVALID_QUANTITY', message: '사용 수량은 0보다 커야 한다' };
      if (backdated) return skipBackdated('consume', -kg);
      const { lots: after } = deductFromLots(working, kg, c.mix, det.carryOverLotId
        ? { id: det.carryOverLotId, createdAt: det.now, receivedDate: c.effectiveAt.slice(0, 10) }
        : undefined);
      return commit('consume', after, changesBetween(working, after), -kg);
    }

    case 'stocktake': {
      const target = r3(c.targetKg);
      if (!Number.isFinite(target)) return { status: 'rejected', code: 'TARGET_MISMATCH', message: '실사 목표량이 숫자가 아니다' };
      const delta = r3(target - state.stockKg);
      //  실사는 소급 판정을 받지 않는다 — 실사 자체가 새 앵커다.
      const stocktakeExtra = { targetKg: target, stocktakeAnchorBefore: state.stocktakeAnchor };
      if (Math.abs(delta) < 0.0001) return commit('stocktake', working, [], 0, stocktakeExtra);
      if (delta > 0) {
        if (!det.newLotId) return { status: 'rejected', code: 'MISSING_LOT_ID', message: '새 로트 id 를 밖에서 정해 넘겨야 한다' };
        const lot = buildReceiveLot({
          material: c.materialSnapshot, supplierName: '재고실사', qtyIn: 0, kgIn: delta,
          receivedDate: c.effectiveAt.slice(0, 10), id: det.newLotId, createdAt: det.now,
        });
        const after = settleCarryOver([...working, { ...lot, lotNo: nextLotNo(working, lot.receivedDate) }]);
        return commit('stocktake', after, changesBetween(working, after), delta, stocktakeExtra);
      }
      const { lots: after } = deductFromLots(working, -delta, undefined, det.carryOverLotId
        ? { id: det.carryOverLotId, createdAt: det.now, receivedDate: c.effectiveAt.slice(0, 10) }
        : undefined);
      return commit('stocktake', after, changesBetween(working, after), delta, stocktakeExtra);
    }

    case 'deplete-lot': {
      const idx = working.findIndex(l => l.id === c.lotId);
      if (idx < 0) return { status: 'rejected', code: 'LOT_NOT_FOUND', message: `활성 로트에 없다: ${c.lotId}` };
      const gone = working[idx];
      const removed = r3(Number(gone.kgRemaining ?? 0));
      //  hard delete 하지 않는다 — 소진 처리하고 이력을 남긴다(§9).
      const after = working.map((l, i) => (i === idx ? { ...l, kgRemaining: 0, status: 'depleted' as const } : l));
      return commit('deplete-lot', after, [{
        lotId: gone.id, supplierName: gone.supplierName, lotNo: gone.lotNo,
        receivedDate: gone.receivedDate, deltaKg: r3(-removed),
        beforeKg: removed, afterKg: 0, lotSnapshot: { ...gone },
      }], -removed);
    }

    case 'reverse': {
      if (!original) return { status: 'rejected', code: 'ORIGINAL_NOT_FOUND', message: `되돌릴 원본이 없다: ${c.originalOperationId}` };
      if (original.operationId !== c.originalOperationId) {
        return { status: 'rejected', code: 'ORIGINAL_MISMATCH', message: '요청한 작업과 읽어 온 원본이 다르다' };
      }
      if (original.companyId !== c.companyId || original.rawItemId !== c.rawItemId) {
        return { status: 'rejected', code: 'COMPANY_MISMATCH', message: '원본이 다른 회사·품목이다' };
      }
      if (original.kind === 'reverse') return { status: 'rejected', code: 'CANNOT_REVERSE_REVERSAL', message: '되돌리기를 또 되돌릴 수 없다' };
      // 실사는 이후 입력의 소급 기준이다. 뒤에 움직임이 쌓인 뒤 앵커만 되돌리면 이미 처리한
      // 명령들의 의미가 바뀌므로, 실사가 가장 마지막 movement일 때만 취소한다.
      if (original.kind === 'stocktake' && state.revision !== original.sequence) {
        return { status: 'rejected', code: 'STOCKTAKE_HAS_FOLLOWING_MOVEMENT', message: '이 실사 뒤에 다른 입출고가 있어 취소할 수 없다' };
      }
      //  guard 는 원본당 하나 — id 가 다른 두 번째 취소를 여기서 막는다(§9).
      if (guard && guard.reverseOperationId !== c.operationId) {
        return { status: 'rejected', code: 'ALREADY_REVERSED', message: `이미 취소된 원본이다: ${c.originalOperationId}` };
      }

      const newGuard: ReversalGuard = {
        id: operationDocId(original.operationId),
        originalOperationId: original.operationId,
        reverseOperationId: c.operationId,
        companyId: c.companyId,
        rawItemId: c.rawItemId,
        createdAt: det.now,
      };

      if (original.backdatedBeforeStocktake || original.appliedDeltaKg === 0) {
        //  재고를 안 움직인 줄이라 되돌릴 것도 없다. 이력만 남기고 guard 는 세운다.
        const r = commit('reverse', working, [], r3(-original.reportedDeltaKg), { reversalOf: original.operationId });
        if (r.status !== 'applied') return r;
        const reversedState = original.kind === 'stocktake'
          ? { ...r.state, stocktakeAnchor: original.stocktakeAnchorBefore }
          : r.state;
        return { ...r, state: reversedState, guard: newGuard };
      }

      //  원본이 적은 로트 그대로 되돌린다 — FIFO 로 다시 계산하면 다른 로트가 움직인다.
      //  **되돌리기의 유일한 근거는 이력의 `lotSnapshot` 이다** — 상태의 recentDepletedLots 를 쓰지 않는다.
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
          const before = Number(l.kgRemaining ?? 0);
          const now = r3(before + back);
          //  입고 취소는 **남은 양 안에서만** — 이미 쓴 것까지 지우면 재고가 사라진다(§9).
          if (back < 0 && now < 0) {
            return { status: 'rejected', code: 'RECEIPT_CONSUMED', message: `이미 사용된 입고는 취소할 수 없다: 로트 ${ch.lotId}` };
          }
          l.kgRemaining = now;
          if (now > 0) l.status = 'active';
          else l.status = 'depleted';
          changes.push({
            lotId: l.id, supplierName: l.supplierName, lotNo: l.lotNo,
            receivedDate: l.receivedDate, deltaKg: back, beforeKg: r3(before), afterKg: now,
            lotSnapshot: { ...l, kgRemaining: before, status: before > 0 ? 'active' : 'depleted' },
          });
          continue;
        }
        //  상태에서 물러난 로트 — 이력의 스냅샷으로 되살린다(**40개 캐시에 의존하지 않는다**).
        const snap = ch.lotSnapshot;
        if (!snap) return { status: 'rejected', code: 'LOT_NOT_FOUND', message: `되돌릴 로트를 찾지 못했다: ${ch.lotId}` };
        if (back < 0) return { status: 'rejected', code: 'RECEIPT_CONSUMED', message: `이미 사용된 입고는 취소할 수 없다: 로트 ${ch.lotId}` };
        const l = { ...snap, kgRemaining: back, status: 'active' as const };
        revived.push(l);
        changes.push({
          lotId: l.id, supplierName: l.supplierName, lotNo: l.lotNo,
          receivedDate: l.receivedDate, deltaKg: back, beforeKg: 0, afterKg: back,
          lotSnapshot: { ...snap, kgRemaining: 0, status: 'depleted' },
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
          stockKg, revision: sequence, lastProcessedAt: det.now,
          ...(original.kind === 'stocktake' ? { stocktakeAnchor: original.stocktakeAnchorBefore } : {}),
        },
        movement: {
          ...base, kind: 'reverse',
          reportedDeltaKg: r3(-original.reportedDeltaKg),
          appliedDeltaKg: r3(stockKg - state.stockKg),
          balanceAfterKg: stockKg,
          lotChanges: changes,
          reversalOf: original.operationId,
        },
        guard: newGuard,
      };
    }
  }
}
