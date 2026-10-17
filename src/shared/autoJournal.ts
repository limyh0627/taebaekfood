/**
 * 자동 분개 — 전표/자금기록을 복식부기 분개(JournalEntry)로 변환한다. 순수 함수, DB 안 건드림.
 *
 *   사용자는 거래처·품목·금액·계정만 입력하고, 여기서 상대 계정(채권·채무·부가세·현금)을 자동으로 채운다.
 *   상대 계정은 전표 종류 + 과세여부 + 결제방식으로 정해진다(추측 아님, 전표에 있는 정보).
 *   차/대 위치는 계정의 normalBalance가 정한다(journal.ts).
 *
 * 매핑 규칙(설계 로컬전용/docs/복식부기-설계.md §4):
 *   매출  (차) 외상매출금 [+현금]   (대) 매출계정들 + 부가세예수금
 *   매입  (차) 매입계정들 + 부가세대급금   (대) 외상매입금 [또는 현금]
 */
export {AR,AP,VAT_PAYABLE,VAT_RECEIVABLE,OTHER_PAYABLE,TRADE_PURCHASE_CODES,payableCodeFor,isPayableCode,BANK,INVENTORY,PURCHASE,settlementAccountCode} from '../features/financials/domain/journalSupport';
export {journalizeStatement} from '../features/financials/domain/statementJournal';
export type {AutoJournalOptions} from '../features/financials/domain/statementJournal';
export {journalizeCashEntry,journalizeTransfer} from '../features/financials/domain/cashJournal';
export {journalizeInventory,buildOpeningEntry} from '../features/financials/domain/balanceJournal';
export type {OpeningBalance} from '../features/financials/domain/balanceJournal';
