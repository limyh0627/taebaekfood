import { describe, it, expect } from 'vitest';
import { manualLines } from './statementLines';
import { buildIssuedStatementDraft } from '../features/statements/domain/statementDraft';
import { makePurchaseUnitSnapshot } from './purchaseUnit';
import { changePurchaseUnitRowQuantity, invalidPurchaseUnitRow, defaultPurchaseUnit, defaultPurchaseUnitRowFields } from './purchaseUnitRow';
import {defaultManualPurchaseUnitRowFields,manualPurchaseUnitRowFields,makeManualPurchaseUnitSnapshot,parseManualPurchaseUnitKg} from './purchaseUnitRow';
import {changeManualPurchaseUnitInput,purchaseUnitInputParts} from './purchaseUnitRow';
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

describe('직접 kg 단위 입력',()=>{
 it('새 기본kg도 스냅샷 다섯 필드가 있고 수량2는 입고2kg다',()=>{expect(defaultManualPurchaseUnitRowFields('2')).toEqual(makeManualPurchaseUnitSnapshot('kg',2));});
 it('20kg·수량2의 거래금액은 두개 그대로이며 입고40kg를 저장한다',()=>{const row={itemId:'raw',name:'들깨',spec:'',qty:'2',price:'44000',isTaxExempt:true,...manualPurchaseUnitRowFields('20kg','2')},line=manualLines([row],'매입')[0];expect(line).toMatchObject({qty:2,price:44000,supply:88000,unitKg:20,inventoryQty:40,purchaseUnitId:'manual-kg'});expect(invalidPurchaseUnitRow(line)).toBe(false);});
 it.each(['','0kg','-20kg','Infinitykg','NaNkg','20oz','20','1e3kg','20kg포'])('잘못 입력한 %s는 그대로 남고 저장을 막는다',value=>{const row={itemId:'raw',name:'들깨',spec:'',qty:'2',price:'44000',isTaxExempt:true,...manualPurchaseUnitRowFields(value,'2')},line=manualLines([row],'매입')[0];expect(row.purchaseUnit).toBe(value);expect(parseManualPurchaseUnitKg(value)).toBeNull();expect(invalidPurchaseUnitRow(line)).toBe(true);expect(()=>changePurchaseUnitRowQuantity(row,'3')).not.toThrow();});
 it('수량0/비유한/빈 입력은 기본단위로도 저장불가다',()=>{for(const qty of ['0','','Infinity','NaN']){const row={name:'들깨',spec:'',qty,price:'1',isTaxExempt:true,...defaultManualPurchaseUnitRowFields(qty)};expect(invalidPurchaseUnitRow(manualLines([row],'매입')[0])).toBe(true);}});
 it.each([['0.0001kg','1'],['kg','0.0001'],['9'.repeat(308)+'kg','2'],['2kg','9'.repeat(308)],['kg','Infinity']])('반올림0·overflow %s/%s는 입력을보존하고 폼예외없이 저장거절', (unit,qty)=>{let fields:ReturnType<typeof manualPurchaseUnitRowFields>={};expect(()=>{fields=manualPurchaseUnitRowFields(unit,qty);}).not.toThrow();expect(fields.purchaseUnit).toBe(unit);expect(fields.inventoryQty).toBe(0);expect(Number.isFinite(fields.purchaseQty)).toBe(true);const row={name:'참깨',spec:'',qty,price:'1',isTaxExempt:true,...fields};expect(row.qty).toBe(qty);expect(invalidPurchaseUnitRow(manualLines([row],'매입')[0])).toBe(true);expect(()=>changePurchaseUnitRowQuantity(fields,qty)).not.toThrow();});
 it('typed 단위의 원문은 입력창에 유지하고 22.5kg×소수수량은 기존반올림을 쓴다',()=>{const row=manualPurchaseUnitRowFields(' 022.500 KG ','0.5');expect(row).toMatchObject({purchaseUnit:' 022.500 KG ',unitKg:22.5,inventoryQty:11.25});expect(changePurchaseUnitRowQuantity(row,'1.25')).toMatchObject({unitKg:22.5,inventoryQty:28.125});});
 it('숫자20은kg/g선택시그대로이며20g수량2는.04kg다',()=>{const kg=changeManualPurchaseUnitInput('20','kg','2'),g=changeManualPurchaseUnitInput('20','g','2');expect(purchaseUnitInputParts(kg)).toEqual({amount:'20',unit:'kg',legacy:false});expect(purchaseUnitInputParts(g)).toEqual({amount:'20',unit:'g',legacy:false});expect(g).toMatchObject({purchaseUnit:'20g',unitKg:.02,inventoryQty:.04});});
 it('기본kg는숫자1로보이고registered포대는기존중량20을표시만한다',()=>{expect(purchaseUnitInputParts(defaultManualPurchaseUnitRowFields('2'))).toEqual({amount:'1',unit:'kg',legacy:false});expect(purchaseUnitInputParts(makePurchaseUnitSnapshot(unit(20),2))).toEqual({amount:'20',unit:'포대',legacy:true});});
 it.each(['','.','0.'])('숫자부분 %s를지우거나편집중에도kg/g기본1로살아나지않는다',amount=>{for(const measure of ['kg','g'] as const){const fields=changeManualPurchaseUnitInput(amount,measure,'2');expect(purchaseUnitInputParts(fields)).toMatchObject({amount,unit:measure});expect(fields.inventoryQty).toBe(0);const after=changePurchaseUnitRowQuantity(fields,'3');expect(after.inventoryQty).toBe(0);expect(invalidPurchaseUnitRow({...after,qty:3})).toBe(true);}});
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
