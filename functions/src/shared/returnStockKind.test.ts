import {describe,it,expect} from 'vitest';
import {returnStockKind} from './returnStockKind';
const goods={id:'goods',companyId:'taebaek' as const,type:'goods',name:'참깨',unit:'개',stock:3,lots:[]};
const holder={id:'raw',companyId:'taebaek' as const,type:'raw',name:'참깨',subtype:'벌크',unit:'kg'};
describe('상품 반품은 자기 SKU 수량 로트로 분류한다',()=>{
 it.each(['개','kg','L'])('상품 단위 %s는 같은 이름 원료 홀더와 무관하다',unit=>{expect(returnStockKind('taebaek',{...goods,unit},[holder])).toBe('unit');expect(returnStockKind('taebaek',{...goods,unit,lots:[{}]},[holder])).toBe('unit');});
 it('명시 원료 별칭은 기존 원료 경로를 보존한다',()=>{expect(returnStockKind('taebaek',{...goods,rawMaterialName:'참깨'},[holder])).toBe('raw');});
 it('부자재는 일반 수량이며 원로트가 있으면 임의 반품 변환하지 않는다',()=>{expect(returnStockKind('taebaek',{...goods,type:'submaterial',name:'뚜껑'},[])).toBe('general');expect(returnStockKind('taebaek',{...goods,type:'submaterial',name:'뚜껑',lots:[{}]},[])).toBe('unsupported');});
 it('벌크·다른 회사·손상 로트는 상품 수량으로 바꾸지 않는다',()=>{expect(returnStockKind('taebaek',{...goods,subtype:'벌크'},[holder])).toBe('raw');expect(returnStockKind('punghoe',goods,[holder])).toBe('unsupported');expect(returnStockKind('taebaek',{...goods,lots:{} as any},[])).toBe('unsupported');});
});
