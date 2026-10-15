import {describe,expect,it} from 'vitest';
import {isShipMethod,isShippingPartner,resolveDefaultShipMethod} from './partnerShipping';
import type {Partner} from './types';
const partner:Partner={id:'p',name:'합성 거래처',type:'스마트스토어',defaultShipMethod:'화물',shipTos:[{id:'a',name:'첫 배송지',defaultShipMethod:'수령'},{id:'b',name:'둘째 배송지',defaultShipMethod:'배송'},{id:'old',name:'보관',archived:true,defaultShipMethod:'택배'}]};
describe('거래처와 배송지의 기본 배송방식',()=>{
 it.each(['배송','화물','수령','택배'])('현재 방식 %s만 허용한다',value=>expect(isShipMethod(value)).toBe(true));
 it.each([undefined,null,'직접수령','',false,0,{},'항공'])('미설정 및 잘못된 값 %j은 거절한다',value=>expect(isShipMethod(value)).toBe(false));
 it('선택된 활성 배송지가 거래처와 채널보다 우선한다',()=>{expect(resolveDefaultShipMethod(partner,'a')).toBe('수령');expect(resolveDefaultShipMethod(partner,'b')).toBe('배송');});
 it.each([undefined,'missing','old'])('배송지 %s는 다른 배송지를 추정하지 않고 거래처 설정을 따른다',id=>expect(resolveDefaultShipMethod(partner,id)).toBe('화물'));
 it('배송지 미설정 또는 잘못된 값은 거래처로 내려간다',()=>{for(const value of [undefined,null,'직접수령'])expect(resolveDefaultShipMethod({...partner,shipTos:[{id:'a',name:'합성',defaultShipMethod:value} as any]},'a')).toBe('화물');});
 it('거래처 미설정은 기존 채널 기본값으로 돌아간다',()=>{expect(resolveDefaultShipMethod({type:'스마트스토어'})).toBe('택배');expect(resolveDefaultShipMethod({type:'택배'})).toBe('택배');expect(resolveDefaultShipMethod({type:'일반'})).toBe('배송');expect(resolveDefaultShipMethod()).toBe('배송');expect(resolveDefaultShipMethod({type:'일반'},undefined,'택배')).toBe('택배');});
 it('전달된 채널은 명시 거래처 기본값을 덮지 않는다',()=>expect(resolveDefaultShipMethod(partner,undefined,'택배')).toBe('화물'));
 it('설정이나 원배열을 변경하지 않는다',()=>{const before=JSON.stringify(partner);resolveDefaultShipMethod(partner,'a');expect(JSON.stringify(partner)).toBe(before);});
 it.each([undefined,'매출처','매출+매입처'] as const)('배송 선택 대상 %s',value=>expect(isShippingPartner(value)).toBe(true));
 it.each(['매입처','금융기관'] as const)('배송 선택 제외 %s',value=>expect(isShippingPartner(value)).toBe(false));
});
