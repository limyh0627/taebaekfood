import type {ItemPhotoProduct} from '../src/features/items/hooks/useItemPhotoSave';
import type {ItemEditorProgress,ItemEditorSaveResult} from '../src/features/items/application/itemEditorSave';
const saved=async(_product:unknown,progress:ItemEditorProgress):Promise<ItemEditorSaveResult>=>{progress.confirmedStageIds.push(...ITEM_EDITOR_STAGES);return {outcome:{status:'saved'},progress};};
/** @vitest-environment jsdom */
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {fireEvent,render,within,waitFor} from '@testing-library/react';
import RealProductModal from './AddItemModal';
import type {ItemEditorOpening} from '../src/features/items/infrastructure/itemEditorWrites';
import {ITEM_EDITOR_STAGES} from '../src/shared/itemEditorCommand';
import {buildBomIndex,getBomIndex,setBomIndex} from '../src/shared/bomIndex';
import {buildPackIndex} from '../src/shared/packIndex';
import type {OrderUnitInputs} from '../src/shared/orderUnits';
import type {Item} from '../src/shared/types';
vi.mock('../src/shared/services/firebaseService',()=>({fetchCollection:vi.fn(async()=>[])}));
vi.mock('../src/shared/firebase',()=>({db:{},storage:{}}));
vi.mock('../src/shared/components/appDialog',()=>({appConfirm:vi.fn(async()=>true),appNotice:vi.fn(async()=>undefined)}));
const original=getBomIndex();afterEach(()=>setBomIndex(original));
const items=(companyId:'taebaek'|'punghoe')=>[
 {id:'box',name:'포장품',spec:'350ml * 20',type:'product',unit:'박스',companyId,stock:0,minStock:0,image:''},
 {id:'unit',name:companyId==='taebaek'?'태백 낱개':'풍회 낱개',spec:'350ml',type:'product',unit:'병',companyId,stock:0,minStock:0,image:''},
 {id:'cap',name:companyId==='taebaek'?'태백 캡':'풍회 캡',type:'submaterial',unit:'개',companyId,stock:0,minStock:0,image:''},
] as Item[];
const inputs=(rows:Item[],qty=20):OrderUnitInputs=>({bom:buildBomIndex(rows,[{parent_id:'box',child_id:'unit',quantity:qty},{parent_id:'unit',child_id:'cap',quantity:1}]),pack:buildPackIndex([])});
const props=(rows:Item[],orderUnitInputs?:OrderUnitInputs)=>({companyId:rows[0].companyId!,initialData:rows[0],items:rows,allSubmaterials:rows,orderUnitInputs,onClose:vi.fn(),onSave:vi.fn(saved)});
it('두 회사 편집창은 각각의 최초 원본을 쓰고 작성 중 구독 갱신으로 바뀌지 않는다',async()=>{
 const a=items('taebaek'),b=items('punghoe'),ai=inputs(a),bi=inputs(b,1);setBomIndex(bi.bom);
 const first=render(<ProductModal {...props(a,ai)}/>);
 await waitFor(()=>expect(document.querySelector('form')).not.toBeNull());
 expect(within(first.container).getAllByText('태백 낱개')[0]).toBeInTheDocument();
 fireEvent.click(within(first.container).getByTitle('완제품 구성 보기'));
 expect(within(first.container).getByText('태백 캡')).toBeInTheDocument();
 setBomIndex(ai.bom);
 const second=render(<ProductModal {...props(b,bi)}/>);
 await waitFor(()=>expect(document.querySelector('form')).not.toBeNull());
 expect(within(second.container).getAllByText('풍회 낱개')[0]).toBeInTheDocument();
 fireEvent.click(within(second.container).getByTitle('완제품 구성 보기'));
 expect(within(second.container).getByText('풍회 캡')).toBeInTheDocument();
 const changed=a.map(row=>row.id==='cap'?{...row,name:'새 태백 캡'}:row);
 first.rerender(<ProductModal {...props(changed,inputs(changed))}/>);
 await waitFor(()=>expect(document.querySelector('form')).not.toBeNull());
 expect(within(first.container).queryByText('새 태백 캡')).not.toBeInTheDocument();
 expect(within(first.container).getByText('태백 캡')).toBeInTheDocument();
 expect(within(second.container).queryByText('새 태백 캡')).not.toBeInTheDocument();
 expect(getBomIndex()).toBe(ai.bom);
});
it('명시 BOM으로 열린 박스는 개입수를 지워도 초안 칸을 유지하고 기존 fallback 저장을 보존한다',async()=>{
 const a=items('taebaek'),b=items('punghoe'),ai=inputs(a),bi=inputs(b,1);setBomIndex(bi.bom);
 const view=render(<ProductModal {...props(a,ai)}/>);
 await waitFor(()=>expect(document.querySelector('form')).not.toBeNull());
 fireEvent.change(within(view.container).getByPlaceholderText('개입수'),{target:{value:''}});
 expect(within(view.container).getByPlaceholderText('개입수')).toBeInTheDocument();
 view.unmount();setBomIndex(ai.bom);
 const fallbackProps=props(a),fallback=render(<ProductModal {...fallbackProps}/>);
 await waitFor(()=>expect(document.querySelector('form')).not.toBeNull());
 fireEvent.click(within(fallback.container).getByRole('button',{name:'수정 완료'}));
 await waitFor(()=>expect(fallbackProps.onSave).toHaveBeenCalledWith(expect.objectContaining({draft:expect.objectContaining({bomDraft:[expect.objectContaining({childId:'unit',qty:20})]})}),expect.any(Object),expect.any(Function)));
 expect(getBomIndex()).toBe(ai.bom);
});

const ProductModal=(props:Omit<React.ComponentProps<typeof RealProductModal>,'onCaptureItemEditorOpening'|'onInspectItemEditor'|'onContinueItemEditor'|'onCancelItemEditor'>)=>{
 const capture=async(targetId:string):Promise<ItemEditorOpening>=>{
  const bom=(props.orderUnitInputs?.bom??getBomIndex()).of(targetId);
  return {companyId:props.companyId,actorUid:'tester',targetId,target:props.initialData?{...props.initialData}:null,targetExpected:null,graph:{schemaVersion:1,...Object.fromEntries(['items','boms','formulas','links'].map(key=>[key,{count:0,digest:'a'.repeat(64)}]))} as ItemEditorOpening['graph'],documents:{items:[...new Map([...(props.initialData?[props.initialData]:[]),...(props.items??[]),...(props.allSubmaterials??[])].map(row=>[row.id,row])).values()].map(row=>({id:row.id,data:{...row}})),boms:bom.map((row,index)=>({id:String(index),data:{parent_id:targetId,child_id:row.childId,quantity:row.qty}})),formulas:[],links:[]}};
 };
 const resolve=async(_ref:unknown,progress:ItemEditorProgress):Promise<ItemEditorSaveResult>=>({progress,outcome:{status:'cancelled',message:'중단'}});
 return <RealProductModal {...props} onCaptureItemEditorOpening={capture} onInspectItemEditor={resolve} onContinueItemEditor={resolve} onCancelItemEditor={resolve}/>;
};
