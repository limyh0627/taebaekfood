import {usePartnerEditor, type PartnerEditorOptions} from '../../partners/hooks/usePartnerEditor';
/** 거래처 수정의 최초 원문·요청 보관·검사·중단 수명을 그대로 사용한다. */
export function useOemConditions(options:PartnerEditorOptions){ return usePartnerEditor(options); }
