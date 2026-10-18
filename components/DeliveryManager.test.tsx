/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DeliveryManager from './DeliveryManager';
import { today } from '../src/shared/day';
import { OrderStatus, type Item, type Order, type Partner } from '../src/shared/types';
import { setDocument } from '../src/shared/services/firebaseService';

vi.mock('../src/shared/services/firebaseService', () => ({
  subscribeToDocument: vi.fn(() => () => undefined),
  setDocument: vi.fn(),
}));

const partners = [
  { id: 'p1', name: '현재 거래처 1' },
  { id: 'p2', name: '현재 거래처 2' },
  { id: 'old', name: '예전 거래처' },
] as Partner[];

const items = [{
  id: 'oil', name: '참기름/병/분/전통/350ml', spec: '350ml', unit: '병',
  type: 'product', category: '참기름', stock: 0, minStock: 0, image: '',
}] as Item[];

const 주문 = (id: string, partnerId: string, status: OrderStatus): Order => ({
  id,
  cardNo: `ORD-${id}`,
  partnerId,
  partnerName: partners.find(p => p.id === partnerId)?.name ?? '',
  items: [{ itemId: 'oil', name: '옛 품목명', quantity: 50, price: 0 }],
  totalAmount: 0,
  status,
  createdAt: `${today()}T09:00:00+09:00`,
  deliveryDate: today(),
  email: '',
  source: '일반',
});

describe('주간 배송 캘린더', () => {
  it('주문일이 잘못된 주문이 있어도 캘린더와 날짜 필터를 연다', () => {
    const order = { ...주문('invalid-date', 'p1', OrderStatus.DISPATCHED), createdAt: '잘못된 날짜' };
    render(<DeliveryManager companyId="taebaek" orders={[order]} partners={partners} items={items} />);
    expect(screen.getByRole('button', { name: `${Number(today().slice(8, 10))}일 배송 상세 보기` })).toBeInTheDocument();
    expect(screen.getByLabelText('주문일 시작')).toHaveValue('');
    expect(screen.getByLabelText('주문일 종료')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('주문일 시작'), { target: { value: today() } });
    expect(screen.getByRole('button', { name: '기간 전체' })).toBeInTheDocument();
  });
  beforeEach(() => vi.clearAllMocks());

  it('캘린더를 기본 뷰로 열고 배송 대상 상태만 집계한다', () => {
    render(
      <DeliveryManager
        companyId="taebaek"
        orders={[
          주문('260909-01', 'p1', OrderStatus.DISPATCHED),
          주문('260909-02', 'p2', OrderStatus.DISPATCHED),
          주문('260908-01', 'old', OrderStatus.DELIVERED),
        ]}
        partners={partners}
        items={items}
      />,
    );

    expect(screen.getByRole('button', { name: '캘린더' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '전체2' })).toBeInTheDocument();
    expect(screen.queryByText('예전 거래처')).not.toBeInTheDocument();
  });

  it('날짜 상세의 주문번호를 누르면 출고 일정 수정 창이 열린다', () => {
    render(
      <DeliveryManager
        companyId="taebaek"
        orders={[주문('260909-01', 'p1', OrderStatus.DISPATCHED)]}
        partners={partners}
        items={items}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: `${Number(today().slice(8, 10))}일 배송 상세 보기` }));
    fireEvent.click(screen.getByRole('button', { name: 'ORD-260909-01' }));

    expect(screen.getByText('출고 일정 수정')).toBeInTheDocument();
    expect(screen.getByLabelText('출고예정일')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: '출고 시간대' })).toBeInTheDocument();
  });

  it('다른 날짜 주문을 오늘 칸에 놓으면 배송일을 오늘로 바꾼다', () => {
    const onUpdateDeliveryDate = vi.fn();
    render(
      <DeliveryManager
        companyId="taebaek"
        orders={[주문('260909-01', 'p1', OrderStatus.DISPATCHED)]}
        partners={partners}
        items={items}
        onUpdateDeliveryDate={onUpdateDeliveryDate}
      />,
    );

    const todayCell = screen.getByRole('button', {
      name: `${Number(today().slice(8, 10))}일 배송 상세 보기`,
    }).parentElement!;
    const dataTransfer = {
      getData: (key: string) => key === 'orderId' ? '260909-01' : '',
      dropEffect: 'none',
    };
    fireEvent.dragOver(todayCell, { dataTransfer });
    fireEvent.drop(todayCell, { dataTransfer });

    expect(onUpdateDeliveryDate).toHaveBeenCalledWith('260909-01', new Date(today()).toISOString());
  });

  it('날짜 상세에서 고른 주문을 회사별 날짜 묶음으로 저장한다', () => {
    render(
      <DeliveryManager
        companyId="taebaek"
        orders={[
          주문('260909-01', 'p1', OrderStatus.DISPATCHED),
          주문('260909-02', 'p2', OrderStatus.DISPATCHED),
        ]}
        partners={partners}
        items={items}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: `${Number(today().slice(8, 10))}일 배송 상세 보기` }));
    const 묶기 = screen.getAllByRole('button', { name: '묶을 것 고르기' });
    fireEvent.click(묶기[0]);
    fireEvent.click(묶기[1]);
    fireEvent.click(screen.getAllByRole('button', { name: '고른 2건 한 차로 묶기' }).at(-1)!);

    expect(setDocument).toHaveBeenCalledWith(
      'settings',
      'taebaek__deliveryOrdering',
      expect.objectContaining({
        companyId: 'taebaek',
        groupsByDate: {
          [today()]: [expect.objectContaining({ orderIds: ['260909-01', '260909-02'] })],
        },
      }),
    );
  });
});

