import {describe,expect,it} from 'vitest';
import {stockShortageError,stockShortageMessage} from './stockShortage';

const items=new Map<string,{name?:unknown;unit?:unknown}>([['label',{name:'시골향생들기름 1.8L',unit:'개'}],['raw',{name:'생들기름',unit:'L'}]]);
describe('재고 부족 안내',()=>{
 it('오류 코드는 그대로 두고 품목별 부족량·재고·다른 주문 예약을 문장으로 붙인다',()=>{const error=stockShortageError([{itemId:'label',current:0,other:0,required:10,missing:10},{itemId:'raw',current:5,other:3,required:4.5,missing:2.5}],id=>items.get(id));expect(error.message).toBe('stock-shortage');expect(stockShortageMessage(error)).toBe('재고가 부족해 처리할 수 없습니다: 시골향생들기름 1.8L 10개 부족(재고 0개) · 생들기름 2.5L 부족(재고 5L, 다른 주문 예약 3L)')});
 it('이름이 없으면 품목 ID를, 10개가 넘으면 나머지 개수를 보여 준다',()=>{const rows=Array.from({length:12},(_,i)=>({itemId:'x'+i,current:0,other:0,required:1,missing:1}));const message=stockShortageMessage(stockShortageError(rows,()=>undefined));expect(message.startsWith('재고가 부족해 처리할 수 없습니다: x0 1 부족(재고 0)')).toBe(true);expect(message.endsWith(' 외 2개 품목')).toBe(true);expect(message).not.toContain('x10')});
 it('품목 정보가 없는 재고 부족이나 다른 오류에는 일반 안내를 돌려준다',()=>{expect(stockShortageMessage(Error('stock-shortage'))).toBe('재고가 부족해 처리할 수 없습니다. 품목 재고를 확인해 주세요.');expect(stockShortageMessage(null)).toBe('재고가 부족해 처리할 수 없습니다. 품목 재고를 확인해 주세요.');expect(stockShortageMessage(stockShortageError([],()=>undefined))).toBe('재고가 부족해 처리할 수 없습니다. 품목 재고를 확인해 주세요.')});
});
