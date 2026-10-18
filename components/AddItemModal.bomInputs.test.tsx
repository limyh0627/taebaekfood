import type {ItemPhotoProduct} from '../src/features/items/hooks/useItemPhotoSave';
import type {ItemEditorProgress,ItemEditorSaveResult} from '../src/features/items/application/itemEditorSave';
const saved=async(_product:ItemPhotoProduct,progress:ItemEditorProgress):Promise<ItemEditorSaveResult>=>{progress.confirmedStageIds.push('primary');return {outcome:{status:'saved'},progress};};
/** @vitest-environment jsdom */
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {fireEvent,render,within,waitFor} from '@testing-library/react';
import ProductModal from './AddItemModal';
import {buildBomIndex,getBomIndex,setBomIndex} from '../src/shared/bomIndex';
import {buildPackIndex} from '../src/shared/packIndex';
import type {OrderUnitInputs} from '../src/shared/orderUnits';
import type {Item} from '../src/shared/types';
vi.mock('../src/shared/services/firebaseService',()=>({fetchCollection:vi.fn(async()=>[])}));
vi.mock('../src/shared/firebase',()=>({db:{},storage:{}}));
vi.mock('../src/shared/components/appDialog',()=>({appConfirm:vi.fn(async()=>true)}));
const original=getBomIndex();afterEach(()=>setBomIndex(original));
const items=(companyId:'taebaek'|'punghoe')=>[
 {id:'box',name:'포장품',spec:'350ml * 20',type:'product',unit:'박스',companyId,stock:0,minStock:0,image:''},
 {id:'unit',name:companyId==='taebaek'?'태백 낱개':'풍회 낱개',spec:'350ml',type:'product',unit:'병',companyId,stock:0,minStock:0,image:''},
 {id:'cap',name:companyId==='taebaek'?'태백 캡':'풍회 캡',type:'submaterial',unit:'개',companyId,stock:0,minStock:0,image:''},
] as Item[];
const inputs=(rows:Item[],qty=20):OrderUnitInputs=>({bom:buildBomIndex(rows,[{parent_id:'box',child_id:'unit',quantity:qty},{parent_id:'unit',child_id:'cap',quantity:1}]),pack:buildPackIndex([])});
const props=(rows:Item[],orderUnitInputs?:OrderUnitInputs)=>({companyId:rows[0].companyId!,initialData:rows[0],items:rows,allSubmaterials:rows,orderUnitInputs,onClose:vi.fn(),onSave:vi.fn(saved)});
it('두 회사 실제 편집창 초기 구성과 자식 부자재는 명시 BOM을 쓰고 같은 회사 입력 갱신도 반영한다',()=>{
 const a=items('taebaek'),b=items('punghoe'),ai=inputs(a),bi=inputs(b,1);setBomIndex(bi.bom);
 const first=render(<ProductModal {...props(a,ai)}/>);
 expect(within(first.container).getAllByText('태백 낱개')[0]).toBeInTheDocument();
 fireEvent.click(within(first.container).getByTitle('완제품 구성 보기'));
 expect(within(first.container).getByText('태백 캡')).toBeInTheDocument();
 setBomIndex(ai.bom);
 const second=render(<ProductModal {...props(b,bi)}/>);
 expect(within(second.container).getAllByText('풍회 낱개')[0]).toBeInTheDocument();
 fireEvent.click(within(second.container).getByTitle('완제품 구성 보기'));
 expect(within(second.container).getByText('풍회 캡')).toBeInTheDocument();
 const changed=a.map(row=>row.id==='cap'?{...row,name:'새 태백 캡'}:row);
 first.rerender(<ProductModal {...props(changed,inputs(changed))}/>);
 expect(within(first.container).getByText('새 태백 캡')).toBeInTheDocument();
 expect(within(second.container).queryByText('새 태백 캡')).not.toBeInTheDocument();
 expect(getBomIndex()).toBe(ai.bom);
});
it('명시 BOM으로 열린 박스는 개입수를 지워도 초안 칸을 유지하고 기존 fallback 저장을 보존한다',async()=>{
 const a=items('taebaek'),b=items('punghoe'),ai=inputs(a),bi=inputs(b,1);setBomIndex(bi.bom);
 const view=render(<ProductModal {...props(a,ai)}/>);
 fireEvent.change(within(view.container).getByPlaceholderText('개입수'),{target:{value:''}});
 expect(within(view.container).getByPlaceholderText('개입수')).toBeInTheDocument();
 view.unmount();setBomIndex(ai.bom);
 const fallbackProps=props(a),fallback=render(<ProductModal {...fallbackProps}/>);
 fireEvent.click(within(fallback.container).getByRole('button',{name:'수정 완료'}));
 await waitFor(()=>expect(fallbackProps.onSave).toHaveBeenCalledWith(expect.objectContaining({bomDraft:[expect.objectContaining({childId:'unit',qty:20})]}),expect.any(Object),expect.any(Function)));
 expect(getBomIndex()).toBe(ai.bom);
});
