import {afterEach,expect,it} from 'vitest';
import {buildPackIndex,type PackRow} from './orderPackIndex';
import * as app from '../../../src/shared/packIndex';

afterEach(()=>app.resetPackIndex());

it('명시 포장 입력은 독립 인덱스이며 품목이 없으면 0을 반환한다',()=>{
 const a=buildPackIndex([{item_id:'p',units_per_box:12}]),b=buildPackIndex([{item_id:'p',units_per_box:24}]);
 expect(a.of('p')).toBe(12);expect(b.of('p')).toBe(24);expect(a.of('missing')).toBe(0);expect(a.size).toBe(1);
 expect(buildPackIndex().size).toBe(0);
});

it('기존 중복 포장 행은 마지막 유효값을 쓰며 뒤의 무효값은 덮어쓰지 않는다',()=>{
 const rows=[{item_id:'p',units_per_box:12},{item_id:'p',units_per_box:24},{item_id:'p',units_per_box:1}];
 expect(buildPackIndex(rows).of('p')).toBe(24);expect(buildPackIndex([...rows].reverse()).of('p')).toBe(12);
 expect(buildPackIndex(rows).size).toBe(1);
});

it('기존 숫자 변환과 빈 품목·개입수 1 이하·비유한 값 제외를 보존한다',()=>{
 const rows=[null,{item_id:'',units_per_box:12},{item_id:'string',units_per_box:'12'},{item_id:'fraction',units_per_box:2.5},
  ...[undefined,null,0,1,-1,NaN,Infinity,-Infinity,'bad',true].map((units_per_box,index)=>({item_id:'bad'+index,units_per_box}))] as unknown as PackRow[];
 const index=buildPackIndex(rows);expect(index.size).toBe(2);expect(index.of('string')).toBe(12);expect(index.of('fraction')).toBe(2.5);
 expect(index.of('')).toBe(0);for(let i=0;i<10;i++)expect(index.of('bad'+i)).toBe(0);
});

it('동결된 원문을 수정하지 않고 이미 만든 인덱스는 후속 원문 편집의 영향을 받지 않는다',()=>{
 const frozen=Object.freeze([Object.freeze({item_id:'p',units_per_box:12})]);
 expect(buildPackIndex(frozen as unknown as PackRow[]).of('p')).toBe(12);
 const rows=[{item_id:'p',units_per_box:12}],index=buildPackIndex(rows);rows[0].units_per_box=24;
 expect(index.of('p')).toBe(12);expect(buildPackIndex(rows).of('p')).toBe(24);
});

it('변환할 수 없는 원문은 임의 기본값으로 바꾸지 않고 기존 오류를 유지한다',()=>{
 expect(()=>buildPackIndex([{item_id:'p',units_per_box:Symbol('잘못된 값')}] as unknown as PackRow[])).toThrow(TypeError);
});

it('앱은 같은 계산 원본을 재사용하고 명시 계산만으로 레지스트리를 교체하지 않는다',()=>{
 expect(app.buildPackIndex).toBe(buildPackIndex);app.setPackIndex(buildPackIndex([{item_id:'p',units_per_box:12}]));
 const held=app.getPackIndex();expect(app.packUnitsOf('p')).toBe(12);expect(app.packUnitsOf(undefined)).toBe(0);
 buildPackIndex([{item_id:'p',units_per_box:24}]);expect(app.getPackIndex()).toBe(held);expect(app.packUnitsOf('p')).toBe(12);
 app.resetPackIndex();expect(app.getPackIndex().size).toBe(0);expect(app.packUnitsOf('p')).toBe(0);expect(held.of('p')).toBe(12);
});
