import {expect,it} from 'vitest';
import {filterTemplates,missingTemplateAccountCodes,activeTemplateId,activeTemplate} from './cashTemplateSelection';
import {CASH_TEMPLATES} from './cashTemplateCatalog';
import * as catalog from './cashTemplateCatalog';
import * as legacy from '../../../shared/cashTemplates';
it('facade는 단일 catalog와 선택함수의 동일 binding을 공개한다',()=>{for(const [key,value] of Object.entries(catalog))expect((legacy as Record<string,unknown>)[key]).toBe(value);expect(legacy.filterTemplates).toBe(filterTemplates);expect(legacy.missingTemplateAccountCodes).toBe(missingTemplateAccountCodes);expect(legacy.activeTemplateId).toBe(activeTemplateId);expect(legacy.activeTemplate).toBe(activeTemplate);});
it('저장양식이 있으면 seed를 섞지 않고 숨김을 제외하며 숫자계정순과 미지정선두를 보존한다',()=>{
 const codes=[{code:'2'},{code:'10'}] as any;const saved=[{id:'ten',kind:'voucher',name:'십',accountCode:'10'},{id:'hidden',kind:'voucher',name:'숨김',hidden:true},{id:'two',kind:'voucher',name:'이',accountCode:'2'},{id:'none',kind:'voucher',name:'미지정',mode:'급여'}] as any;
 const rows=filterTemplates(codes,saved);expect(rows.map(r=>r.id)).toEqual(['none','two','ten']);expect(rows[0].hint).toBe('총급여 − 공제');expect(activeTemplateId(rows,{mode:'일반'})).toBeNull();expect(activeTemplate(rows,{mode:'일반',accountCode:'10'})).toBe(rows[2]);expect(activeTemplateId(rows,{mode:'급여'})).toBe('none');
});
it('계정누락은 순서대로 중복제거하며 숨김뿐이면 원 seed를 변형하지 않고 fallback한다',()=>{
 expect(missingTemplateAccountCodes({accountCode:'2',loanCode:'2',transferLines:[{accountCode:'10'},{accountCode:'3'}]} as any,new Set(['3']))).toEqual(['2','10']);const snapshot=JSON.stringify(CASH_TEMPLATES);const rows=filterTemplates([],[{id:'h',kind:'voucher',hidden:true}] as any);expect(rows.length).toBe(CASH_TEMPLATES.length);expect(rows[0]).not.toBe(CASH_TEMPLATES[0]);expect(JSON.stringify(CASH_TEMPLATES)).toBe(snapshot);
});