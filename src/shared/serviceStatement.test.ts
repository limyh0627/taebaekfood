import { describe, expect, it } from 'vitest';
import { serviceStatementErrors } from './serviceStatement';
import type { PartnerItem } from './types';

const items = [{ id: 'fee', type: 'service' }, { id: 'oil', type: 'product' }];
const line = { itemId: 'fee', name: '기장료', price: 11000 };
const link = (over: Partial<PartnerItem> = {}) => ({ id: 'fee_p_in', itemId: 'fee', partnerId: 'p', Direction: 'in',
  price: 11000, taxType: '과세', Account_Code: '828', ...over } as PartnerItem);

describe('용역 전표 거래조건', () => {
  it('매입 방향 연결의 단가·과세·계정이 명시되면 품목 줄로 발행할 수 있다', () => {
    expect(serviceStatementErrors([line], items, [link()], 'p', '매입')).toEqual([]);
    expect(serviceStatementErrors([{ itemId: 'oil', name: '기름' }], items, [], 'p', '매출')).toEqual([]);
  });
  it('반대 방향 연결은 대신 쓰지 않고 매출 404도 기본값으로 보지 않는다', () => {
    expect(serviceStatementErrors([line], items, [link()], 'p', '매출')[0]).toContain('매출 용역 연결');
  });
  it('과세 여부와 계정이 비면 발행을 막고 품목명을 알린다', () => {
    expect(serviceStatementErrors([line], items, [link({ taxType: undefined })], 'p', '매입')[0]).toContain('과세 여부');
    expect(serviceStatementErrors([line], items, [link({ Account_Code: undefined })], 'p', '매입')[0]).toContain('계정과목');
  });
});
