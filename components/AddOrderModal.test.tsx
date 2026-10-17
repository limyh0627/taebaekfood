/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import AddOrderModal from './AddOrderModal';
import { OrderStatus, type Item, type Order, type Partner, type PartnerItem } from '../src/shared/types';
import { buildPackIndex, resetPackIndex, setPackIndex } from '../src/shared/packIndex';

const oldScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype,'scrollIntoView');
beforeAll(()=>Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn()}));
afterAll(()=>{if(oldScroll)Object.defineProperty(HTMLElement.prototype,'scrollIntoView',oldScroll);else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;});

const items = [
  { id: 'oil', name: '생들기름 300ml', unit: '병', type: 'product', category: '들기름' },
  { id: 'gift', name: '선물세트', unit: '개', type: 'product', category: '선물세트' },
] as Item[];

const partners = [
  { id: 'partner-1', name: '가을식품', type: '일반' },
  { id: 'partner-2', name: '가을식품', type: '일반' },
] as Partner[];

const partnerItems = items.map((item, index) => ({
  id: `link-${index}`,
  itemId: item.id,
  partnerId: 'partner-1',
  Direction: 'out',
  price: 0,
})) as PartnerItem[];

const order = (
  id: string,
  status: OrderStatus,
  partnerId = 'partner-1',
  deliveryDate = '2026-09-14',
): Order => ({
  id,
  cardNo: `ORD-${id}`,
  partnerId,
  partnerName: '가을식품',
  items: [
    { itemId: 'oil', name: '옛 기름명', quantity: 5, price: 0 },
    { itemId: 'gift', name: '선물세트', quantity: 24, price: 0, isBoxUnit: true, boxQuantity: 2, unitsPerBox: 12 },
  ],
  totalAmount: 0,
  status,
  createdAt: '2026-09-09T09:00:00+09:00',
  deliveryDate,
  email: '',
  source: '일반',
});

describe('선택한 거래처의 실시간 원본 갱신', () => {
  const partner = { ...partners[0], shipTos: [{ id: 's1', name: '기본 배송지' }, { id: 's2', name: '선택 배송지' }] } as Partner;
  const props = { items, orders: [], palletStocks: [], partnerItems, onClose: vi.fn() };

  it('같은 ID의 배송지가 교체되면 최신 목록과 기본 배송지를 표시한다', () => {
    const view = render(<AddOrderModal {...props} partners={[partner]} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /가을식품/ }));
    const updated = { ...partner, shipTos: [{ id: 's3', name: '새 배송지' }] };
    view.rerender(<AddOrderModal {...props} partners={[updated]} onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: '새 배송지' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '기본 배송지' })).not.toBeInTheDocument();
  });

  it('원본 갱신 중 유효한 배송지와 수량·비고를 보존하고 최신 거래처·단가로 저장한다', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const view = render(<AddOrderModal {...props} partners={[partner]} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: /가을식품/ }));
    fireEvent.click(screen.getByRole('button', { name: '선택 배송지' }));
    fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('주문 비고'), { target: { value: '작성한 비고' } });
    const updated = { ...partner, name: '갱신 거래처', email: 'new@example.test',
      shipTos: [{ id: 's3', name: '추가 배송지' }, ...partner.shipTos!] };
    const updatedLinks = partnerItems.map(link => ({ ...link, price: 2200 }));
    view.rerender(<AddOrderModal {...props} partners={[updated]} partnerItems={updatedLinks} onSave={save} />);
    expect(screen.getByRole('button', { name: '선택 배송지' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByPlaceholderText('0')[0]).toHaveValue('2');
    expect(screen.getByLabelText('주문 비고')).toHaveValue('작성한 비고');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '주문 생성 완료' })));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      partnerId: partner.id, partnerName: '갱신 거래처', email: 'new@example.test', shipToId: 's2',
      note: '작성한 비고', totalAmount: 4400,
      items: [expect.objectContaining({ itemId: 'oil', quantity: 2, price: 2200 })],
    }));
  });

  it('선택 배송지가 삭제되면 기본값으로 돌아가고 거래처가 삭제되면 저장을 막는다', () => {
    const view = render(<AddOrderModal {...props} partners={[partner]} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /가을식품/ }));
    fireEvent.click(screen.getByRole('button', { name: '선택 배송지' }));
    view.rerender(<AddOrderModal {...props} partners={[{ ...partner, shipTos: [partner.shipTos![0]] }]} onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: '기본 배송지' })).toHaveAttribute('aria-pressed', 'true');
    view.rerender(<AddOrderModal {...props} partners={[]} onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: '주문 생성 완료' })).toBeDisabled();
  });
});

