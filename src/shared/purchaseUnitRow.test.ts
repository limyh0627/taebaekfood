import { describe, it, expect } from 'vitest';
import { manualLines } from './statementLines';
import { buildIssuedStatementDraft } from '../features/statements/domain/statementDraft';
import { makePurchaseUnitSnapshot } from './purchaseUnit';
import { changePurchaseUnitRowQuantity, invalidPurchaseUnitRow, defaultPurchaseUnit, defaultPurchaseUnitRowFields } from './purchaseUnitRow';
import type { ItemPurchaseUnit } from './types';
const unit = (weight: number): ItemPurchaseUnit => ({id:'unit',companyId:'taebaek',itemId:'raw',purchaseUnit:'포대',unitKg:weight,isDefault:false,active:true,createdAt:'a',updatedAt:'a'});
const manual = (weight: number, qty='2') => ({itemId:'raw',name:'들깨',spec:'',qty,price:'44000',isTaxExempt:true,...makePurchaseUnitSnapshot(unit(weight),Number(qty))});
describe('전표 매입단위 스냅샷과 거래 수량',()=>{
 it.each([20,22.5,25])('%skg 포대도 금액 수량은 두 포대 그대로',weight=>{const lines=manualLines([manual(weight)],'매입');expect(lines[0]).toMatchObject({qty:2,price:44000,supply:88000,tax:0,inventoryQty:weight*2,purchaseQty:2,unitKg:weight});});
 it('서로 다른 포장과 소수 포대의 중량을 따로 보존한다',()=>{const lines=manualLines([manual(20,'0.5'),manual(22.5,'1.25')],'매입');expect(lines.map(x=>x.inventoryQty)).toEqual([10,28.125]);expect(lines.map(x=>x.qty)).toEqual([0.5,1.25]);});
 it('소수 네 자리 포장 중량도 수량 수정 중 같은 반올림 규칙을 쓴다',()=>{const before=manual(7.1234);const changed=changePurchaseUnitRowQuantity(before,'3');expect(changed.inventoryQty).toBe(21.37);expect(changed.unitKg).toBe(7.1234);});
 it('현재 등록표 변경 없이 저장된 중량으로 수량을 수정한다',()=>{const before=manual(22.5);const changed={...before,...changePurchaseUnitRowQuantity(before,'3'),qty:'3'};expect(changed).toMatchObject({qty:'3',purchaseQty:3,inventoryQty:67.5,unitKg:22.5});expect(before.inventoryQty).toBe(45);});
 it('수량을 비우는 중에도 렌더 계산이 깨지지 않고 저장을 거절한다',()=>{const before=manual(20);const changed={...before,...changePurchaseUnitRowQuantity(before,''),qty:''};const line=manualLines([changed],'매입')[0];expect(line.qty).toBe(0);expect(invalidPurchaseUnitRow(line)).toBe(true);});
 it('레거시 원가 kg는 입고 중량으로 둔갑시키지 않는다',()=>{const line=manualLines([{itemId:'raw',name:'들깨',spec:'',qty:'2',price:'44000',isTaxExempt:true,purchaseQuantityKg:'41'}],'매입')[0];expect(line.purchaseQuantityKg).toBe(41);expect(line.inventoryQty).toBeUndefined();});
 it('발행 스냅샷에 선택된 다섯 필드를 보존한다',()=>{const lines=manualLines([manual(22.5)],'매입');const draft=buildIssuedStatementDraft({identity:{id:'s',docNo:'1'},tradeDate:'2026-10-11',type:'매입',partnerId:'p',partnerName:'매입처',orderIds:[],memo:'',totals:{supply:88000,tax:0,amount:88000},partySnapshot:undefined,lines,allItems:[]});expect(draft.items[0]).toMatchObject({purchaseUnitId:'unit',purchaseUnit:'포대',purchaseQty:2,unitKg:22.5,inventoryQty:45,qty:2});});
});

describe('등록 기본 매입단위 선택',()=>{
 const generic={...unit(20),id:'generic',isDefault:true};
 const specific={...unit(25),id:'specific',partnerId:'supplier',isDefault:true};
 const scope={companyId:'taebaek' as const,itemId:'raw',partnerId:'supplier'};
 it('거래처 기본 하나가 범용 기본보다 우선한다',()=>{expect(defaultPurchaseUnit([generic,specific],scope).unit?.id).toBe('specific');});
 it('거래처 기본이 없으면 범용 기본 하나를 고른다',()=>{expect(defaultPurchaseUnit([generic,{...specific,active:false}],scope).unit?.id).toBe('generic');});
 it('거래처 기본 두 개는 범용으로 회피하지 않고 직접 선택한다',()=>{expect(defaultPurchaseUnit([generic,specific,{...specific,id:'s2'}],scope)).toEqual({unit:null,ambiguous:true});});
 it('범용 기본이 두 개면 임의 first를 쓰지 않는다',()=>{expect(defaultPurchaseUnit([generic,{...generic,id:'g2'}],scope)).toEqual({unit:null,ambiguous:true});});
 it('다른 회사와 품목, 거래처의 기본은 섞지 않는다',()=>{expect(defaultPurchaseUnit([{...specific,companyId:'punghoe'},{...generic,itemId:'other'},{...specific,partnerId:'other'}],scope).unit).toBeNull();});
 it('빈 거래수량을 한 포대로 자동 바꾸지 않는다',()=>{expect(defaultPurchaseUnitRowFields([specific],scope,'')).toMatchObject({purchaseQty:0,inventoryQty:0,unitKg:25});});
});
