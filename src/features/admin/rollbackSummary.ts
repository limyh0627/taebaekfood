import type { Item, Order, OrderStatus } from '../../shared/types';
import { bomOf } from '../../shared/bomIndex';
import { isBulkItem } from '../../shared/itemTaxonomy';
import { stockUnits } from '../../shared/orderUnits';

/**
 * **되돌리면 무엇이 되돌아오는가** — 작업완료·출고에서 대기중·작업중으로 보낼 때 보여줄 문구.
 *
 * 되돌리기는 재고를 조용히 움직인다: 출고취소로 완제품이 다시 채워지고, 생산취소로 BOM 구성품과
 * 원료 로트가 복원되며 원료수불부 줄이 지워진다. 눌러 놓고 나중에 "왜 재고가 늘었지"로 만나면
 * 되짚기 어렵다. 그래서 **누르기 전에** 무엇이 움직이는지 적어 보여주고 확인을 받는다.
 *
 * 순수 함수다 — 화면은 이 글을 띄우기만 한다.
 */
export interface RollbackPlan {
  /** 되돌릴 게 하나도 없으면 false — 물어볼 것도 없다 */
  needed: boolean;
  lines: string[];
  text: string;
  adjustments: { itemId: string; name: string; unit: string; delta: number; reason: '출고 취소' | '생산 취소' }[];
  legacyEvidenceWarning: boolean;
  warnings: string[];
}

const fmt = (n: number) => Math.round(n * 1000) / 1000;

