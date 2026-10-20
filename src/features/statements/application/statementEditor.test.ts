import { expect, it, vi } from 'vitest';
import type { IssuedStatement } from '../../../shared/types';
import { buildStatementEditPatch, captureStatementEdit, executeStatementEdit, type StatementEditWriter } from './statementEditor';
const original: IssuedStatement = { id:'s',companyId:'taebaek',mutationRevision:0,tradeDate:'2026-10-01',issuedAt:'2026-10-01T00:00:00Z',type:'매입',partnerId:'p',partnerName:'거래처',orderId:'',docNo:'원번호',totalSupply:100,totalTax:0,totalAmount:100,items:[] };
const context = () => ({companyId:'taebaek' as const,actorUid:'uid-a',isCurrent:()=>true});
const deferred = () => { let resolve!:()=>void; const promise=new Promise<void>(yes=>resolve=yes);return {promise,resolve}; };
it('최초 선택 revision0과 원문을 고정하고 최신목록 revision을 보충하지 않는다',()=>{
 const captured=captureStatementEdit(original,'s','taebaek');original.items.push({name:'나중',spec:'',qty:1,price:1,supply:1,tax:0,total:1,isTaxExempt:false});
 expect(captured.expectedRevision).toBe(0);expect(captured.original.items).toEqual([]);original.items=[];
 expect(()=>captureStatementEdit(original,'다른번호','taebaek')).toThrow('원문');expect(()=>captureStatementEdit({...original,companyId:'punghoe'},'s','taebaek')).toThrow('원문');
 expect(()=>captureStatementEdit({...original,mutationRevision:-1},'s','taebaek')).toThrow('버전');
 expect(captureStatementEdit({...original,companyId:undefined,mutationRevision:undefined},'s','taebaek').expectedRevision).toBe(0);
});
it('전체 편집 payload는 기존 수량금액과 매입 스냅샷/순번을 그대로 전달한다',()=>{
 const patch=buildStatementEditPatch({tradeDate:'2026-10-02',memo:' 메모 ',partnerId:'p',partnerName:'업체',totalSupply:321,totalTax:12,totalAmount:333,type:'매입',lines:[{key:'x',no:1,name:'품목',spec:'규격',qty:2.5,price:17,supply:321,tax:12,total:333,isTaxExempt:false,purchaseQuantityKg:3.5,side:'차변'}]});
 expect(patch).toEqual({tradeDate:'2026-10-02',memo:'메모',partnerId:'p',partnerName:'업체',totalSupply:321,totalTax:12,totalAmount:333,partySnapshot:undefined,items:[{name:'품목',spec:'규격',qty:2.5,price:17,supply:321,tax:12,total:333,isTaxExempt:false,accountCode:undefined,side:'차변',purchaseQuantityKg:3.5}]});
});
it('원 revision과 actor/current를 writer에 전달하고 ACK 전 후속을 실행하지 않는다',async()=>{
 const wait=deferred(),save=vi.fn<StatementEditWriter>(()=>wait.promise),afterSave=vi.fn(),ctx=context();
 const pending=executeStatementEdit({original,patch:{memo:'변경'},context:ctx,save,afterSave});
 expect(save).toHaveBeenCalledWith('s',{memo:'변경'},expect.objectContaining({mutationRevision:0}),'uid-a',ctx.isCurrent);expect(afterSave).not.toHaveBeenCalled();
 wait.resolve();expect((await pending).status).toBe('saved');expect(afterSave).toHaveBeenCalledWith(ctx.isCurrent);
});
it('미송신 scope불일치/미연결은 not-started이고 void는 ACK가 아니다',async()=>{
 const save=vi.fn<StatementEditWriter>();expect((await executeStatementEdit({original,patch:{},context:{...context(),isCurrent:()=>false},save})).status).toBe('not-started');expect(save).not.toHaveBeenCalled();
 expect((await executeStatementEdit({original,patch:{},context:context()})).status).toBe('not-started');
 expect((await executeStatementEdit({original,patch:{},context:context(),save})).status).toBe('unknown');
});
it('송신 오류는 저장실패 확정이 아닌 unknown과 원인을 보존한다',async()=>{
 const result=await executeStatementEdit({original,patch:{},context:context(),save:vi.fn().mockRejectedValue(Error('응답 유실'))});expect(result).toMatchObject({status:'unknown',acknowledged:false});expect(result.message).toContain('응답 유실');
});
it('늦은 ACK는 후속저장과 현재초안 종결을 허용하지 않는다',async()=>{
 let current=true;const wait=deferred(),afterSave=vi.fn();const pending=executeStatementEdit({original,patch:{},context:{...context(),isCurrent:()=>current},save:()=>wait.promise,afterSave});current=false;wait.resolve();expect(await pending).toMatchObject({status:'stale',acknowledged:true});expect(afterSave).not.toHaveBeenCalled();
});
it('전표 ACK 뒤 가격 후속 실패는 재수정 금지의 부분완료와 원인을 보존한다',async()=>{
 const result=await executeStatementEdit({original,patch:{},context:context(),save:async()=>{},afterSave:async()=>{throw Error('원가 응답 유실');}});expect(result).toMatchObject({status:'partial',acknowledged:true});expect(result.message).toContain('원가 응답 유실');expect(result.message).toContain('다시 수정하지 말고');
});
