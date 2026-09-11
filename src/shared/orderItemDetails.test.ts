import { afterEach, describe, expect, it } from 'vitest';
import { buildBomIndex, setBomIndex } from './bomIndex';
import type { Item, OrderItem } from './types';
import { orderItemDetails } from './orderItemDetails';
const orderItem = {itemId:'box',name:'상자 주문'} as OrderItem;
afterEach(()=>setBomIndex(buildBomIndex([],[])));
describe('주문 상세의 최신 BOM 연결',()=>{
  it('박스 안 낱개와 그 병·뚜껑·라벨을 읽고 archived는 제외한다',()=>{
    const items=[
      {id:'box',type:'product',name:'상자 주문'},
      {id:'loose',type:'product',name:'낱개 참기름'},
      {id:'bottle',type:'submaterial',category:'용기',name:'유리병'},
      {id:'cap',type:'submaterial',category:'마개',name:'뚜껑'},
      {id:'label',type:'submaterial',category:'라벨',name:'라벨'},
      {id:'carton',type:'submaterial',category:'박스',name:'겉박스'},
      {id:'old',type:'product',name:'보관된 품목',archived:true},
    ] as Item[];
    setBomIndex(buildBomIndex(items,[
      {parent_id:'box',child_id:'loose',quantity:20},{parent_id:'box',child_id:'carton'},
      {parent_id:'box',child_id:'old'},...['bottle','cap','label'].map(child_id=>({parent_id:'loose',child_id})),
    ]));
    expect(orderItemDetails(orderItem,items)).toEqual({manufacturing:['낱개 참기름'],bottles:['유리병'],caps:['뚜껑'],labels:['라벨'],packaging:['겉박스']});
  });
  it('이름·규격이 같아도 다른 ID의 품목을 대신 표시하지 않는다',()=>{
    const items=[{id:'other',type:'product',name:'상자 주문'}] as Item[];
    setBomIndex(buildBomIndex(items,[]));
    expect(orderItemDetails(orderItem,items).manufacturing).toEqual([]);
  });
});
