import type {IssuedStatement,CashEntry,AccountCode,PaymentMethod,Partner,CompanyId} from '../../../shared/types';
import type {CashEditForm,CashEditLineDraft} from '../../../shared/cashEntryEdit';
import type {PayrollCashEdit,TransferCashEdit,PreparedTransferCashEdit} from '../../admin/cashMutationCommands';

export type CashModalMode =
  | { kind: '수금지불'; stmt: IssuedStatement }
  | { kind: '수정'; entry: CashEntry };

export interface SettleInput {
  amount: number;
  date: string;
  method: PaymentMethod;
  note: string;
  /** 'stmt' = 이 전표부터 갚음(상계를 붙인다) · 'partner' = 오래된 전표부터 */
  scope: 'stmt' | 'partner';
}

export interface Props {
  mode: CashModalMode;
  /** 미반영이 확인된 결제의 수정 입력은 원래 금액·일자로 시작한다. */
  initialSettle?: { amount: number; date: string };
  partners: Partner[];
  companyId: CompanyId;
  accountCodes: AccountCode[];
  /** 활성 통장만 */
  cashAccounts: { id: string; name: string; openingDate?: string; type?: '통장' | '현금' | '카드' }[];
  /** 고른 통장 — 창을 닫아도 기억해야 해서 밖이 쥔다 */
  accountId: string;
  onAccountId: (_id: string) => void;
  partnerBalances: Map<string, { receivable: number; payable: number }>;
  getBalance: (_s: IssuedStatement) => number;
  /** 그 사이 바뀌었을 수 있으니 저장 직전에 최신 전표를 다시 집는다 */
  latestStatement: (_id: string) => IssuedStatement | undefined;
  onClose: () => void;
  onSettle: (_stmt: IssuedStatement, _input: SettleInput) => void;
  payrollEdit?: PayrollCashEdit;
  transferEdit?: PreparedTransferCashEdit;
  onSaveEdit: (_entry: CashEntry, _form: CashEditForm, _lines: CashEditLineDraft[], _payroll?: PayrollCashEdit, _transfer?: TransferCashEdit) => void | Promise<void>;
  onDeleteEntry?: (_id: string) => void | Promise<void>;
  hasPendingRequest?: (_id: string) => boolean;
  onResumeEntry?: (_id: string) => Promise<unknown>;
  onAssignCashAccount?: (_entry: CashEntry, _accountId: string) => Promise<void>;
}
