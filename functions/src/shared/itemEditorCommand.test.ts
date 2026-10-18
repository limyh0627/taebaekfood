import {it,expect} from 'vitest';
import {normalizeItemEditorReference,normalizeItemEditorResult,itemEditorGraphProjection,itemEditorTargetExpected,itemEditorDisplayMatches,ITEM_EDITOR_STAGES} from './itemEditorCommand';
const reference={companyId:'taebaek' as const,targetId:'품목'.repeat(200),planId:'plan'};
it('기존 한글·긴 문서 ID는 새 계획 180자 제한과 분리한다',()=>{expect(normalizeItemEditorReference(reference)).toEqual(reference);for(const id of ['a/b','..','__reserved__','가'.repeat(501)])expect(()=>normalizeItemEditorReference({...reference,targetId:id})).toThrow();});
it('graph는 실제 문서 ID·body id 존재성을 구분하고 재고만 바뀌면 동일하다',()=>{
 const base={id:'doc',data:{companyId:'taebaek',type:'product',name:'품목',stock:1}};
 expect(itemEditorGraphProjection('items',[base])).toEqual(itemEditorGraphProjection('items',[{...base,data:{...base.data,stock:99}}]));
 expect(itemEditorGraphProjection('items',[base])).not.toEqual(itemEditorGraphProjection('items',[{...base,data:{...base.data,id:'doc'}}]));
 expect(itemEditorTargetExpected(base.data)).not.toEqual(itemEditorTargetExpected({...base.data,cost:null}));
});
it('표시 SMARTSTORE 파생값은 같은 정본으로 대조하되 실제 metadata 차이는 숨기지 않는다',()=>{
 const raw={companyId:'taebaek',name:'품목',type:'product',partnerIds:['SMARTSTORE','other']};expect(itemEditorDisplayMatches({...raw,isSmartStore:true,partnerIds:['sales']},raw)).toBe(true);expect(itemEditorDisplayMatches({...raw,name:'다른 이름'},raw)).toBe(false);
});
it('응답은 순서·선행 ACK·완료 상태·hash·회사·UID를 모두 대조한다',()=>{
 const result={...reference,actorUid:'actor',requestHash:'a'.repeat(64),status:'active',confirmedStageIds:['primary'],message:'확인'};
 expect(normalizeItemEditorResult(result,reference,'actor','a'.repeat(64)).status).toBe('active');
 for(const patch of [{confirmedStageIds:['bom-cost']},{confirmedStageIds:['primary','primary']},{status:'completed'},{status:'active',confirmedStageIds:ITEM_EDITOR_STAGES},{status:'rejected',requestHash:null,confirmedStageIds:[]},{actorUid:'other'},{companyId:'punghoe'}])expect(()=>normalizeItemEditorResult({...result,...patch},reference,'actor')).toThrow();
 expect(()=>normalizeItemEditorResult(result,reference,'actor','b'.repeat(64))).toThrow();expect(normalizeItemEditorResult({...result,status:'cancelled',requestHash:null,confirmedStageIds:[]},reference,'actor').status).toBe('cancelled');
});