describe('옛 박스 설정과 포장 환산표 충돌', () => {
  it('주문 입력에는 포장 환산표의 개입수를 표시한다', () => {
    setPackIndex(buildPackIndex([{ item_id: 'f6', units_per_box: 12 }]));
    try {
      const item = { id: 'f6', name: '포장 설정 충돌 품목', unit: '개', type: 'goods',
        defaultBoxConfig: { unitsPerBox: 10, boxType: '' } } as unknown as Item;
      render(<AddOrderModal items={[item]} orders={[]} partners={partners}
        partnerItems={[{ id: 'f6-link', itemId: item.id, partnerId: 'partner-1', Direction: 'out', price: 0 } as PartnerItem]}
        palletStocks={[]} onClose={vi.fn()} onSave={vi.fn()} />);
      fireEvent.click(screen.getAllByRole('button', { name: /가을식품/ })[0]);
      fireEvent.click(screen.getByText('포장 설정 충돌 품목'));
      expect(screen.queryByText('× 12개 = 12개')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '포장 설정 충돌 품목 수량 박스' }));
      expect(screen.getByText('× 12개 = 12개')).toBeInTheDocument();
    } finally {
      resetPackIndex();
    }
  });
});

describe('신규 주문 창의 거래처 진행 주문', () => {
  it('검색 결과는 입력칸 아래 한행 카드로 선택하고 주문 품목을 연다',()=>{render(<AddOrderModal items={items} orders={[]} partners={partners} palletStocks={[]} onClose={vi.fn()} onSave={vi.fn()}/>);const input=screen.getByPlaceholderText(/거래처명 또는 초성 검색/);fireEvent.change(input,{target:{value:'가을'}});const result=screen.getAllByRole('button',{name:/가을식품/})[0];expect(result.parentElement).toHaveClass('grid-cols-1');expect(result.parentElement).not.toHaveClass('absolute');expect(input.compareDocumentPosition(result)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();fireEvent.click(result);expect(screen.getByRole('heading',{name:'주문 품목'})).toBeInTheDocument();});
  it('매출 연결된 비재고 용역을 주문 품목에 노출하지 않는다', () => {
    const service = { id: 'delivery-fee', name: '배송 용역', unit: '건', type: 'service', category: 'service' } as Item;
    render(
      <AddOrderModal
        items={[...items, service]}
        orders={[]}
        partners={partners}
        partnerItems={[...partnerItems, { id: 'service-link', itemId: service.id, partnerId: 'partner-1', Direction: 'out', price: 10000 } as PartnerItem]}
        palletStocks={[]}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: /가을식품/ })[0]);
    expect(screen.queryByText('배송 용역')).not.toBeInTheDocument();
  });

  it('거래처 ID의 네 진행 상태만 품목 선택 위에 보여주고 N품목으로 펼친다', () => {
    render(
      <AddOrderModal
        items={items}
        orders={[
          order('260909-01', OrderStatus.PENDING, 'partner-1', '2026-09-11'),
          order('260909-02', OrderStatus.PROCESSING, 'partner-1', '2026-09-12'),
          order('260909-03', OrderStatus.DISPATCHED, 'partner-1', '2026-09-13'),
          order('260909-04', OrderStatus.SHIPPED, 'partner-1', '2026-09-14'),
          order('260909-05', OrderStatus.DELIVERED),
          order('260909-06', OrderStatus.ON_HOLD),
          order('260909-07', OrderStatus.PENDING, 'partner-2'),
        ]}
        partners={partners}
        partnerItems={partnerItems}
        palletStocks={[]}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: /가을식품/ })[0]);

    const progress = screen.getByRole('region', { name: '현재 진행 주문' });
    expect(within(progress).getAllByTestId(/^active-client-order-/)).toHaveLength(4);
    for (const label of ['대기중', '작업중', '작업완료', '출고완료']) {
      expect(within(progress).getByLabelText(`상태 ${label}`)).toBeInTheDocument();
    }
    expect(within(progress).queryByText('ORD-260909-05')).not.toBeInTheDocument();
    expect(within(progress).queryByText('ORD-260909-06')).not.toBeInTheDocument();
    expect(within(progress).queryByText('ORD-260909-07')).not.toBeInTheDocument();

    const itemHeading = screen.getByRole('heading', { name: '주문 품목' });
    expect(progress.compareDocumentPosition(itemHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const firstOrder = within(progress).getByTestId('active-client-order-260909-01');
    expect(within(firstOrder).queryByText('생들기름 300ml')).not.toBeInTheDocument();
    fireEvent.click(within(firstOrder).getByRole('button', { name: 'ORD-260909-01 2품목 보기' }));
    expect(within(firstOrder).getByText('생들기름 300ml')).toBeInTheDocument();
    expect(within(firstOrder).getByText('5병')).toBeInTheDocument();
    expect(within(firstOrder).getByText('2박스')).toBeInTheDocument();
  });
});

 describe('재고 만들기', () => {
 it('일정과 거래처 필수 없이 품목을 골라 생산작업을 저장한다', async () => {
 const save = vi.fn().mockResolvedValue(undefined);
 render(<AddOrderModal mode="stock" items={items} partners={partners} partnerItems={partnerItems} orders={[]} palletStocks={[]} onClose={vi.fn()} onSave={save} />);
 expect(screen.queryByText('주문 일정')).not.toBeInTheDocument();
 fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '5' } });
 fireEvent.click(screen.getByRole('button', { name: '생산 작업 등록' }));
 await waitFor(() => expect(save).toHaveBeenCalledOnce());
 expect(save.mock.calls[0][0]).toMatchObject({ purpose: 'stock-production', totalAmount: 0 });
 expect(save.mock.calls[0][0].partnerId).toBeUndefined();
 });
 });

