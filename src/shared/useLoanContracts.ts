import { useEffect, useState } from 'react';
import type { CompanyId } from './types';
import type { LoanContract } from './loanLedger';
import { fetchWhere } from './services/firebaseService';

/** 신규 전표에서 대출을 고를 때만 조회한다. 회사가 바뀌면 이전 회사 목록을 즉시 비운다. */
export function useLoanContracts(companyId: CompanyId): LoanContract[] {
  const [loans, setLoans] = useState<LoanContract[]>([]);
  useEffect(() => {
    let active = true;
    setLoans([]);
    void fetchWhere<LoanContract>('loanContracts', 'companyId', companyId)
      .then(rows => { if (active) setLoans(rows); })
      .catch(() => { if (active) setLoans([]); });
    return () => { active = false; };
  }, [companyId]);
  return loans;
}
