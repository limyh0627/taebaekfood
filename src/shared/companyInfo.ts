import type { CompanyInfo } from './types';

export const TAEBAEK_BANK_ACCOUNT = '농협 351-0526-3164-13 ; 임기주(태백식품)';

/** 옛 태백식품 설정에는 계좌 필드가 없으므로 저장 전에도 확정된 계좌를 쓴다. */
export const bankAccountOf = (company?: Pick<CompanyInfo, 'bizNo' | 'bankAccount'> | null): string =>
  company?.bankAccount?.trim() || (company?.bizNo === '139-04-37157' ? TAEBAEK_BANK_ACCOUNT : '');
