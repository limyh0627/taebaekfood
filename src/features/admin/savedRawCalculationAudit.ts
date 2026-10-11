import type { Order } from '../../shared/types';
import { companyOf } from '../../shared/types';
import type { IntegrityIssue, IntegritySeverity, LedgerMovement } from './dataIntegrityAudit';

// 기존 감사의 정의를 한 곳으로 옮긴다. 생산 엔진의 3자리 저장 정밀도를 그대로 쓴다.
export const kg3 = (n: number) => Math.round(n * 1000) / 1000;
export const KG_EPS = 0.01;

/** 저장 계산 결과만 같은 생산 이벤트의 원문과 대조한다. 현재 배합·주문 수량은 계산하지 않는다. */
export function auditSavedRawCalculation(order: Order, ledgerRows: readonly LedgerMovement[], inRange: (date?: string) => boolean): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const seen = new Map<string, string>();
  const events = Object.entries(order.itemInventory ?? {}).map(([lineId, state]) => ({
    key: lineId, snap: state.production, lineId, attempt: state.attempt, cancelled: !state.applied,
    validLine: state.lineId === lineId && order.items.some(line => line.lineId === lineId && line.itemId === state.itemId),
  }));
  if (order.inventorySnapshots?.production) events.push({ key: 'whole', snap: order.inventorySnapshots.production,
    lineId: '', attempt: 0, cancelled: !order.producedAt, validLine: true });
  for (const event of events) {
    const snap = event.snap;
    if (!snap || !inRange(snap.capturedAt)) continue;
    const emit = (suffix: string, severity: IntegritySeverity, title: string, detail: string) => issues.push({
      id: `raw-calculation:${order.id}:${event.key}:${suffix}`, area: '작업완료·BOM', severity, title,
      detail: `${event.cancelled ? '취소된 생산의 당시 기록. ' : ''}${detail}`, date: snap.capturedAt, reference: order.cardNo || order.id,
    });
    const evidence = snap.rawCalculationEvidence;
    if (evidence === undefined) {
      emit('unconfirmed', 'info', '당시 원료 계산 근거 미기록', '현재 배합으로 과거 기대량을 추정하지 않습니다.');
      continue;
    }
    if (snap.rawConsumedLots === undefined || snap.rawLedgerIds === undefined) {
      emit('unconfirmed', 'warning', '원료 계산과 생산 원장 연결 미확인', '생산 trace나 원장 문서 목록이 없어 미기록을 사용 0으로 해석하지 않습니다.');
      continue;
    }
    const traces = snap.rawConsumedLots;
    // 같은 작업번호라도 저장 kg가 달라진 미러를 숨기지 않는다. 순서 차이만 정규화한다.
    const rowsSignature = (rows: readonly object[]) => rows.map(row => JSON.stringify(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))).sort();
    const signature = JSON.stringify([rowsSignature(evidence), rowsSignature(traces), [...snap.rawLedgerIds].sort()]);
    const operations = [...new Set(traces.map(trace => trace.operationId).filter((id): id is string => !!id))];
    if (operations.length > 0 && operations.every(id => seen.has(id))) {
      if (operations.every(id => seen.get(id) === signature)) {
        emit('mirror', 'info', '동일 생산 원료 이력의 중복 스냅샷', '전체·품목 기록을 합산하지 않습니다.');
      } else {
        emit('unconfirmed', 'warning', '동일 생산 작업의 스냅샷 원문 불일치', '같은 작업번호의 계산·trace·원장 문서 목록이 달라 동일 미러로 제외하지 않습니다.');
      }
      continue;
    }
    if (operations.some(id => seen.has(id))) {
      emit('unconfirmed', 'warning', '일부만 겹치는 생산 원료 스냅샷', '같은 작업과 별도 작업이 섞여 있어 계산 결과를 나눠 비교할 수 없습니다.');
      continue;
    }
    if (!event.validLine || evidence.some(row => !row.raw || !row.productId || !Number.isFinite(row.kg) || row.kg < 0)
      || traces.some(trace => !trace.operationId || !trace.rawItemId || !trace.material || !Number.isFinite(trace.kg) || trace.kg < 0)) {
      emit('unconfirmed', 'warning', '원료 계산 연결 근거 미확인', '품목 줄·원료 ID·작업 번호·저장 kg 중 필요한 원문이 없거나 잘못되었습니다.');
      continue;
    }
    const expected = new Map<string, number>();
    evidence.forEach(row => expected.set(row.raw, (expected.get(row.raw) ?? 0) + row.kg));
    const traceByRaw = new Map<string, number>();
    const groups = new Map<string, typeof traces>();
    traces.forEach(trace => {
      traceByRaw.set(trace.material, (traceByRaw.get(trace.material) ?? 0) + trace.kg);
      const id = trace.operationId!;
      groups.set(id, [...(groups.get(id) ?? []), trace]);
    });
    let linked = true;
    const ledgerByRaw = new Map<string, number>();
    for (const [operationId, group] of groups) {
      const first = group[0];
      const prefix = first.ledgerOnly ? 'production-ledger' : 'production';
      const base = `${prefix}:${order.id}${event.lineId ? `:${event.lineId}` : ''}:a`;
      const wholeAttempt = operationId.slice(base.length).split(':')[0];
      const attempt = event.lineId ? event.attempt : Number(wholeAttempt);
      const exactOperation = `${base}${attempt}:${first.rawItemId}`;
      const rows = ledgerRows.filter(row => row.operationId === operationId);
      const ledger = rows[0];
      const sameTrace = group.every(trace => trace.rawItemId === first.rawItemId && trace.material === first.material
        && !!trace.ledgerOnly === !!first.ledgerOnly && !!trace.ledgerId && trace.ledgerId === ledger?.id);
      if (!Number.isSafeInteger(attempt) || attempt < 1 || operationId !== exactOperation || !sameTrace || rows.length !== 1
        || !ledger || companyOf(ledger) !== companyOf(order) || ledger.rawItemId !== first.rawItemId
        || ledger.source?.id !== order.id || ledger.source?.type !== (first.ledgerOnly ? 'oem' : 'production')
        || ledger.kind !== (first.ledgerOnly ? 'ledger-consume' : 'consume') || ledger.materialSnapshot !== first.material
        || !Number.isFinite(ledger.reportedDeltaKg) || !Number.isFinite(ledger.appliedDeltaKg)
        || !snap.rawLedgerIds?.includes(ledger.id)) {
        linked = false; break;
      }
      ledgerByRaw.set(first.material, (ledgerByRaw.get(first.material) ?? 0) - ledger.reportedDeltaKg!);
    }
    if (!linked) {
      emit('unconfirmed', 'warning', '원료 계산과 생산 원장 연결 미확인', '회사·주문·품목 이벤트·원료·원장 문서가 정확히 연결되는 기록만 비교합니다.');
      continue;
    }
    operations.forEach(id => seen.set(id, signature));
    for (const raw of new Set([...expected.keys(), ...traceByRaw.keys(), ...ledgerByRaw.keys()])) {
      const calculationKg = kg3(expected.get(raw) ?? 0), traceKg = kg3(traceByRaw.get(raw) ?? 0), ledgerKg = kg3(ledgerByRaw.get(raw) ?? 0);
      if (Math.abs(calculationKg - traceKg) > KG_EPS || Math.abs(calculationKg - ledgerKg) > KG_EPS) emit(raw, 'error',
        '저장 원료 계산과 생산 기록 불일치', `${raw}: 당시 계산 ${calculationKg}kg / 생산 trace ${traceKg}kg / 원장 reported 사용 ${ledgerKg}kg. 실측·현재 재고 차이로 해석하지 않습니다.`);
    }
  }
  return issues;
}
