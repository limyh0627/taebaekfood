import type {ReadonlyReturnOperation} from '../../admin/cashLedger';
import type {IssuedStatement,CompanyId,CashAccount,CashEntry,AccountCode,FixedCostTemplate,Partner,Settlement} from '../../../shared/types';

export interface Props {
  returnOperations?: readonly ReadonlyReturnOperation[];
  advanceStatements?: readonly IssuedStatement[];
  companyId: CompanyId;
  cashAccounts: CashAccount[];
  cashEntries: CashEntry[];
  accountCodes: AccountCode[];
  fixedCostTemplates?: FixedCostTemplate[];
  partners: Partner[];
  issuedStatements: IssuedStatement[];
  settlements: Settlement[];
  currentUser?: { id: string; name: string } | null;
  onAddCashAccount: (a: Omit<CashAccount, 'id'> & { id: string }) => void | Promise<unknown>;
  onUpdateCashAccount: (id: string, data: Partial<CashAccount>) => void | Promise<unknown>;
  onCorrectCashAccount?: (original: CashAccount, name: string, date: string, targetCurrentBalance: number) => Promise<unknown>;
  onAddCashEntry: (e: Omit<CashEntry, 'id'> & { id: string }) => void | Promise<unknown>;
  onDeleteCashEntry: (id: string, original: CashEntry) => void | Promise<unknown>;
  onAddSettlement: (s: Omit<Settlement, 'id'> & { id: string }) => void | Promise<unknown>;
  onDeleteSettlement: (id: string) => void | Promise<unknown>;
}
