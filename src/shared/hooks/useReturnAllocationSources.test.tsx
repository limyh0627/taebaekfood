// @vitest-environment jsdom
import {renderHook,act,waitFor} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {useReturnAllocationSources} from './useReturnAllocationSources';
const operation:any={id:'op',companyId:'taebaek',journalId:'journal',applications:[{id:'app',statementId:'source',amount:20}]};
const defer=()=>{let resolve!:(x:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve}};
describe('반품 원전표 실제존재 읽기 context',()=>{
 it('조회불참은미정이며성공한회사질의의부재만삭제증거가된다',async()=>{const pending=defer(),load=vi.fn(()=>pending.promise),statements:any[]=[],ops=[operation],uid=()=> 'actor';const {result}=renderHook(()=>useReturnAllocationSources('taebaek',true,ops,statements,load,'actor',uid));expect(result.current).toBeUndefined();expect(load).toHaveBeenCalledWith(['source'],'taebaek');await act(async()=>pending.resolve([]));expect(result.current?.[0].sourcePresence).toEqual({source:false});expect(operation).not.toHaveProperty('sourcePresence')});
 it('기간밖실존source는삭제credit으로추정하지않는다',async()=>{const load=vi.fn(async()=>[{id:'source',companyId:'taebaek'} as any]),statements:any[]=[],ops=[operation],uid=()=> 'actor';const {result}=renderHook(()=>useReturnAllocationSources('taebaek',true,ops,statements,load,'actor',uid));await waitFor(()=>expect(result.current?.[0].sourcePresence).toEqual({source:true}))});
 it('회사전환뒤늦은A응답은B존재증거를덮지않는다',async()=>{const a=defer(),b=defer(),load=vi.fn((_ids:string[],co:string)=>co==='taebaek'?a.promise:b.promise),statements:any[]=[],ops=[operation],other=[{...operation,companyId:'punghoe'}],uid=()=> 'actor';const {result,rerender}=renderHook(({co,rows}:any)=>useReturnAllocationSources(co,true,rows,statements,load,'actor',uid),{initialProps:{co:'taebaek',rows:ops}});rerender({co:'punghoe',rows:other});expect(result.current).toBeUndefined();await act(async()=>b.resolve([{id:'source',companyId:'punghoe'}]));await act(async()=>a.resolve([]));expect(result.current?.[0].companyId).toBe('punghoe');expect(result.current?.[0].sourcePresence).toEqual({source:true})});
 it('UID전환또는조회실패는삭제로확정하지않는다',async()=>{const p=defer(),load=vi.fn(()=>p.promise),statements:any[]=[],ops=[operation];let actor='a';const uid=()=>actor;const {result}=renderHook(()=>useReturnAllocationSources('taebaek',true,ops,statements,load,'a',uid));actor='b';await act(async()=>p.resolve([]));expect(result.current).toBeUndefined()});
});

it('같은회사·ops·statement의명시삭제refresh는옛존재증거를즉시보류하고재조회한다',async()=>{
 const first=defer(),second=defer(),load=vi.fn().mockImplementationOnce(()=>first.promise).mockImplementationOnce(()=>second.promise),statements:any[]=[],ops=[operation],uid=()=> 'actor';
 const {result,rerender}=renderHook(({token})=>useReturnAllocationSources('taebaek',true,ops,statements,load,'actor',uid,token),{initialProps:{token:0}});
 await act(async()=>first.resolve([{id:'source',companyId:'taebaek'}]));expect(result.current?.[0].sourcePresence).toEqual({source:true});
 rerender({token:1});expect(result.current).toBeUndefined();expect(load).toHaveBeenCalledTimes(2);
 await act(async()=>second.resolve([]));expect(result.current?.[0].sourcePresence).toEqual({source:false});
});
