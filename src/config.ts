/**
 * Flow-It ERP — 테넌트 기본 설정
 *
 * 다른 회사에 납품할 때는 이 파일의 값만 수정하면 됩니다.
 * Firestore settings/{companyId} 문서가 존재하면 해당 값이 우선 적용됩니다.
 */
import type { CompanyInfo } from './shared/types';

export const DEFAULT_COMPANY_INFO: CompanyInfo = {
  name: '태백식품',
  ceoName: '임기주',
  bizNo: '139-04-37157',
  bizType: '제조 도소매',
  bizItem: '참기름 외',
  address: '경기도 안산시 상록구 동막길 69-7',
  phone: '031-485-8270',
  fax: '031-485-8296',
  email: 'taebaekfood@naver.com',
  bankAccount: '농협 351-0526-3164-13 ; 임기주(태백식품)',
};
