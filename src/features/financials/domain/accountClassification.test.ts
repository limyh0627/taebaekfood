import {expect,it} from 'vitest';
import * as direct from './accountClassification';
import * as legacy from '../../admin/financials';
import * as profitLoss from './profitLoss';
import * as cashFlowDirect from './cashFlowDirect';
import type {AccountCode,AccountGroup} from '../../../shared/types';
it('기존 financials 경로는 같은 Set와 함수 binding을 공개한다',()=>{for(const [key,value] of Object.entries({...direct,...profitLoss,...cashFlowDirect}))expect((legacy as Record<string,unknown>)[key]).toBe(value);});
it('옛 그룹도 실제 원객체·id를 보존하고 통합·raw 폴백만 적용한다',()=>{
 const original={id:'ag-selling',type:'비용',plLine:'sgna'} as AccountGroup,merged={id:'ag-sgna',type:'비용',plLine:'sgna'} as AccountGroup;
 const codes=[{code:'10',groupId:'ag-selling'},{code:'20',groupId:'absent'},{code:'30'}] as AccountCode[];
 expect(direct.makeCodeToGroup(codes,[original,merged],[original])('10')).toBe(original);
 expect(direct.makeCodeToGroup(codes,[merged],[original])('10')).toBe(merged);
 expect(direct.makeCodeToGroup(codes,[],[original])('10')).toBe(original);
 expect(direct.makeCodeToGroup(codes,[original],[])('20')).toBeUndefined();expect(direct.makeCodeToGroup(codes,[original],[])(undefined)).toBeUndefined();expect(original.id).toBe('ag-selling');
});
it('없는 그룹과 미지정 계정은 감추지 않고 숫자순 정렬하며 입력 배열은 보존한다',()=>{
 const codes=[{code:'10',groupId:'expense'},{code:'2',groupId:'revenue'},{code:'3',groupId:'missing'},{code:'1'}] as AccountCode[],groups=[{id:'expense',type:'비용'},{id:'revenue',type:'수익'}] as AccountGroup[];
 expect(direct.filterCodesForContext(codes,groups,'매출').map(c=>c.code)).toEqual(['1','2','3']);expect(direct.filterCodesForContext(codes,groups,'매입').map(c=>c.code)).toEqual(['1','3','10']);expect(direct.filterCodesForContext(codes,groups,'자금').map(c=>c.code)).toEqual(['1','2','3','10']);expect(codes.map(c=>c.code)).toEqual(['10','2','3','1']);
});
it('대체 문맥은 표준현금과 예금 이름만 제외하고 일반 부채·비용은 유지한다',()=>{
 const codes=[{code:'102',name:'표준 코드'},{code:'101',name:'현금'},{code:'103',name:'기본 통장'},{code:'900',name:'제예금'},{code:'901',name:'당좌예금'},{code:'260',name:'차입금'},{code:'951',name:'이자비용'}] as AccountCode[];
 expect(direct.isCashAccountCode(undefined,codes)).toBe(false);expect(direct.filterCodesForContext(codes,[],'대체').map(c=>c.code)).toEqual(['260','951']);
});