it('생산 거래처 필터는 복수 ID로 품목만 거르고 판매상대를 지정하지 않는다', () => {
 render(<AddOrderModal mode="stock" items={items} partners={partners} partnerItems={partnerItems} orders={[]} palletStocks={[]} onClose={vi.fn()} onSave={vi.fn()} />);
 fireEvent.click(screen.getByRole('button',{name:'거래처 추가 선택'}));
 fireEvent.click(screen.getByRole('option',{name:'가을식품'}));
 expect(screen.getByText('거래처 필터 전체 해제 (1곳 선택)')).toBeInTheDocument();
 expect(screen.queryByText('주문 일정')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', { name: /거래처 필터 전체 해제/ }));
 expect(screen.queryByRole('button',{name:'가을식품 선택 해제'})).not.toBeInTheDocument();
});

describe('주문 수량 입력 단위',()=>{
 it('낱개10은 포장환산12가 있어도10으로 저장하고 박스는 명시 선택한다',async()=>{setPackIndex(buildPackIndex([{item_id:'flavor',units_per_box:12}]));try{const save=vi.fn(async()=>{}),item={id:'flavor',name:'맛기름',spec:'1.8L',unit:'개',type:'goods',stock:500} as Item;render(<AddOrderModal items={[item]} orders={[]} partners={partners} partnerItems={[{id:'link-flavor',itemId:item.id,partnerId:'partner-1',Direction:'out',price:1000} as PartnerItem]} palletStocks={[]} onClose={vi.fn()} onSave={save}/>);fireEvent.click(screen.getAllByRole('button',{name:/가을식품/})[0]);fireEvent.change(screen.getByPlaceholderText('0'),{target:{value:'10'}});await act(async()=>fireEvent.click(screen.getByRole('button',{name:'주문 생성 완료'})));expect(save).toHaveBeenNthCalledWith(1,expect.objectContaining({items:[expect.objectContaining({itemId:'flavor',quantity:10})]}));fireEvent.click(screen.getByRole('button',{name:'맛기름 수량 박스'}));expect(screen.getByText('× 12개 = 120개')).toBeInTheDocument();await act(async()=>fireEvent.click(screen.getByRole('button',{name:'주문 생성 완료'})));expect(save).toHaveBeenNthCalledWith(2,expect.objectContaining({items:[expect.objectContaining({itemId:'flavor',quantity:120,boxQuantity:10,isBoxUnit:true})]}));}finally{resetPackIndex();}});
});

describe('배송 기본값과 판매채널 분리',()=>{
 const p={...partners[0],type:'일반',defaultShipMethod:'수령',shipTos:[{id:'one',name:'택배 창고',defaultShipMethod:'택배'},{id:'two',name:'화물 창고',defaultShipMethod:'화물'}]} as Partner;
 const props={items,orders:[],partnerItems,palletStocks:[],onClose:vi.fn()};
 it('배송지 기본→수동 선택→원본 갱신 보존→명시 배송지 전환 기본을 저장하고 채널은 유지한다',async()=>{
 const save=vi.fn().mockResolvedValue(undefined);const view=render(<AddOrderModal {...props} partners={[p]} onSave={save}/>);fireEvent.click(screen.getByRole('button',{name:/가을식품/}));
 const method=()=>within(screen.getByRole('group',{name:'출고 방식'}));expect(method().getByRole('button',{name:'택배'})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(method().getByRole('button',{name:'수령'}));view.rerender(<AddOrderModal {...props} partners={[{...p,defaultShipMethod:'배송',shipTos:p.shipTos!.map(s=>({...s,defaultShipMethod:'배송'}))}]} onSave={save}/>);
 expect(method().getByRole('button',{name:'수령'})).toHaveAttribute('aria-pressed','true');fireEvent.click(screen.getByRole('button',{name:'화물 창고'}));expect(method().getByRole('button',{name:'배송'})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(method().getByRole('button',{name:'택배'}));fireEvent.change(screen.getAllByPlaceholderText('0')[0],{target:{value:'2'}});await act(async()=>fireEvent.click(screen.getByRole('button',{name:'주문 생성 완료'})));
 expect(save).toHaveBeenCalledWith(expect.objectContaining({source:'일반',shipMethod:'택배',shipToId:'two',items:[expect.objectContaining({quantity:2})]}));
 });
 it('거래처 기본과 기존 채널 fallback을 사용하고 원본의 자동 기본 변경은 수동 전까지 반영한다',()=>{
 const view=render(<AddOrderModal {...props} partners={[{...p,shipTos:[]}]} onSave={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:/가을식품/}));const method=()=>within(screen.getByRole('group',{name:'출고 방식'}));expect(method().getByRole('button',{name:'수령'})).toHaveAttribute('aria-pressed','true');view.rerender(<AddOrderModal {...props} partners={[{...p,type:'스마트스토어',defaultShipMethod:undefined,shipTos:[]}]} onSave={vi.fn()}/>);
 // 선택한 판매채널은 원본 재조회로 바꾸지 않는다. 미설정 기본은 주문 채널을 따른다.
 expect(method().getByRole('button',{name:'배송'})).toHaveAttribute('aria-pressed','true');
 });
});

it('수동 방식을 고른 뒤 배송지 A→B→A로 전환하면 각 기본을 새로 적용하고 저장 실패 시 선택을 보존한다',async()=>{
 const p={...partners[0],shipTos:[{id:'a',name:'합성 A',defaultShipMethod:'택배'},{id:'b',name:'합성 B',defaultShipMethod:'화물'}]} as Partner;
 const save=vi.fn().mockRejectedValue(new Error('합성 저장 오류'));vi.spyOn(window,'alert').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});
 render(<AddOrderModal items={items} partners={[p]} orders={[]} partnerItems={partnerItems} palletStocks={[]} onClose={vi.fn()} onSave={save}/>);fireEvent.click(screen.getByRole('button',{name:/가을식품/}));const method=()=>within(screen.getByRole('group',{name:'출고 방식'}));fireEvent.click(method().getByRole('button',{name:'수령'}));fireEvent.click(screen.getByRole('button',{name:'합성 B'}));expect(method().getByRole('button',{name:'화물'})).toHaveAttribute('aria-pressed','true');fireEvent.click(screen.getByRole('button',{name:'합성 A'}));expect(method().getByRole('button',{name:'택배'})).toHaveAttribute('aria-pressed','true');fireEvent.change(screen.getAllByPlaceholderText('0')[0],{target:{value:'2'}});await act(async()=>fireEvent.click(screen.getByRole('button',{name:'주문 생성 완료'})));expect(save).toHaveBeenCalledOnce();expect(method().getByRole('button',{name:'택배'})).toHaveAttribute('aria-pressed','true');expect(screen.getAllByPlaceholderText('0')[0]).toHaveValue('2');
});

