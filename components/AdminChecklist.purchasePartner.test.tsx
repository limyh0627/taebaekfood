/** @vitest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import AdminChecklist from './AdminChecklist';
import type { Partner, PartnerItem, PurchaseOrder } from '../src/shared/types';

const a = { id: 'A', name: '같은 거래처' } as Partner;
const b = { id: 'B', name: '같은 거래처' } as Partner;
const cases = [
  { label: '동일명 앞 거래처', partners: [a, b], id: 'B', name: b.name, expected: 'B' },
  { label: '부분명 앞 거래처', partners: [{ ...a, name: '거래처' }, b], id: 'B', name: b.name, expected: 'B' },
  { label: '배열 순서 반전', partners: [b, a], id: 'B', name: b.name, expected: 'B' },
  { label: '단일 정상 거래처', partners: [b], id: 'B', name: b.name, expected: 'B' },
  { label: '없는 ID의 이름 대체', partners: [a, b], id: '없는ID', name: b.name, expected: 'A' },
  { label: '빈 ID의 부분명 대체', partners: [{ ...a, name: '거래처' }], id: '', name: b.name, expected: 'A' },
];

for (const mode of ['선입고', '발주예정'] as const) {
  it.each(cases)(`${mode} $label: 명시 ID를 먼저 선택하고 기존 이름 대체와 품목을 보존한다`, ({ partners, id, name, expected }) => {
    const po: PurchaseOrder = { id: 'po-source', partnerId: id, partnerName: name, status: 'pending',
      itemId: 'item-source', itemName: '원품목', quantity: 2.5,
      createdAt: '2026-10-16T00:00:00Z', receivedAt: '2026-10-16T00:00:00Z',
      items: [{ itemId: 'item-source', name: '원품목', quantity: 2.5, unit: 'kg' }] };
    const prices = [{ id: 'price-source', partnerId: id, itemId: 'item-source', Direction: 'in', price: 12345 }] as PartnerItem[];
    const original = structuredClone({ po, partners, prices });
    const create = vi.fn();
    render(<AdminChecklist leaveRequests={[]} adjustmentRequests={[]} employees={[]}
      onLeaveAction={vi.fn().mockResolvedValue({status:"saved"})} onUpdateAdjustmentStatus={vi.fn()} onProcessAdjustment={vi.fn()}
      partners={partners} partnerItems={prices} onCreatePurchaseStatement={create}
      {...(mode === '선입고' ? { receivedOrders: [po] } : { orderRequests: [po] })} />);
    fireEvent.click(screen.getByRole('button', { name: mode === '선입고' ? '매입전표 발행' : '매입전표 작성' }));
    expect(create).toHaveBeenCalledExactlyOnceWith({ partnerId: expected,
      partnerName: partners.find(p => p.id === expected)!.name,
      items: [{ itemId: 'item-source', name: '원품목', spec: 'kg', qty: 2.5, price: 12345, isBox: false }], poIds: ['po-source'] });
    expect({ po, partners, prices }).toEqual(original);
  });
}

it('선입고 이력의 상태 드롭다운과 초기화는 미발행 기본조건만 복원한다',()=>{HTMLElement.prototype.scrollIntoView=vi.fn();const create=vi.fn();render(<AdminChecklist leaveRequests={[]} adjustmentRequests={[]} employees={[]} onLeaveAction={vi.fn().mockResolvedValue({status:"saved"})} onUpdateAdjustmentStatus={vi.fn()} onProcessAdjustment={vi.fn()} onCreatePurchaseStatement={create}/>);const query=screen.getByRole('region',{name:'선입고 이력 검색조건'}),filter=screen.getByRole('button',{name:'선입고 전표 상태'});fireEvent.click(filter);fireEvent.click(screen.getByRole('option',{name:'전체'}));expect(filter).toHaveTextContent('전체');fireEvent.click(screen.getByRole('button',{name:'초기화'}));expect(filter).toHaveTextContent('전표 미발행만');expect(query).toContainElement(filter);expect(create).not.toHaveBeenCalled();});
