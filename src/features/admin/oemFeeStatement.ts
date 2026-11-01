import type { CompanyId, IssuedStatement } from '../../shared/types';
import { issueOemFeeVoucherCommand } from '../../shared/services/firebaseService';

export interface OemFeeStatementWrite {
  companyId: CompanyId;
  poId: string;
  perKg: number;
  statement: IssuedStatement;
}

/** Server assigns the shared 가공 number and commits voucher plus PO link together. */
export async function applyOemFeeStatement(input: OemFeeStatementWrite): Promise<string> {
  if (input.statement.companyId !== input.companyId) throw new Error('OEM 가공비 전표 회사가 일치하지 않습니다.');
  return issueOemFeeVoucherCommand({ poId: input.poId, perKg: input.perKg, statement: input.statement });
}