function chooseFilter(label:string,option:RegExp|string,search?:string){fireEvent.click(screen.getByRole('button',{name:label}));if(search!==undefined)fireEvent.change(screen.getByRole('listbox').parentElement!.querySelector('input')!,{target:{value:search}});fireEvent.click(screen.getByRole('option',{name:option}));}
const filterItems:Item[]=[{id:'qa-a',name:'참기름/300ml',spec:'300ml',category:'참기름',type:'product',unit:'병',stock:0,minStock:0,image:''},{id:'qa-b',name:'들기름/500ml',spec:'500ml',category:'들기름',type:'product',unit:'병',stock:0,minStock:0,image:''},{id:'qa-c',name:'들기름/1L',spec:'1L',category:'들기름',type:'product',unit:'병',stock:0,minStock:0,image:''}];
const filterPartners:Partner[]=[{id:'qa-pa',name:'가을식품',type:'일반'},{id:'qa-pb',name:'바다유통',type:'일반'}] as Partner[];
const filterLinks:PartnerItem[]=[{id:'qa-la',itemId:'qa-a',partnerId:'qa-pa',Direction:'out',price:0},{id:'qa-lb',itemId:'qa-b',partnerId:'qa-pb',Direction:'in',price:0}];
it('거래처를 초성검색으로 추가해 OR 필터하고 중복선택 없이 개별 및 전체 해제한다',()=>{
 render(<AddOrderModal mode="stock" items={filterItems} partners={filterPartners} partnerItems={filterLinks} orders={[]} palletStocks={[]} onClose={vi.fn()} onSave={vi.fn()}/>);expect(screen.getAllByPlaceholderText('0')).toHaveLength(3);
 chooseFilter('거래처 추가 선택','가을식품','ㄱㅇ');expect(screen.getAllByPlaceholderText('0')).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'거래처 추가 선택'}));expect(screen.queryByRole('option',{name:'가을식품'})).not.toBeInTheDocument();fireEvent.change(screen.getByRole('listbox').parentElement!.querySelector('input')!,{target:{value:'ㅂㄷ'}});fireEvent.click(screen.getByRole('option',{name:'바다유통'}));expect(screen.getAllByPlaceholderText('0')).toHaveLength(2);expect(screen.getByText('거래처 필터 전체 해제 (2곳 선택)')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'가을식품 선택 해제'}));expect(screen.getAllByPlaceholderText('0')).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:/거래처 필터 전체 해제/}));expect(screen.getAllByPlaceholderText('0')).toHaveLength(3);
});
it('제품유형 개수와 용량 검색·전체 선택을 유지하고 유형 변경은 용량을 초기화한다',()=>{
 render(<AddOrderModal mode="stock" items={filterItems} partners={filterPartners} partnerItems={filterLinks} orders={[]} palletStocks={[]} onClose={vi.fn()} onSave={vi.fn()}/>);expect(screen.getByRole('button',{name:'제품 유형'})).toHaveTextContent('전체 3');chooseFilter('용량 유형','500ml 1','500');expect(screen.getAllByPlaceholderText('0')).toHaveLength(1);chooseFilter('제품 유형','들기름 2','들');expect(screen.getByRole('button',{name:'용량 유형'})).toHaveTextContent('전체');expect(screen.getAllByPlaceholderText('0')).toHaveLength(2);chooseFilter('용량 유형','1l 1');expect(screen.getAllByPlaceholderText('0')).toHaveLength(1);chooseFilter('용량 유형','전체');expect(screen.getAllByPlaceholderText('0')).toHaveLength(2);chooseFilter('제품 유형','참기름 1');expect(screen.queryByRole('button',{name:'용량 유형'})).not.toBeInTheDocument();expect(screen.getAllByPlaceholderText('0')).toHaveLength(1);
});
it('선택 유형이 거래처 후보에서 사라져도 사실 fallback을 보여주며 자동 전체로 바꾸지 않는다',()=>{
 render(<AddOrderModal mode="stock" items={filterItems} partners={filterPartners} partnerItems={filterLinks} orders={[]} palletStocks={[]} onClose={vi.fn()} onSave={vi.fn()}/>);chooseFilter('제품 유형','들기름 2');chooseFilter('거래처 추가 선택','가을식품');expect(screen.getByRole('button',{name:'제품 유형'})).toHaveTextContent('들기름 · 현재 목록에 없음');expect(screen.queryByPlaceholderText('0')).not.toBeInTheDocument();
});

