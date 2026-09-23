import type { AccountCode } from './types';

/** 표준 계정표로 옮긴 뒤 새 전표가 쓸 번호. */
export const STANDARD_ACCOUNT = {
  CASH: '102',
  FIXTURES: '122',
  VEHICLE: '124',
  MACHINERY: '126',
  BUILDING: '128',
  PREPAID: '133',
  DEPOSIT: '169',
  SALES_PRODUCT: '404',
  SALES_GOODS: '401',
  SALARY: '802',
  RETIREMENT: '806',
  WELFARE: '811',
  UTILITIES: '815',
  RENT: '819',
  INSURANCE: '821',
  FREIGHT: '824',
  FEES: '828',
  SUPPLIES_EXPENSE: '830',
  INTEREST: '931',
  WITHHOLDING: '257',
  ADVANCE_RECEIVED: '254',
  ACCRUED_EXPENSE: '275',
} as const;

/** 이번 이전에서 새로 보강하는 계정. 비품은 212→122 이전 때 만든다. */
export const STANDARD_ACCOUNT_ADDITIONS: AccountCode[] = [
  {
    id: `ac-${STANDARD_ACCOUNT.SUPPLIES_EXPENSE}`,
    code: STANDARD_ACCOUNT.SUPPLIES_EXPENSE,
    name: '소모품비',
    groupId: 'ag-sgna',
    type: '비용',
    normalBalance: 'debit',
    note: '짧게 쓰고 소모되는 문구·청소용품·소형도구. 오래 쓰는 물건은 122 비품을 사용.',
  },
];