export function buildRollbackPlan(
  order: Pick<Order, 'items' | 'producedUnits' | 'rawConsumedLots' | 'shippedOut' | 'autoBuilt' | 'producedAt' | 'inventorySnapshots'>,
  allItems: Item[],
  from: OrderStatus | string,
  to: OrderStatus | string,
): RollbackPlan {
  const nameOf = (id: string) => {
    const p = allItems.find(i => i.id === id);
    return p ? `${p.name}${p.spec ? ` ${p.spec}` : ''}` : id;
  };
  const unitOf = (id: string) => allItems.find(i => i.id === id)?.unit ?? '개';
  const lines: string[] = [];
  const adjustments: RollbackPlan['adjustments'] = [];
  const warnings: string[] = [];
  let legacyEvidenceWarning = false;

  const addSnapshot = (snapshot: NonNullable<Order['inventorySnapshots']>['production'] | NonNullable<Order['inventorySnapshots']>['shipment'], reason: '출고 취소' | '생산 취소') => {
    for (const row of snapshot?.stockDeltas ?? []) {
      adjustments.push({ itemId: row.itemId, name: nameOf(row.itemId), unit: unitOf(row.itemId), delta: -Number(row.delta || 0), reason });
    }
  };
  const stockStage = (value: OrderStatus | string) => value === 'SHIPPED' || value === 'DELIVERED' ? 2 : value === 'DISPATCHED' ? 1 : 0;
  const expectsShipmentRollback = stockStage(from) >= 2 && stockStage(to) < 2;
  const expectsProductionRollback = stockStage(from) >= 1 && stockStage(to) < 1;
  const undoShipment = !!order.shippedOut && stockStage(to) < 2;
  const hasProductionEvidence = !!order.producedAt || (order.producedUnits?.length ?? 0) > 0
    || (order.rawConsumedLots?.length ?? 0) > 0 || (order.autoBuilt?.length ?? 0) > 0;
  const undoProduction = hasProductionEvidence && stockStage(to) < 1;
  if ((expectsShipmentRollback && !order.shippedOut) || (expectsProductionRollback && !hasProductionEvidence)) {
    legacyEvidenceWarning = true;
  }

  if (undoShipment) {
    if (order.inventorySnapshots?.shipment) addSnapshot(order.inventorySnapshots.shipment, '출고 취소');
    else {
      legacyEvidenceWarning = true;
      for (const row of order.items) {
        const item = allItems.find(candidate => candidate.id === row.itemId);
        if (!item || isBulkItem(item)) continue;
        adjustments.push({ itemId: item.id, name: nameOf(item.id), unit: unitOf(item.id), delta: stockUnits(row, item), reason: '출고 취소' });
      }
    }
    const rows = order.items
      .map(it => ({ name: nameOf(it.itemId), qty: (it as { isBoxUnit?: boolean; boxQuantity?: number }).isBoxUnit && (it as { boxQuantity?: number }).boxQuantity ? (it as { boxQuantity?: number }).boxQuantity! : it.quantity, unit: unitOf(it.itemId) }))
      .filter(r => r.qty > 0);
    if (rows.length) lines.push(`· 출고취소 — 재고가 다시 늘어납니다: ${rows.map(r => `${r.name} +${fmt(r.qty)}`).join(', ')}`);
  }

  const produced = (order.producedUnits ?? []).filter(p => Number(p.qty) > 0);
  if (undoProduction) {
    if (order.inventorySnapshots?.production) addSnapshot(order.inventorySnapshots.production, '생산 취소');
    else {
      legacyEvidenceWarning = true;
      const addLegacyBom = (itemId: string, qty: number, depth = 0) => {
        if (depth > 4 || qty <= 0) return;
        adjustments.push({ itemId, name: nameOf(itemId), unit: unitOf(itemId), delta: -qty, reason: '생산 취소' });
        for (const line of bomOf(itemId)) {
          const child = allItems.find(candidate => candidate.id === line.childId);
          if (!child || isBulkItem(child)) continue;
          adjustments.push({ itemId: child.id, name: nameOf(child.id), unit: unitOf(child.id), delta: qty * line.qty, reason: '생산 취소' });
        }
      };
      const legacyProduced = Array.isArray(order.producedUnits)
        ? order.producedUnits
        : order.items.map(row => {
            const item = allItems.find(candidate => candidate.id === row.itemId);
            return { itemId: row.itemId, qty: item ? stockUnits(row, item) : 0 };
          });
      legacyProduced.forEach(row => addLegacyBom(row.itemId, Number(row.qty)));
      for (const row of order.autoBuilt ?? []) addLegacyBom(row.itemId, Number(row.qty));
    }
  }
  if (undoProduction && produced.length) {
    lines.push(`· 생산취소 — 만든 만큼 재고에서 뺍니다: ${produced.map(p => `${nameOf(p.itemId)} −${fmt(Number(p.qty))}`).join(', ')}`);
    lines.push(`  (그 BOM 구성품 — 병·캡·라벨·박스 — 은 도로 채워집니다)`);
  }

  const raw = order.rawConsumedLots ?? [];
  const rawLots = raw.filter(r => !r.ledgerOnly);
  const ledgerOnly = raw.filter(r => r.ledgerOnly);
  if (undoProduction && rawLots.length) {
    const byMat = new Map<string, number>();
    for (const r of rawLots) byMat.set(r.material, fmt((byMat.get(r.material) ?? 0) + Number(r.kg || 0)));
    lines.push(`· 원료가 로트로 되돌아갑니다: ${[...byMat].map(([m, kg]) => `${m} ${fmt(kg)}kg`).join(', ')}`);
    lines.push(`  원료수불부에는 사용 취소 이력이 뒤에 기록됩니다`);
  }
  if (undoProduction && ledgerOnly.length) {
    const byMat = new Map<string, number>();
    for (const r of ledgerOnly) byMat.set(r.material, fmt((byMat.get(r.material) ?? 0) + Number(r.kg || 0)));
    lines.push(`· 임가공 사용 기록만 취소됩니다: ${[...byMat].map(([m, kg]) => `${m} ${fmt(kg)}kg`).join(', ')}`);
    lines.push(`  완제품 로트에서 이미 처리된 실물 수량은 여기서 다시 움직이지 않습니다`);
  }

  if (undoProduction && (order.autoBuilt ?? []).length) {
    lines.push(`· 모자라서 먼저 만들었던 구성품도 되돌립니다: ${(order.autoBuilt ?? []).map(b => `${nameOf(b.itemId)} ${fmt(Number(b.qty))}`).join(', ')}`);
  }

  if (legacyEvidenceWarning) warnings.push('이 주문은 작업 당시 실제 재고 증감 또는 BOM 스냅샷이 없습니다. 현재 데이터로 추정해 원복합니다.');

  const normalizedAdjustments = [...adjustments.reduce((grouped, row) => {
    const key = `${row.reason}:${row.itemId}`;
    const current = grouped.get(key);
    grouped.set(key, current ? { ...current, delta: fmt(current.delta + row.delta) } : { ...row, delta: fmt(row.delta) });
    return grouped;
  }, new Map<string, RollbackPlan['adjustments'][number]>()).values()].filter(row => row.delta !== 0);

  const adjustmentLines = normalizedAdjustments
    .filter(row => row.delta !== 0)
    .map(row => `· ${row.reason} — ${row.name} ${row.delta > 0 ? '+' : '−'}${fmt(Math.abs(row.delta))}${row.unit}`);
  if (adjustmentLines.length) lines.unshift(...adjustmentLines);

  const label = (s: string) => ({ PENDING: '대기중', PROCESSING: '작업중', DISPATCHED: '작업완료', SHIPPED: '출고', DELIVERED: '배송완료' } as Record<string, string>)[String(s)] ?? String(s);
  const head = `'${label(from)}' → '${label(to)}'로 되돌립니다.`;
  return {
    needed: lines.length > 0,
    lines,
    adjustments: normalizedAdjustments,
    legacyEvidenceWarning,
    warnings,
    text: lines.length
      ? `${head}\n\n되돌아가는 것:\n${lines.join('\n')}\n\n계속할까요?`
      : `${head}\n\n되돌릴 재고는 없습니다. 계속할까요?`,
  };
}

