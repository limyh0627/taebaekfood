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
