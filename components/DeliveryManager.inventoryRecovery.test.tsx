/** @vitest-environment jsdom */
import {render,screen} from '@testing-library/react';
import {expect,it} from 'vitest';
import DeliveryManager from './DeliveryManager';
it('배송 빈목록도 orphan 결과 확인을 표시하고 calendarOnly는 부모 표시와 중복하지 않는다',()=>{const p={companyId:'taebaek' as const,orders:[],partners:[],items:[],orderRecoveryOrphans:<button>삭제 주문 확인</button>};const view=render(<DeliveryManager {...p}/>);expect(screen.getByRole('button',{name:'삭제 주문 확인'})).toBeInTheDocument();view.rerender(<DeliveryManager {...p} calendarOnly/>);expect(screen.queryByRole('button',{name:'삭제 주문 확인'})).toBeNull();});
import {fireEvent} from '@testing-library/react';
import {OrderStatus,type Order} from '../types';
import {today} from '../src/shared/day';
it('실제 배송 달력 카드에서 단건 복구를 누르면 일정 수정창이 열리지 않는다',()=>{const clicked=()=>{},order:Order={id:'delivery-failed',companyId:'taebaek',partnerName:'해피유통',items:[],totalAmount:0,status:OrderStatus.PENDING,createdAt:today(),deliveryDate:today(),email:'',source:'일반',inventoryOperation:{id:'op',state:'failed',startedAt:today(),actor:'user',targetStatus:OrderStatus.PROCESSING,error:'원료 부족'}};render(<DeliveryManager companyId="taebaek" calendarOnly orders={[order]} partners={[]} items={[]} renderOrderRecovery={row=><button onClick={clicked}>{row.id} 결과 확인</button>}/>);const buttons=screen.getAllByRole('button',{name:'delivery-failed 결과 확인'});expect(buttons.length).toBeGreaterThan(0);fireEvent.click(buttons[0]);expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getAllByText('원료 부족').length).toBeGreaterThan(0);});
