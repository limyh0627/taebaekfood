import { deleteField } from 'firebase/firestore';
import { setDocument, subscribeToDocument } from './services/firebaseService';
import type { CompanyId } from './types';
import { companySettingDocId, companySettingPatch } from './companySettings';

/**
 * **배송 오전·오후를 아는 곳은 여기 하나다.**
 *
 * 값은 `settings/{companyId}__deliveryOrdering` 문서에 주문id → '오전'|'오후' 로 담긴다.
 * 같은 문서에 배송 차례(`ordering`)도 같이 들어 있어서, **한쪽을 쓸 때 다른 쪽을 날리면 안 된다.**
 * 그래서 쓰는 길을 여기로 모은다(2026-09-12 사장님: "출고예정일 우측에 오전 오후 설정하는것도 둬").
 *
 * **칸이 없으면 '미정'이다.** 금일 배송순서 화면은 미정을 오전 자리에 세우지만,
 * 주문 수정 창은 정한 적이 없다는 뜻으로 `-` 라고 적는다 — 사장님이 그렇게 보길 원하셨다.
 */
export type DeliveryTimeSlot = '오전' | '오후';

export interface DeliveryOrderingDoc {
  ordering?: string[];
  timeSlots?: Record<string, DeliveryTimeSlot>;
}

export const subscribeDeliveryOrdering = (companyId: CompanyId, callback: (doc: DeliveryOrderingDoc | null) => void) =>
  subscribeToDocument<DeliveryOrderingDoc>('settings', companySettingDocId(companyId, 'deliveryOrdering'), callback);

/**
 * 한 주문의 오전·오후를 정한다. `null` 이면 **미정으로 되돌린다**(칸 자체를 지운다).
 *
 * `setDocument` 는 merge 로 쓰므로 `ordering` 과 다른 주문의 값은 그대로 남는다.
 * 미정은 빈 문자열이 아니라 **칸을 지우는 것**이다 — 빈 값을 남기면 읽는 쪽이 '오전'과
 * 구분하려고 또 따져야 한다.
 */
export const saveDeliveryTimeSlot = (companyId: CompanyId, orderId: string, slot: DeliveryTimeSlot | null) =>
  setDocument('settings', companySettingDocId(companyId, 'deliveryOrdering'), companySettingPatch(companyId, {
    timeSlots: { [orderId]: slot ?? deleteField() },
  }));
