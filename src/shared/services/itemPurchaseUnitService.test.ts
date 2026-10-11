import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemPurchaseUnit } from '../types';
const mocks = vi.hoisted(()=>({ previous:{exists:()=>false,data:()=>({})} as any, set:vi.fn(), company:vi.fn(), calls:vi.fn() }));
vi.mock('../firebase',()=>({db:{}}));
vi.mock('./firebaseService',()=>({companyScopedWriteData: (...args:unknown[])=>mocks.company(...args)}));
vi.mock('firebase/firestore',()=>({collection:vi.fn(),doc:(_db:unknown,c:string,id:string)=>({c,id}),onSnapshot:vi.fn(),query:vi.fn(),where:vi.fn(),runTransaction:(_db:unknown,fn:any)=>{mocks.calls();return fn({get:async()=>mocks.previous,set:mocks.set});}}));
import { saveItemPurchaseUnitWithDb } from './itemPurchaseUnitService';
const unit:ItemPurchaseUnit={id:'u',companyId:'taebaek',itemId:'raw',purchaseUnit:'포대',unitKg:22.5,isDefault:false,active:true,createdAt:'2026-10-11T00:00:00Z',updatedAt:'2026-10-11T00:00:00Z'};
beforeEach(()=>{vi.clearAllMocks();mocks.previous={exists:()=>false,data:()=>({})};mocks.company.mockImplementation(async(_c:string,data:unknown)=>data);});
describe('별도 매입단위 표의 저장 경계',()=>{
 it('사용자가 등록한 중량만 별도 문서에 저장하고 품목/재고를 쓰지 않는다',async()=>{await saveItemPurchaseUnitWithDb({} as any,unit);expect(mocks.set).toHaveBeenCalledOnce();expect(mocks.set).toHaveBeenCalledWith({c:'item_purchase_unit',id:'u'},unit);});
 it('회사 claim거절시 transaction도 시작하지 않는다',async()=>{mocks.company.mockRejectedValue(Error('다른 회사'));await expect(saveItemPurchaseUnitWithDb({} as any,{...unit,companyId:'punghoe'})).rejects.toThrow('다른 회사');expect(mocks.calls).not.toHaveBeenCalled();expect(mocks.set).not.toHaveBeenCalled();});
 it.each([{companyId:'punghoe'},{itemId:'other'},{partnerId:'supplier'},{createdAt:'changed'}])('기존 단위의 식별 범위를 다른 자료로 바꿀 수 없다 %j',async changed=>{mocks.previous={exists:()=>true,data:()=>({...unit,...changed})};await expect(saveItemPurchaseUnitWithDb({} as any,unit)).rejects.toThrow('회사·품목·거래처');expect(mocks.set).not.toHaveBeenCalled();});
 it('사용 중지를 저장해도 기존 전표와 입고 문서 쓰기는 없다',async()=>{mocks.previous={exists:()=>true,data:()=>unit};await saveItemPurchaseUnitWithDb({} as any,{...unit,active:false});expect(mocks.set).toHaveBeenCalledOnce();expect(mocks.set.mock.calls[0][1].active).toBe(false);});
 it.each([0,-1,Infinity,NaN])('중량 %s는 Firebase쓰기 전에 거절한다',async unitKg=>{await expect(saveItemPurchaseUnitWithDb({} as any,{...unit,unitKg})).rejects.toThrow();expect(mocks.company).not.toHaveBeenCalled();expect(mocks.set).not.toHaveBeenCalled();});
});
