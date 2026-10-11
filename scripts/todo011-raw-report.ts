import { companyOf, type CompanyId, type Item, type RawMaterialEntry } from '../src/shared/types';
import type { RawInventoryState } from '../src/shared/rawInventoryCore';
import { authoritativeLedgerBalanceKg } from '../src/shared/rawLedgerBalance';
import { DENSITY } from '../src/constants/formula';

/** 기존 감사의 저장 kg 네 축 계산. 실측 판정이나 새로운 환산은 하지 않는다. */
export function rawInventoryAxes(companyId: CompanyId, states: RawInventoryState[], items: Item[], entries: RawMaterialEntry[]) {
  const holders = new Map(items.filter(item => companyOf(item) === companyId).map(item => [item.id, item]));
  const ledger = entries.filter(entry => companyOf(entry) === companyId);
  return states.filter(state => state.companyId === companyId).map(state => {
    const stateLedger = ledger.filter(entry => entry.rawItemId === state.rawItemId || (!entry.rawItemId && entry.material === state.materialSnapshot));
    const holder = holders.get(state.rawItemId);
    const lotTotal = state.activeLots.reduce((sum, lot) => sum + lot.kgRemaining, 0);
    const ledgerBalance = authoritativeLedgerBalanceKg(stateLedger, DENSITY[state.materialSnapshot] ?? 1);
    // 기존 감사의 미기록 stock 기본값 0과 Number 변환 정책을 그대로 유지한다.
    const holderStock = holder ? Number(holder.stock ?? 0) : null;
    return { state, holder, lotTotal, ledgerBalance, holderStock, ledgerRows: stateLedger.length,
      lotGap: state.stockKg - lotTotal, ledgerGap: state.stockKg - ledgerBalance,
      itemGap: holderStock === null ? null : holderStock - state.stockKg };
  });
}
/** 감사 계산값을 보고서에 표시한다. 미기록/비유한 품목 값은 감사의 기본값과 구분한다. */
export function rawInventoryReport(companyId: CompanyId, states: RawInventoryState[], items: Item[], entries: RawMaterialEntry[]) {
  const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
  return rawInventoryAxes(companyId, states, items, entries).map(axis => {
    const { state, holder } = axis;
    const itemKg = finite(holder?.stock);
    return { stateId: state.id, rawItemId: state.rawItemId, material: state.materialSnapshot, unit: 'kg' as const,
      stateKg: finite(state.stockKg), lotKg: finite(axis.lotTotal), itemKg, ledgerKg: finite(axis.ledgerBalance),
      stateMinusLotsKg: finite(axis.lotGap), stateMinusItemKg: itemKg === null ? null : finite(state.stockKg - itemKg),
      stateMinusLedgerKg: finite(axis.ledgerGap),
      ledgerRows: axis.ledgerRows, itemPresent: !!holder, physicalStatus: '실측 미확인' as const,
      note: axis.ledgerRows ? '현재 전산 기록 대조; 실측 증명 아님' : '원장 미기록: 기존 계산의 0은 실측 잔량 증명 아님' };
  });
}
export function rawInventoryReportMarkdown(rows: ReturnType<typeof rawInventoryReport>): string[] {
  const text = (value: unknown) => value === null || value === undefined ? '미확인' : String(value).replace(/[|\r\n]/g, ' ');
  return ['### 원료 전산 네 축 대조', '', '- 모두 저장 kg 기준이며 현재 기록 비교입니다. 실측 증빙은 입력되지 않았습니다.',
    '| 원료 | 상태 kg | 로트 kg | 품목 kg | 원장 kg | 상태−로트 | 상태−품목 | 상태−원장 | 확인 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---|',
    ...rows.map(row => `| ${[row.material,row.rawItemId].map(text).join(' · ')} | ${[row.stateKg,row.lotKg,row.itemKg,row.ledgerKg,row.stateMinusLotsKg,row.stateMinusItemKg,row.stateMinusLedgerKg].map(text).join(' | ')} | ${row.physicalStatus}; ${row.note} |`), ''];
}
/** 원료 전용 파일은 전산 네 축만 읽는다. 실측값을 추정하거나 DB를 초기화하지 않는다. */
export function auditRawInventoryFile(value: unknown) {
  const object = (row: unknown): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row);
  if (!object(value) || !['taebaek', 'punghoe'].includes(String(value.companyId)) || value.complete !== true
    || typeof value.snapshotDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.snapshotDate)
    || !Number.isFinite(Date.parse(value.snapshotDate)) || new Date(value.snapshotDate).toISOString().slice(0, 10) !== value.snapshotDate) {
    throw new Error('회사·스냅샷 날짜·전체 자료 수집 확인이 필요합니다.');
  }
  for (const key of ['rawInventories', 'items', 'rawMaterialLedger']) {
    const rows = value[key];
    if (!Array.isArray(rows) || rows.some(row => !object(row) || (row.companyId != null && !['taebaek', 'punghoe'].includes(String(row.companyId))))) {
      throw new Error(`${key}: 회사가 확인된 전체 배열이 필요합니다.`);
    }
  }
  const states = value.rawInventories as RawInventoryState[];
  if (states.some(state => !state.id || !state.rawItemId || !['taebaek', 'punghoe'].includes(state.companyId)
    || typeof state.materialSnapshot !== 'string' || !Array.isArray(state.activeLots)
    || state.activeLots.some(lot => !object(lot) || typeof lot.kgRemaining !== 'number'))) {
    throw new Error('rawInventories: 상태·로트 원문이 불완전합니다.');
  }
  const rows = rawInventoryReport(value.companyId as CompanyId, states, value.items as Item[], value.rawMaterialLedger as RawMaterialEntry[]);
  return { companyId: value.companyId, snapshotDate: value.snapshotDate,
    completenessBasis: '전체 자료 수집 성공이라는 호출자 확인값; 내용 진실/실측 증명 아님',
    scope: '현재 원료 저장 네 축 대조; 과거 종료재고 및 실측 증명 아님', rows };
}