it('주문일 공용 입력은 양쪽 범위와 원래 높이·포커스 스타일을 보존한다',()=>{
 render(<DeliveryManager companyId="taebaek" orders={[]} partners={partners} items={items}/>);
 const from=screen.getByLabelText('주문일 시작'),to=screen.getByLabelText('주문일 종료');
 expect(from).toHaveAttribute('type','date');expect(to).toHaveAttribute('type','date');
 expect(from).toHaveClass('h-10','focus:ring-1');expect(from.closest('label')).not.toBeNull();
 expect(from.parentElement?.tagName).toBe('SPAN');expect(from.nextElementSibling).not.toHaveAttribute('aria-hidden');expect(from.parentElement).toHaveClass('flex-nowrap','max-w-full');
 fireEvent.change(from,{target:{value:'2026-09-01'}});expect(to).toHaveAttribute('min','2026-09-01');expect(to).toHaveValue('');
 fireEvent.change(to,{target:{value:'2026-09-30'}});expect(from).toHaveAttribute('max','2026-09-30');expect(from).toHaveValue('2026-09-01');
 fireEvent.change(from,{target:{value:''}});expect(to).not.toHaveAttribute('min');expect(to).toHaveValue('2026-09-30');
});
it('제목·보기·상태·복구·검색·금일 업무를 한 순서로 두고 중복 제목은 없다',()=>{
 vi.clearAllMocks();
 render(<DeliveryManager companyId="taebaek" orders={[]} partners={partners} items={items} orderRecoveryOrphans={<button>기록 확인</button>}/>);
 const title=screen.getByRole('heading',{name:'배송 관리'}),view=screen.getByRole('button',{name:/^캘린더$/}),status=screen.getByRole('button',{name:/대기중/}),recovery=screen.getByRole('button',{name:'기록 확인'}),search=screen.getByPlaceholderText('거래처, 주소, 품목, 비고 검색'),daily=screen.getByRole('button',{name:/금일 배송순서/});
 for(const [before,after] of [[title,view],[view,status],[status,recovery],[recovery,search],[search,daily]])expect(before.compareDocumentPosition(after)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(screen.queryByText('전체 배송 관리')).toBeNull();expect(screen.getAllByRole('heading',{name:'배송 관리'})).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:/^보드$/}));expect(screen.queryByRole('button',{name:/금일 배송순서/})).toBeNull();expect(view).toHaveAttribute('aria-pressed','false');expect(setDocument).not.toHaveBeenCalled();
});
it('달력 전용에서는 새 제목·탭·검색·복구를 노출하지 않고 금일 순서를 유지한다',()=>{
 vi.clearAllMocks();
 render(<DeliveryManager companyId="taebaek" calendarOnly orders={[]} partners={partners} items={items} orderRecoveryOrphans={<button>기록 확인</button>}/>);
 expect(screen.queryByRole('heading',{name:'배송 관리'})).toBeNull();expect(screen.queryByLabelText('배송 보기 방식')).toBeNull();expect(screen.queryByPlaceholderText('거래처, 주소, 품목, 비고 검색')).toBeNull();expect(screen.queryByRole('button',{name:'기록 확인'})).toBeNull();expect(screen.getByRole('button',{name:/금일 배송순서/})).toBeInTheDocument();expect(setDocument).not.toHaveBeenCalled();
});
it('주문일 빠른기간 자동선택·수동변경·기간전체와 검색전체 초기화를 유지한다',()=>{
 render(<DeliveryManager companyId="taebaek" orders={[]} partners={partners} items={items}/>);
 const from=screen.getByLabelText('주문일 시작'),to=screen.getByLabelText('주문일 종료');
 const month=screen.getByRole('button',{name:/^이번 달$/});fireEvent.click(month);
 expect(from).toHaveValue(today().slice(0,7)+'-01');expect(to).toHaveValue(today());expect(month).toHaveAttribute('aria-pressed','true');
 fireEvent.change(from,{target:{value:'2020-01-01'}});expect(month).toHaveAttribute('aria-pressed','false');expect(to).toHaveValue(today());
 fireEvent.click(screen.getByRole('button',{name:'기간 전체'}));expect(from).toHaveValue('');expect(to).toHaveValue('');expect(from).not.toHaveAttribute('max');
 fireEvent.click(screen.getByRole('button',{name:/^오늘$/}));expect(from).toHaveValue(today());expect(to).toHaveValue(today());
 const search=screen.getByPlaceholderText('거래처, 주소, 품목, 비고 검색');fireEvent.change(search,{target:{value:'참기름'}});
 fireEvent.click(screen.getByRole('button',{name:/^초기화$/}));expect(from).toHaveValue('');expect(to).toHaveValue('');expect(search).toHaveValue('');
});

it('배송 조회도 날짜·조건·검색 고정 행을 사용하고 조건 값과 전체검색을 분리한다',()=>{render(<DeliveryManager companyId="taebaek" orders={[]} partners={partners} items={items}/>);const query=screen.getByRole('region',{name:'검색조건'});expect(Array.from(query.querySelectorAll('[data-query-row]')).map(row=>row.getAttribute('data-query-row'))).toEqual(['date','condition','search']);expect(screen.getByRole('button',{name:'조건 값'}).closest('[data-query-row="condition"]')).not.toBeNull();expect(screen.getByPlaceholderText('거래처, 주소, 품목, 비고 검색').closest('[data-query-row="search"]')).not.toBeNull();expect(setDocument).not.toHaveBeenCalled();});
