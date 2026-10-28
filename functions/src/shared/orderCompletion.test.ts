import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {OrderStatus,isWorkCompletedState,requiresCompleteItemsForStatusChange,hasCompleteOrderItems} from './orderCompletion';
import {OrderStatus as AppOrderStatus} from '../../../src/shared/types';
import {hasCompleteOrderItems as appComplete} from '../../../src/shared/orderCompletion';
const source=execFileSync('git',['show','3e164b6:src/shared/orderCompletion.ts'],{encoding:'utf8'}),start=source.indexOf('const WORK_COMPLETION_STATES'),end=source.indexOf('/** 작업 전 세 단계',start),js=ts.transpileModule(source.slice(start,end).split('export function').join('function'),{compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.None}}).outputText,old=Function('OrderStatus',js+';return {isWorkCompletedState,requiresCompleteItemsForStatusChange,hasCompleteOrderItems};')(OrderStatus);
it('OC01 enum identity와 36상태전이/완료판정은 실제HEAD 원본문과 같다',()=>{expect(AppOrderStatus).toBe(OrderStatus);for(const from of Object.values(OrderStatus)){expect(isWorkCompletedState(from)).toBe(old.isWorkCompletedState(from));for(const to of Object.values(OrderStatus))expect(requiresCompleteItemsForStatusChange(from,to)).toBe(old.requiresCompleteItemsForStatusChange(from,to));}});
it.each([[],[{}],[{checked:false}],[{checked:true}],[{checked:true},{}],[{checked:1}],[{checked:'true'}]].map(items=>({items})))('OC02 미체크를 추정하지 않는 원배열 판정 ',({items})=>{expect(hasCompleteOrderItems(items as any)).toBe(old.hasCompleteOrderItems(items));expect(appComplete(items as any)).toBe(old.hasCompleteOrderItems(items));});