/**
 * **상태를 바꿀 때 띄울 확인창 글** — 순수 함수다. 화면은 이 글을 띄우기만 한다.
 *
 * 2026-09-14 사장님: "작업완료 이후에 있던 주문들이 돌아올때는 무조건 알람 띄워야지
 * (전량 재고로 나가서 하나도 생산 안 했던 애들 말고는) 차감된 원료 부자재 같은거 롤백해야 하는데",
 * 그리고 "작업중에서 대기중으로 가거나 대기중에서 작업중으로 가거나 하는 것도 알람띄워 그냥".
 *
 * 그동안은 **내릴 때 아무것도 안 물었다.** 되돌리기가 원료 로트·부자재·원료수불부를 조용히
 * 되돌려 놓아서, 눌러 놓고 나중에 "왜 재고가 늘었지"로 만나면 되짚을 길이 없었다.
 *
 * 글은 짧게 — 2026-09-12 사장님이 "알람처럼 깔끔하게 바꿔 같은 양식으로" 하라고 한 그 모양이다.
 * 무엇이 얼마나 움직이는지 낱낱이 적지 않고, **몇 건이 어느 쪽으로** 움직이는지만 적는다.
 */
export function buildStatusChangeAsk(args: {
  partnerName?: string;
  from: OrderStatus | string;
  to: OrderStatus | string;
  /** 되돌리기면 그 계획. 단순 상태 변경이면 없다. */
  plan?: RollbackPlan;
  /** 한 줄만 되돌릴 때 그 품목 이름 */
  lineName?: string;
  /**
   * **이 주문 몫으로 잡혀 있던 재고** — 되돌리면 풀린다(2026-09-15 사장님:
   * "이 주문 몫으로 할당돼있던 재고 N개가 풀립니다를 첫 줄에 써").
   *
   * 작업완료로는 재고가 **안 줄어든다.** 그 몫이 이 주문에 잡히고(`inventoryReservations`)
   * 실제로 빠지는 건 출고할 때다. 그래서 사입·임가공처럼 생산이 없는 건을 되돌리면
   * "되돌릴 원료·부자재가 없습니다" 만 떴는데, **아무 일도 안 일어나는 것이 아니다** —
   * 잡아 둔 몫이 풀려 다른 주문이 쓸 수 있게 된다. 그 말을 맨 앞에 적는다.
   */
  released?: { name: string; qty: number; unit: string }[];
}): { message: string; subMessage: string; confirmText: string } {
  const label = (s: string) => ({ PENDING: '대기중', PROCESSING: '작업중', DISPATCHED: '작업완료', SHIPPED: '출고', DELIVERED: '배송완료' } as Record<string, string>)[String(s)] ?? String(s);
  const 거래처 = args.partnerName || '거래처 미지정';
  const 흐름 = `${거래처} · ${label(String(args.from))} → ${label(String(args.to))}`;
  const 움직임 = (args.plan?.adjustments ?? []).filter(row => row.delta !== 0);

  //  잡아 둔 몫이 풀린다는 말 — 있으면 **맨 앞줄**이다. 그 순간 실제로 움직이는 것이라 먼저 읽혀야 한다.
  const 풀릴것 = (args.released ?? []).filter(row => row.qty > 0);
  const 수 = (n: number) => Math.round(n * 1000) / 1000;
  const 풀림글 = 풀릴것.length === 0 ? ''
    : 풀릴것.length === 1
      ? `이 주문 몫으로 할당돼 있던 재고 ${수(풀릴것[0].qty)}${풀릴것[0].unit}가 풀립니다 — ${풀릴것[0].name}.`
      : `이 주문 몫으로 할당돼 있던 재고가 풀립니다 — ${풀릴것.map(row => `${row.name} ${수(row.qty)}${row.unit}`).join(', ')}.`;

  //  되돌릴 것이 없다 — 전량 재고로 나가 하나도 생산하지 않은 건이 여기다.
  //  그래도 묻기는 한다(사장님: "그냥 알람띄워"). 다만 겁줄 말은 안 쓴다.
  if (!args.plan || 움직임.length === 0) {
    const 되돌리기 = !!args.plan;
    return {
      message: args.lineName
        ? `“${args.lineName}” 작업완료를 풀까요?`
        : `${label(String(args.to))} 로 바꿀까요?`,
      subMessage: [
        흐름,
        풀림글,
        되돌리기
          ? '생산한 기록은 없어 되돌릴 원료·부자재는 없습니다.'
          : '재고는 움직이지 않습니다.',
      ].filter(Boolean).join('\n'),
      confirmText: 되돌리기 ? '되돌리기' : '변경하기',
    };
  }

  const 이름들 = 움직임.slice(0, 3).map(row => row.name).join(', ');
  const 남은 = 움직임.length - Math.min(3, 움직임.length);
  return {
    message: args.lineName
      ? `“${args.lineName}” 을 풀고 재고를 원복할까요?`
      : '주문 상태와 재고를 원복할까요?',
    subMessage: [
      흐름,
      풀림글,
      `재고 ${움직임.length}건이 되돌아갑니다(로트·원료수불부 포함) — ${이름들}${남은 > 0 ? ` 외 ${남은}건` : ''}.`,
      args.plan.legacyEvidenceWarning
        ? '이 주문은 생산 당시 기록이 없어 지금 구성(BOM)으로 추정해 되돌립니다.'
        : '',
    ].filter(Boolean).join('\n'),
    confirmText: '원복 승인',
  };
}

