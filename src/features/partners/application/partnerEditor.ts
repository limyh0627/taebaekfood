import type { Partner } from '../../../shared/types';
import { partnerEditPatch, type PartnerEditPatch } from '../../../shared/partnerEditCommand';
/** 표시 기본값을 넣기 전 최초 선택 원문을 기준으로 공개 필드만 비교한다. */
export function buildPartnerEditPatch(initial: Partner, form: Partner): PartnerEditPatch {
    if (initial.id !== form.id)
        throw Error('처음 선택한 거래처가 바뀌었습니다. 다시 열어 주세요.');
    return partnerEditPatch(initial as unknown as Record<string, unknown>, form as unknown as Record<string, unknown>);
}
