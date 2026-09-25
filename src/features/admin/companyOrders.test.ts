import { describe, expect, it } from 'vitest';
import type { Order } from '../../shared/types';
import { mergeCompanyOrders } from './companyOrders';

const order = (id: string, companyId: 'taebaek' | 'punghoe', name: string) =>
  ({ id, companyId, partnerName: name }) as Order;

describe('회사별 주문 병합', () => {
  it('이전 회사 이력과 실시간 주문은 걸러내고 같은 회사의 최신 실시간 값을 우선한다', () => {
    const result = mergeCompanyOrders(
      [order('a', 'taebaek', '태백 실시간'), order('b', 'punghoe', '풍회 실시간')],
      [order('a', 'taebaek', '태백 과거'), order('c', 'taebaek', '태백 과거만'), order('d', 'punghoe', '풍회 과거')],
      'punghoe',
    );
    expect(result.map(value => value.id)).toEqual(['d', 'b']);
    expect(result.every(value => value.companyId === 'punghoe')).toBe(true);
  });
});