export type OrderDeleteAction = 'cancel-shipment' | 'delete';
export type OrderDeleteStage = 'shipment' | 'production' | 'raw' | 'order-delete';

/** 엔진이 재조회한 처리 근거의 화면용 투영이다. 저장 구조나 재개 명령이 아니다. */
export interface OrderDeleteProgress {
  action: OrderDeleteAction;
  state: 'processing' | 'partial' | 'failed' | 'completed';
  completedStages: OrderDeleteStage[];
  inventoryApplied: 'none' | 'partial' | 'complete' | 'unknown';
  error?: string;
  retryable: boolean;
}

export interface OrderDeletePlan {
  action: OrderDeleteAction | 'blocked';
  allowed: boolean;
  nextStatus?: 'DISPATCHED';
  state: 'ready' | OrderDeleteProgress['state'];
  message: string;
  subMessage: string;
  confirmText: string;
  blockedReasons: string[];
  adjustments: RollbackPlan['adjustments'];
  completedStages: OrderDeleteStage[];
  inventoryApplied: OrderDeleteProgress['inventoryApplied'];
  retryable: boolean;
}

/** 삭제 전 경고만 만든다. 현재 BOM·포장 수량으로 과거 재고를 추정하지 않는다. */
export function buildOrderDeletePlan(order: Order, allItems: Item[], progress?: OrderDeleteProgress): OrderDeletePlan {
  const action: OrderDeleteAction = order.status === 'SHIPPED' ? 'cancel-shipment' : 'delete';
  const reasons: string[] = [];
  const lines: string[] = [];
  const adjustments: RollbackPlan['adjustments'] = [];
  let hasRawEffect = false;
  const completedStages = [...(progress?.completedStages ?? [])];
  const done = (stage: OrderDeleteStage) => progress?.state === 'completed' || completedStages.includes(stage);
  const addSnapshot = (snapshot: NonNullable<Order['inventorySnapshots']>['production'], stage: OrderDeleteStage) => {
    if (done(stage)) return;
    if (!snapshot || !snapshot.capturedAt || !Array.isArray(snapshot.stockDeltas)
      || snapshot.stockDeltas.some(row => !row.itemId || !Number.isFinite(row.delta))) {
      reasons.push('당시 재고 증감 기록이 없거나 불완전합니다. 기록 확인 후 처리하세요.');
      return;
    }
    for (const row of snapshot.stockDeltas) {
      const item = allItems.find(candidate => candidate.id === row.itemId);
      adjustments.push({ itemId: row.itemId, name: item?.name ?? row.itemId, unit: item?.unit ?? '개',
        delta: -row.delta, reason: stage === 'shipment' ? '출고 취소' : '생산 취소' });
    }
  };
  const addRaw = (traces: Order['rawConsumedLots']) => {
    if (done('raw')) return;
    for (const trace of traces ?? []) {
      if (!trace.operationId || !trace.rawItemId || !Number.isFinite(trace.kg) || trace.kg < 0) {
        reasons.push('원료 사용 기록의 명령 번호·품목·수량을 확인해야 합니다.');
        continue;
      }
      hasRawEffect = true;
      lines.push(trace.ledgerOnly
        ? `임가공 사용 기록만 취소: ${trace.material} ${fmt(trace.kg)}kg (실물 재고 복원 없음).`
        : `원료 로트 복원: ${trace.material} ${fmt(trace.kg)}kg. 사용 취소 이력이 기록됩니다.`);
    }
  };
  if (order.status === 'DELIVERED') reasons.push('배송완료 주문 삭제는 별도 정책 확인이 필요합니다.');
  if (order.inventoryOperation && !progress) reasons.push('기존 재고 처리 기록을 재조회해 처리 상태를 먼저 확인하세요.');
  if (action === 'cancel-shipment') {
    if (!order.shippedOut && !done('shipment')) reasons.push('출고 처리 근거를 확인해야 합니다.');
    addSnapshot(order.inventorySnapshots?.shipment, 'shipment');
    lines.push('출고 재고와 당시 제품 로트만 복원하고 작업완료로 돌아갑니다. 주문과 생산·원료 사용 기록은 유지됩니다.',
      '주문 삭제는 작업완료 상태에서 다시 눌러 별도로 승인해야 합니다.');
  } else {
    if (order.shippedOut && !done('shipment')) reasons.push('출고 취소를 먼저 완료해야 합니다.');
    const states = order.itemInventory;
    if (states !== undefined) {
      for (const state of Object.values(states).filter(row => row.applied)) {
        addSnapshot(state.production, 'production');
        addRaw(state.rawConsumedLots);
      }
    } else if (order.producedAt || order.status === 'DISPATCHED'
      || order.producedUnits?.length || order.autoBuilt?.length || order.rawConsumedLots?.length) {
      addSnapshot(order.inventorySnapshots?.production, 'production');
      addRaw(order.inventorySnapshots?.production?.rawConsumedLots ?? order.rawConsumedLots);
    }
    lines.push('당시 생산분과 원료·부자재 원복을 확인한 뒤 주문을 삭제합니다. 실패하면 주문을 보존합니다.');
  }
  const normalized = [...adjustments.reduce((map, row) => {
    const key = `${row.reason}:${row.itemId}`;
    map.set(key, { ...row, delta: fmt((map.get(key)?.delta ?? 0) + row.delta) });
    return map;
  }, new Map<string, RollbackPlan['adjustments'][number]>()).values()].filter(row => row.delta !== 0);
  lines.unshift(...normalized.map(row => `${row.reason}: ${row.name} ${row.delta > 0 ? '+' : '−'}${fmt(Math.abs(row.delta))}${row.unit}.`));
  let message = action === 'cancel-shipment' ? '출고를 취소하고 작업완료로 돌릴까요?' : '재고 원복을 확인하고 주문을 삭제할까요?';
  let confirmText = action === 'cancel-shipment' ? '출고 취소' : '원복 후 삭제';
  if (action === 'delete' && normalized.length === 0 && !hasRawEffect && reasons.length === 0 && progress?.state !== 'completed') {
    message = '주문을 삭제할까요?';
    confirmText = '주문 삭제';
    lines.splice(0, lines.length, '되돌릴 생산·원료·부자재 기록이 없어 재고는 변경하지 않고 주문만 삭제합니다. 실패하면 주문을 보존합니다.');
  }
  let retryable = false;
  if (progress) {
    const stock = { none: '재고 반영 없음', partial: '재고 일부 반영', complete: '재고 반영 완료', unknown: '재고 반영 여부 미확인' }[progress.inventoryApplied];
    lines.unshift(`${progress.action === 'cancel-shipment' ? '출고 취소' : '생산 원복·삭제'}: ${stock}.`,
      `완료 단계: ${completedStages.map(stage => ({ shipment: '출고 취소', production: '생산 취소', raw: '원료 복원', 'order-delete': '주문 삭제' })[stage]).join(', ') || '없음'}. 완료 단계는 다시 복원하지 않습니다.`);
    if (progress.error) lines.push(`중단 사유: ${progress.error}`);
    if (progress.state === 'processing') {
      message = '재고 처리 중입니다.';
      reasons.push('다른 상태 변경을 막고 저장된 처리 결과를 재조회하세요.');
    } else if (progress.state === 'completed') {
      message = progress.action === 'cancel-shipment' ? '출고 취소가 완료되었습니다.' : '주문 삭제가 완료되었습니다.';
      reasons.push(progress.action === 'cancel-shipment' ? '주문을 재조회하세요. 삭제는 별도의 사용자 승인으로 진행합니다.' : '완료 기록을 재조회하세요. 같은 작업을 다시 실행하지 않습니다.');
    } else {
      message = '재고 처리가 중단되었습니다. 주문을 보존합니다.';
      retryable = progress.state === 'failed' && progress.inventoryApplied === 'none'
        && completedStages.length === 0 && progress.retryable && progress.action === action && reasons.length === 0;
      if (retryable) { confirmText = '같은 작업 재시도'; lines.push('엔진이 허용한 동일 작업만 재시도하세요.'); }
      else reasons.push('부분완료 또는 미확인 상태는 처리 근거를 재조회하고 원인을 확인하세요. 자동 재개는 보장되지 않습니다.');
    }
  }
  const blockedReasons = [...new Set(reasons)];
  return { action: blockedReasons.length ? 'blocked' : action, allowed: blockedReasons.length === 0,
    ...(action === 'cancel-shipment' ? { nextStatus: 'DISPATCHED' as const } : {}),
    state: progress?.state ?? 'ready', message, subMessage: [...lines, ...blockedReasons].join('\n'),
    confirmText: blockedReasons.length ? '처리 상태 확인' : confirmText, blockedReasons,
    adjustments: normalized, completedStages, inventoryApplied: progress?.inventoryApplied ?? 'none', retryable };
}