it('거래처 제거로 선택 용량이 후보에서 사라져도 현재값을 보여주고 전체로 해제할 수 있다',()=>{
 const rows:Item[]=[{...filterItems[0],id:'oil-large',name:'참기름/1800ml',spec:'1800ml'},{...filterItems[0],id:'oil-small',name:'참기름/350ml',spec:'350ml'}];
 const links:PartnerItem[]=[{id:'large-link',itemId:'oil-large',partnerId:'qa-pa',Direction:'out',price:0},{id:'small-link',itemId:'oil-small',partnerId:'qa-pb',Direction:'out',price:0}];
 render(<AddOrderModal mode="stock" items={rows} partners={filterPartners} partnerItems={links} orders={[]} palletStocks={[]} onClose={vi.fn()} onSave={vi.fn()}/>);
 chooseFilter('거래처 추가 선택','가을식품');chooseFilter('거래처 추가 선택','바다유통');chooseFilter('제품 유형','참기름 2');chooseFilter('용량 유형','1800ml 1');expect(screen.getAllByPlaceholderText('0')).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'가을식품 선택 해제'}));expect(screen.getByRole('button',{name:'용량 유형'})).toHaveTextContent('1800ml · 현재 목록에 없음');expect(screen.queryByPlaceholderText('0')).not.toBeInTheDocument();chooseFilter('용량 유형','전체');expect(screen.getAllByPlaceholderText('0')).toHaveLength(1);expect(screen.getByText('350ml')).toBeInTheDocument();
});
