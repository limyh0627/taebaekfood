import {AP,OTHER_PAYABLE} from '../../../shared/autoJournal';

/*
 * **거래처 잔액은 251·253을 한 덩어리로 본다.**
 * 둘 다 그 거래처에 갚을 돈이다 — 재무상태표에서만 매입채무와 미지급금으로 갈린다.
 * 여기서 251만 보면, 세금·경비를 외상으로 진 채무가 거래처원장에서 통째로 사라진다.
 */
export const PAYABLES = [AP, OTHER_PAYABLE];
export const isPay = (c: string | undefined) => c === AP || c === OTHER_PAYABLE;
