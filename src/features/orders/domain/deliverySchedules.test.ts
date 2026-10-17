import {expect,it} from 'vitest';
import {buildDeliverySchedules,buildDeliveredSchedules} from './deliverySchedules';
import {OrderStatus,type Order,type Item} from '../../../shared/types';
const order=(id:string,over:Partial<Order>={}):Order=>({id,partnerName:id,items:[],totalAmount:0,status:OrderStatus.PENDING,createdAt:'2026-10-17T01:00:00Z',deliveryDate:'2026-10-17T00:00:00+09:00',email:'',source:'일반',...over});
const product=(id:string,stock:number):Item=>({id,name:id,type:'product',spec:'1kg',unit:'개',stock,minStock:0,image:''});
it('진행 상태 전체를 서울 날짜에 담고 생산기록·배송일없음·완료는 분리하며 원문은 보존한다',()=>{
 const rows=[order('pending'),order('processing',{status:OrderStatus.PROCESSING}),order('dispatched',{status:OrderStatus.DISPATCHED}),order('shipped',{status:OrderStatus.SHIPPED}),order('hold',{status:OrderStatus.ON_HOLD}),order('done',{status:OrderStatus.DELIVERED}),order('production',{partnerName:'생산기록'}),order('empty',{deliveryDate:''})];
 const before=JSON.stringify(rows),out=buildDeliverySchedules(rows,[],'delivery');
 expect(Object.keys(out)).toEqual(['2026-10-17']);expect(out['2026-10-17'].map(o=>o.id)).toEqual(['dispatched','hold','pending','processing','shipped']);
 expect(out['2026-10-17'].find(o=>o.id==='pending')).toBe(rows[0]);expect(buildDeliveredSchedules(rows)['2026-10-17']).toEqual([rows[5]]);expect(JSON.stringify(rows)).toBe(before);
});
it('진행 기본·작업낮음·높음은 기존 거래처 정렬이며 동명 입력 순서를 유지한다',()=>{
 const rows=[order('b',{partnerName:'나'}),order('first',{partnerName:'가'}),order('second',{partnerName:'가'})];
 for(const mode of ['delivery','workLow','workHigh'] as const)expect(buildDeliverySchedules(rows,[],mode)['2026-10-17'].map(o=>o.id)).toEqual(['first','second','b']);
 expect(rows.map(o=>o.id)).toEqual(['b','first','second']);
});
it('주문순은 최근시각 먼저이며 같은 시각과 NaN 비교는 기존 입력 순서를 유지한다',()=>{
 const rows=[order('old',{createdAt:'2026-10-16T01:00:00Z'}),order('new',{createdAt:'2026-10-17T01:00:00Z'}),order('same',{createdAt:'2026-10-17T01:00:00Z'})];
 expect(buildDeliverySchedules(rows,[],'order')['2026-10-17'].map(o=>o.id)).toEqual(['new','same','old']);
 const invalid=[order('invalid1',{createdAt:'bad'}),order('invalid2',{createdAt:'bad'}),order('valid')];
 expect(buildDeliverySchedules(invalid,[],'order')['2026-10-17']).toEqual(invalid);
});
it('재고 여유는 원수량과 최소여유를 사용하고 빈품목·미상품목 Infinity 동점은 보존한다',()=>{
 const products=[product('one',10),product('two',20)];
 const rows=[order('room',{items:[{itemId:'one',name:'한개',quantity:1,price:0}]}),order('short',{items:[{itemId:'one',name:'부족',quantity:12.5,price:0},{itemId:'two',name:'여유',quantity:1,price:0}]}),order('empty'),order('unknown',{items:[{itemId:'missing',name:'미상',quantity:999,price:0}]})];
 const before=JSON.stringify([rows,products]);expect(buildDeliverySchedules(rows,products,'stock')['2026-10-17'].map(o=>o.id)).toEqual(['short','room','empty','unknown']);expect(JSON.stringify([rows,products])).toBe(before);
});
it('완료는 입력 순서를 정렬하지 않고 잘못된 배송일은 빈키로 그대로 묶는다',()=>{
 const rows=[order('z',{status:OrderStatus.DELIVERED}),order('a',{status:OrderStatus.DELIVERED,createdAt:'2020-01-01'}),order('invalidDone',{status:OrderStatus.DELIVERED,deliveryDate:'bad'}),order('invalidPending',{deliveryDate:'bad'})];
 const out=buildDeliveredSchedules(rows);expect(out['2026-10-17'].map(o=>o.id)).toEqual(['z','a']);expect(out['']).toEqual([rows[2]]);
 expect(buildDeliverySchedules(rows,[],'delivery')['']).toEqual([rows[3]]);expect(buildDeliveredSchedules([])).toEqual({});
});
