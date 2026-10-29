/** @vitest-environment jsdom */
import React from 'react';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import OrderActivityLogModal,{로그시각} from './OrderActivityLogModal';
import {buildOrderActivityLog} from '../src/shared/orderActivityLog';
import type {Order,OrderStatusAudit} from '../src/shared/types';

afterEach(cleanup);
const order={items:[],createdAt:'2026-10-25T00:00:00.000Z',createdBy:'기록자'} as unknown as Order;
const cancelled={kind:'full-request-cancel',at:'2026-10-28T02:00:00.000Z',cancelledBy:{name:'복구 직원'},targetStatus:'SHIPPED'} as unknown as OrderStatusAudit;
const legacy={previousStatus:'PROCESSING',nextStatus:'DISPATCHED',approvedBy:'기존 직원',approvedAt:'2026-10-27T02:00:00.000Z',state:'completed',stockAdjustments:[]} as unknown as OrderStatusAudit;
const failed={...legacy,approvedAt:'2026-10-26T02:00:00.000Z',state:'failed',error:'합성 실패'} as OrderStatusAudit;

it('실제 로그 builder의 취소·이전 상태·실패·등록이 같은 모달에 각각 렌더된다',()=>{
 const rows=buildOrderActivityLog(order,[legacy,failed,cancelled]),close=vi.fn();render(<OrderActivityLogModal partnerName="합성 거래처" rows={rows} loading={false} onClose={close}/>);
 const dialog=screen.getByRole('dialog',{name:'주문 로그 · 합성 거래처'}),text=within(dialog).getByText('미반영 처리 요청 취소'),line=text.closest('li')!;
 expect(line).toHaveTextContent('복구 직원');expect(line).toHaveTextContent(로그시각('2026-10-28T02:00:00.000Z'));expect(line).not.toHaveTextContent('→');expect(line.querySelector('svg')).not.toBeNull();expect(line.querySelector('span')).toHaveClass('bg-slate-100','text-slate-600');
 expect(within(dialog).getAllByText('작업중 → 작업완료')).toHaveLength(2);expect(within(dialog).getByText('실패 — 합성 실패')).toBeInTheDocument();expect(within(dialog).getByText('주문 등록')).toBeInTheDocument();
 fireEvent.click(within(dialog).getByRole('button',{name:'주문 로그 · 합성 거래처 닫기'}));expect(close).toHaveBeenCalledOnce();
});
it('손상된 새 감사도 미확인으로 표시하고 로딩·오류 안내를 유지한다',()=>{
 const bad={kind:'full-request-cancel',at:42,cancelledBy:null} as unknown as OrderStatusAudit,rows=buildOrderActivityLog(order,[bad]);render(<OrderActivityLogModal partnerName="합성" rows={rows} loading error="일부 조회 실패" onClose={()=>{}}/>);
 const line=screen.getByText('미반영 처리 요청 취소 기록 확인 필요').closest('li')!;expect(line).toHaveTextContent('시각 미기록 · 미기록');expect(line.querySelector('svg')).not.toBeNull();expect(screen.getByText('일부 조회 실패')).toBeInTheDocument();expect(screen.getByText('상태 변경 기록을 불러오는 중…')).toBeInTheDocument();
});
