import {expect,it} from 'vitest';
import {Timestamp,GeoPoint} from 'firebase-admin/firestore';
import {encode,decode,hash,resolveZeroItemPriceBackupPath} from './zeroItemPriceBackup';
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

it('공용 백업 경로는 원본과 명시 v2 이상만 받고 회사·날짜·안전 정수 revision을 고정한다',()=>{
 const original=resolveZeroItemPriceBackupPath('taebaek','work/zero-item-price-taebaek-20261015.json'),next=resolveZeroItemPriceBackupPath('taebaek','work/zero-item-price-taebaek-20261015-v2.json');
 expect(original.revision).toBe(1);expect(next.revision).toBe(2);expect(next.family).toBe(original.family);
 for(const name of ['zero-item-price-taebaek-20261015-v1.json','zero-item-price-taebaek-20261015-v02.json','zero-item-price-taebaek-20261015-v0.json','zero-item-price-taebaek-20261015-v-2.json','zero-item-price-taebaek-20261015-v2.5.json','zero-item-price-taebaek-20261015-v9007199254740992.json','zero-item-price-punghoe-20261015-v2.json','zero-item-price-taebaek-20261016-v2.json'])expect(()=>resolveZeroItemPriceBackupPath('taebaek','work/'+name)).toThrow();
 expect(()=>resolveZeroItemPriceBackupPath('taebaek','other/zero-item-price-taebaek-20261015-v2.json')).toThrow();
});
