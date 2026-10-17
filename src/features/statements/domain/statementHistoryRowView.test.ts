import { describe, expect, it } from 'vitest';
import { statementHistoryRowView } from './statementHistoryRowView';
import type { TimelineRow } from '../../../shared/timelineRows';

const names = new Map([['201', '차입금'], ['951', '이자비용']]);

describe('전표 목록 공통 표시값', () => {
  it('자금전표의 쪼갠 계정과 담당자를 한 번만 해석한다', () => {
    const row = { kind: 'cash', date: '2026-09-15', dateKey: '2026-09-15', ts: '', dir: '출금', amount: 1100,
      partnerName: '태백은행', cumul: 300, entry: { id: 'cash-1', date: '2026-09-15', cashAccountId: 'bank', dir: '출금', amount: 1100,
        createdAt: '2026-09-15T10:00:00', createdBy: '관리자', lines: [{ accountCode: '201', amount: 1000, note: '원금' }, { accountCode: '951', amount: 100, note: '이자' }] } } as TimelineRow;
    expect(statementHistoryRowView(row, names)).toMatchObject({
      key: 'cash-1', label: '출금', owner: '관리자', partner: '태백은행',
      detail: '원금 차입금 1,000 · 이자 이자비용 100', amount: 1100, cumulative: 300,
    });
  });

  it('수금 행 열쇠에는 방향을 넣어 같은 상계의 두 줄을 가른다', () => {
    const row = { kind: 'pay', paymentId: 'offset-1', partnerId: 'p1', partnerName: '거래처', stmtType: '매출',
      offset: true, date: '2026-09-15', amount: 500, cumul: 0, dateKey: '', ts: '', src: {} } as TimelineRow;
    expect(statementHistoryRowView(row, names)).toMatchObject({ key: 'offset-1__매출', label: '미수상계' });
  });
});

import { createStatementOwnerResolver, type StatementOwnerEmployee } from './statementHistoryRowView';
import type { IssuedStatement, CashEntry } from '../../../shared/types';
const ownerEmployees: StatementOwnerEmployee[] = [
 { id: 'staff-a', authUid: 'emp_a', name: '가직원', companyId: 'taebaek' },
 { id: 'staff-b', authUid: 'emp_b', name: '나직원', companyId: 'punghoe' },
 { id: 'old', authUid: 'emp_old', name: '퇴사직원' },
 { id: 'dup1', authUid: 'emp_dup', name: '동명이름' }, { id: 'dup2', authUid: 'emp_dup', name: '다른이름' },
];
it('실제 회사별 직원 ID와 authUid만 이름으로 해석하고 충돌·미확인은 추정하지 않는다', () => {
 const resolve = createStatementOwnerResolver(ownerEmployees, 'taebaek');
 expect(resolve('staff-a')).toBe('가직원'); expect(resolve('emp_a')).toBe('가직원'); expect(resolve('emp_old')).toBe('퇴사직원');
 expect(resolve('emp_b')).toBe('이름 미확인'); expect(resolve('emp_dup')).toBe('이름 미확인'); expect(resolve('emp_absent')).toBe('이름 미확인'); expect(resolve('옛날 담당자')).toBe('옛날 담당자'); expect(resolve(undefined)).toBeUndefined(); expect(resolve('')).toBe('');
 expect(createStatementOwnerResolver(ownerEmployees, 'punghoe')('emp_a')).toBe('이름 미확인'); expect(createStatementOwnerResolver(ownerEmployees, 'punghoe')('emp_b')).toBe('나직원');
});
it('전표·자금·수금 표시가 같은 담당자 해석을 사용하고 저장된 감사 원문을 바꾸지 않는다', () => {
 const statement: IssuedStatement = { id: 's', companyId: 'taebaek', type: '매출', tradeDate: '2026-10-18', issuedAt: '', partnerId: 'p', partnerName: '합성', orderId: '', docNo: '261018-001', totalSupply: 100, totalTax: 0, totalAmount: 100, items: [], createdBy: 'emp_a' };
 const cash: CashEntry = { id: 'c', companyId: 'taebaek', date: '2026-10-18', dir: '입금', amount: 100, cashAccountId: 'bank', createdAt: '', createdBy: 'emp_a' };
 const rows: TimelineRow[] = [{ kind: 'stmt', data: statement, dateKey: '', ts: '' }, { kind: 'cash', entry: cash, dir: '입금', amount: 100, date: '2026-10-18', dateKey: '', ts: '' }, { kind: 'pay', entry: cash, paymentId: 'c', partnerId: 'p', partnerName: '합성', stmtType: '매출', date: '2026-10-18', amount: 100, cumul: 0, dateKey: '', ts: '', src: statement }];
 const before = JSON.stringify(rows), resolve = createStatementOwnerResolver(ownerEmployees, 'taebaek');
 for (const row of rows) expect(statementHistoryRowView(row, names, undefined, resolve).owner).toBe('가직원'); expect(JSON.stringify(rows)).toBe(before);
});
