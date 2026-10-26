/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OrderRecoveryEntry } from './OrderRecoveryEntry';
import { OrderStatus, type Order } from '../../../shared/types';
const order:Order={id:'leaf-order',companyId:'taebaek',partnerName:'합성거래처',items:[],totalAmount:0,status:OrderStatus.PENDING,createdAt:'2026-10-17',deliveryDate:'2026-10-17',email:'',source:'일반'};
it('처리 중에는 복구 렌더 함수를 호출하지 않고 실패로 표시하지 않는다',()=>{
 const renderAction=vi.fn(()=><button>복구</button>);render(<OrderRecoveryEntry order={{...order,inventoryOperation:{id:'op',state:'processing',targetStatus:OrderStatus.PROCESSING,startedAt:'2026-10-17',actor:'u'}}} renderOrderRecovery={renderAction}/>);
 expect(renderAction).toHaveBeenCalledOnce();expect(screen.queryByRole('region')).toBeNull();expect(screen.queryByText('재고 작업 실패')).toBeNull();
});
it('실패 사유를 표시하고 callback에 복사나 변경 없이 같은 주문을 전달한다',()=>{
 const source:Order={...order,inventoryOperation:{id:'op',state:'failed',targetStatus:OrderStatus.PROCESSING,startedAt:'2026-10-17',actor:'u',error:'원료 조회 실패'}};const before=structuredClone(source),click=vi.fn();const action=vi.fn((row:Order)=><button onClick={()=>click(row)}>원문 확인</button>);
 render(<OrderRecoveryEntry order={source} renderOrderRecovery={action}/>);expect(screen.queryByText('재고 작업 실패')).toBeNull();expect(screen.queryByText('원료 조회 실패')).toBeNull();expect(action.mock.calls[0][0]).toBe(source);fireEvent.click(screen.getByRole('button',{name:'원문 확인'}));expect(click.mock.calls[0][0]).toBe(source);expect(source).toEqual(before);
});
it('실패와 액션이 없으면 비우고 실패가 아니어도 제공된 복구 슬롯은 유지한다',()=>{
 const view=render(<OrderRecoveryEntry order={order}/>);expect(view.container).toBeEmptyDOMElement();
 view.rerender(<OrderRecoveryEntry order={order} renderOrderRecovery={()=><button>이전 결과 확인</button>}/>);expect(screen.getByRole('button',{name:'이전 결과 확인'})).toBeInTheDocument();expect(screen.queryByText('재고 작업 실패')).toBeNull();
});
it('실 Entry fallback은 권한거절을 자물쇠 클릭 후에만 보여준다',()=>{render(<OrderRecoveryEntry order={{...order,inventoryOperation:{id:'op',startedAt:'2026-01-01',actor:'u',state:'failed',targetStatus:OrderStatus.DISPATCHED,error:'Missing or insufficient permissions.'}}}/>);expect(screen.queryByText(/권한 확인에서/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'잠금 이유 및 복구'}));expect(screen.getByRole('dialog')).toHaveTextContent('권한 확인에서 요청이 거절');});
