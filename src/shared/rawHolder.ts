/**
 * **원료 홀더를 고르는 자리는 여기 하나다.**
 *
 * 인수인계.md "연결은 이름이 아니라 열쇠(id)로 건다".
 *
 * 여태 열한 곳이 각자 `allItems.find(i => baseRawName(i.name) === 원료명)` 으로
 * **이름을 견줘 첫 항목을 집었다.** 두 가지가 터진다.
 *
 *   · 이름이 **바뀌면** 연결이 소리 없이 끊긴다. 오류도 안 나고 그냥 못 찾는다.
 *   · 이름이 **겹치면** 먼저 걸리는 쪽을 집는다. 태백 작업이 풍회 재고를 깎는다.
 *     참깨·깻묵이 실제로 두 회사에 다 있다.
 *
 * 그래서 이 파일의 규칙은 하나다 — **회사를 알면 그 회사 것만 고른다.**
 * 그 회사에 홀더가 없으면 **아무것도 안 돌려준다.** 남의 회사 것으로 대신하지 않는다.
 * (예전 `rawLotTarget` 의 `?? holders[0]` 이 그 사고를 냈다.)
 *
 * 열쇠(`rawItemId`)를 이미 아는 자리는 이름을 거치지 말고 [byId](#byId) 를 쓴다.
 */
import type { CompanyId, Item } from './types';
import { companyOf, TAEBAEK } from './types';
import { isBulkItem } from './itemTaxonomy';
import { baseRawName } from '../constants/formula';

/** 재고를 들고 있는 벌크 홀더인가. 판정 근거는 `subtype==='벌크'` 하나다(itemTaxonomy). */
export const isRawHolder = (i: Item | undefined): boolean =>
  !!i && isBulkItem(i) && !i.phantom && !i.archived;

/**
 * 열쇠로 곧장 고른다 — **이것이 기본이다.**
 * 회사를 같이 넘기면 그 회사 것인지도 확인한다(다른 회사면 `undefined`).
 */
export function rawHolderById(
  allItems: readonly Item[], rawItemId: string | undefined, companyId?: CompanyId,
): Item | undefined {
  if (!rawItemId) return undefined;
  const hit = allItems.find(i => i.id === rawItemId);
  if (!hit || !isRawHolder(hit)) return undefined;
  if (companyId && companyOf(hit) !== companyId) return undefined;
  return hit;
}

/**
 * 이름으로 고른다 — **열쇠를 모를 때만.** 옛 데이터가 이름밖에 안 들고 있어 아직 필요하다.
 *
 * @param companyId 어느 회사 창고인가. **넘기면 그 회사 것만 고른다** — 없으면 `undefined`.
 *                  안 넘기면 태백을 먼저 보고, 태백에도 없으면 홀더가 하나뿐일 때만 그것을 준다
 *                  (둘 이상이면 고르지 않는다 — 아무거나 집던 게 사고였다).
 */
export function rawHolderByName(
  allItems: readonly Item[], material: string, companyId?: CompanyId,
): Item | undefined {
  const want = baseRawName(material ?? '');
  if (!want) return undefined;
  const holders = allItems.filter(i => isRawHolder(i) && baseRawName(i.name ?? '') === want);
  if (holders.length === 0) return undefined;
  if (companyId) return holders.find(i => companyOf(i) === companyId);
  const 태백 = holders.find(i => companyOf(i) === TAEBAEK);
  if (태백) return 태백;
  return holders.length === 1 ? holders[0] : undefined;
}

/**
 * 열쇠를 먼저 보고, 없으면 이름으로 — 옛 기록을 읽는 자리용.
 * 새로 쓰는 곳은 `rawHolderById` 만 쓴다.
 */
export function resolveRawHolder(
  allItems: readonly Item[],
  { rawItemId, material, companyId }: { rawItemId?: string; material?: string; companyId?: CompanyId },
): Item | undefined {
  return rawHolderById(allItems, rawItemId, companyId)
    ?? (material ? rawHolderByName(allItems, material, companyId) : undefined);
}

/**
 * 실제 원장 줄에 **반드시 같이 박는 열쇠.**
 * 이걸 안 박으면 그 줄은 나중에 어느 회사·어느 품목 것인지 이름으로 되짚어야 한다.
 */
export const rawLedgerKeys = (holder: Item): { companyId: CompanyId; rawItemId: string } => ({
  companyId: companyOf(holder),
  rawItemId: holder.id,
});
