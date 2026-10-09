import {runFinancialOpening} from './financialOpeningCommands';
import {today} from '../day';
import type {CashAccount,CompanyId} from '../types';

export async function updateCashAccountOpening(companyId: CompanyId, original: CashAccount, name: string, newDate: string, targetBalance: number, asOf = today()): Promise<void> {
 await runFinancialOpening(companyId,{kind:'account-update',original,name,newDate,targetBalance,asOf});
}
