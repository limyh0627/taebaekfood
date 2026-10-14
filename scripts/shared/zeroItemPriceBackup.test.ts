import {expect,it} from 'vitest';
import {Timestamp,GeoPoint} from 'firebase-admin/firestore';
import {encode,decode,hash} from './zeroItemPriceBackup';
import {prepareZeroItemPrice,checkPlan} from './zeroItemPriceMigration';

it('추출 전 CLI의 고정 표본 hash와 Timestamp·특수 숫자 백업을 그대로 유지한다',()=>{
 const input={z:undefined,a:new Timestamp(100,123456789),n:[-0,NaN,Infinity,-Infinity,{b:2,a:1}]};
 expect(hash(input)).toBe('4d29686f35b42b468f120467440cd188278d3d6b4f901029fc33d7720406f1a2');
 const restored=decode(JSON.parse(JSON.stringify(encode(input))));expect(restored).toEqual(input);expect(restored.a).toBeInstanceOf(Timestamp);expect(restored.a.nanoseconds).toBe(123456789);expect(Object.is(restored.n[0],-0)).toBe(true);
 expect(hash({n:input.n,a:input.a,z:undefined})).toBe(hash(input));
});

it('이전 codec의 지원 불가 타입과 예약 키 거절을 유지한다',()=>{
 for(const value of [new GeoPoint(1,2),Buffer.from('synthetic'),{__zeroMigrationType:'timestamp'},{nested:{__zeroMigrationType:'number'}}])expect(()=>encode(value)).toThrow('지원하지 않는 원문 타입');
});

it('완전한 plan 백업 왕복 후 기존 checkPlan과 hash가 같다',()=>{
 const data={companyId:'taebaek',price:0,name:'합성',timestamp:new Timestamp(1,7),nested:{values:[undefined,-0,NaN]}};
 const plan=prepareZeroItemPrice('taebaek',[{id:'SYNTHETIC',data,version:{seconds:2,nanoseconds:9}}]);
 const saved=decode(JSON.parse(JSON.stringify(encode({plan,planHash:hash(plan)}))));expect(()=>checkPlan(saved.plan)).not.toThrow();expect(saved.plan).toEqual(plan);expect(hash(saved.plan)).toBe(saved.planHash);expect(data.price).toBe(0);
});
