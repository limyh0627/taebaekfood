import { rawHolderByName, rawLedgerKeys, type RawHolderItem } from './rawHolder';
import { stock3 as kg3 } from './orderProductionDomain';
import type { RawInventoryCommand } from './rawInventoryCore';
import type { RawPrepareOptions } from './rawInventoryPrepare';
import type { CompanyId, LotMixSetting } from './rawLot';

export type RawMixFields = { mixEnabled?: boolean; mixTopPercent?: number; mixLotRatios?: { lotId: string; percent: number }[] };

/** 새 로트별 혼합비를 우선하고, 예전 상위 2개 설정도 계속 읽는다. */
export function lotMixSettingOf(item: RawMixFields): LotMixSetting | undefined {
  if (!item.mixEnabled) return undefined;
  const ratios = (item.mixLotRatios ?? []).filter(row => row.lotId && Number(row.percent) > 0);
  // 새 형식이 한 번이라도 저장됐으면 2개 이상 고르기 전에는 혼합하지 않는다.
  // 필드 자체가 없는 옛 자료만 예전 상위 2개 설정으로 호환한다.
  if (item.mixLotRatios !== undefined) return ratios.length >= 2 ? { ratios } : undefined;
  return { topPercent: item.mixTopPercent ?? 50 };
}
export function selectOrderRawUsageNames(physicalUsage: Record<string, number>, ledgerOnlyUsage: Record<string, number> = {}) {
    const physicalNames = Object.keys(physicalUsage).filter(raw => kg3(physicalUsage[raw]) > 0);
    const ledgerOnlyNames = Object.keys(ledgerOnlyUsage).filter(raw => kg3(ledgerOnlyUsage[raw]) > 0);
    return { physicalNames, ledgerOnlyNames };
}

export function buildOrderRawCommands<T extends RawHolderItem & RawMixFields>(input: {
  orderId: string; physicalUsage: Record<string, number>; ledgerOnlyUsage?: Record<string, number>;
  attempt: number; lineId?: string; allItems: T[]; companyId: CompanyId; businessDate: string;
  customerName: string; actorName?: string; names: ReturnType<typeof selectOrderRawUsageNames>;
}) {
    const { physicalUsage, attempt, lineId, allItems, companyId, businessDate, customerName, actorName, names } = input;
    const ledgerOnlyUsage = input.ledgerOnlyUsage ?? {};
    const { physicalNames, ledgerOnlyNames } = names;
    const effectiveAt = `${businessDate}T12:00:00+09:00`;
    const commands: {command: RawInventoryCommand; options?: RawPrepareOptions}[] = [];
    const holderByMaterial = new Map<string, T>();

    for (const material of physicalNames) {
      const rawItem = rawHolderByName(allItems, material, companyId);
      if (!rawItem) {
        throw new Error(`원료 차감 중단: ${companyId} 회사의 '${material}' 원료 품목을 찾을 수 없다 (주문 ${input.orderId})`);
      }
      holderByMaterial.set(material, rawItem);
      const operationId = `production:${input.orderId}${lineId ? `:${lineId}` : ''}:a${attempt}:${rawItem.id}`;
      commands.push({
        command: {
          operationId,
          ...rawLedgerKeys(rawItem),
          materialSnapshot: material,
          effectiveAt,
          ...(actorName ? { actorName } : {}),
          source: { type: 'production', id: input.orderId },
          kind: 'consume',
          kg: kg3(physicalUsage[material]),
          ...(lotMixSettingOf(rawItem) ? { mix: lotMixSettingOf(rawItem) } : {}),
        },
        options: {
          newLotId: `lot-${operationId}`,
          carryOverLotId: `carry-${operationId}`,
          legacy: {
            note: `자동: ${customerName}`,
            type: 'auto', orderId: input.orderId,
            ...(actorName ? { addedBy: actorName } : {}),
          },
        },
      });
    }

    for (const material of ledgerOnlyNames) {
      const rawItem = rawHolderByName(allItems, material, companyId);
      if (!rawItem) {
        throw new Error(`임가공 원장 기록 중단: ${companyId} 회사의 '${material}' 원료 품목을 찾을 수 없다 (주문 ${input.orderId})`);
      }
      holderByMaterial.set(material, rawItem);
      // 실제 차감 명령과 같은 원료가 섞여도 작업 번호가 겹치지 않는다.
      const operationId = `production-ledger:${input.orderId}${lineId ? `:${lineId}` : ''}:a${attempt}:${rawItem.id}`;
      commands.push({
        command: {
          operationId,
          ...rawLedgerKeys(rawItem),
          materialSnapshot: material,
          effectiveAt,
          ...(actorName ? { actorName } : {}),
          source: { type: 'oem', id: input.orderId },
          kind: 'ledger-consume',
          kg: kg3(ledgerOnlyUsage[material]),
        },
        options: {
          legacy: {
            note: `자동(임가공): ${customerName}`,
            type: 'auto', orderId: input.orderId,
            ...(actorName ? { addedBy: actorName } : {}),
          },
        },
      });
    }


 return {commands,holderByMaterial,companyId,customerName};
}
