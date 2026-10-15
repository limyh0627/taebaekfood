import { defaultShipMethod } from './channelStyle';
import type { OrderSource, Partner, PartnerType, ShipMethod } from './types';

export function isShipMethod(value: unknown): value is ShipMethod {
  return value === '배송' || value === '화물' || value === '수령' || value === '택배';
}

/** 배송지가 달라졌다고 다른 배송지의 설정을 빌리지 않는다. 미설정 자료는 기존 채널 동작을 보존한다. */
export function resolveDefaultShipMethod(
  partner?: Pick<Partner, 'type' | 'defaultShipMethod' | 'shipTos'>,
  shipToId?: string,
  source?: OrderSource,
): ShipMethod {
  const shipTo = shipToId ? partner?.shipTos?.find(row => row.id === shipToId && !row.archived) : undefined;
  if (isShipMethod(shipTo?.defaultShipMethod)) return shipTo.defaultShipMethod;
  if (isShipMethod(partner?.defaultShipMethod)) return partner.defaultShipMethod;
  return defaultShipMethod(source ?? partner?.type);
}

/** 분류가 없던 옛 거래처는 기존 매출처 호환을 유지한다. */
export function isShippingPartner(partnerType: PartnerType | undefined): boolean {
  return partnerType === undefined || partnerType === '매출처' || partnerType === '매출+매입처';
}
