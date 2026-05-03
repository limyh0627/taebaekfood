/**
 * Flow-It ERP — 테넌트 기본 설정
 *
 * 다른 회사에 납품할 때는 이 파일의 값만 수정하면 됩니다.
 * Firestore settings/company 문서가 존재하면 해당 값이 우선 적용됩니다.
 */
import type { CompanyInfo } from './shared/types';

export const DEFAULT_COMPANY_INFO: CompanyInfo = {
  name: '태백식품',
  ceoName: '',
  bizNo: '',
  bizType: '제조업',
  bizItem: '식품',
  address: '',
  phone: '',
  fax: '',
  email: '',
  adminPassword: '0000',
};
