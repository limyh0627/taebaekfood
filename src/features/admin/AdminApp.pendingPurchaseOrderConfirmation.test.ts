import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { PurchaseOrder } from '../../shared/types';
const file = ts.createSourceFile('AdminApp.tsx', readFileSync('src/features/admin/AdminApp.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(deps: Record<string, unknown>) {
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'handleConfirmPendingToInvoiced') expression = node.initializer; ts.forEachChild(node, visit); }; visit(file);
  if (!expression) throw new Error('실제 발주확정 handler 없음');
  const body = ts.transpileModule(`const execute=${expression.getText(file)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(deps), body + ';return execute;')(...Object.values(deps)) as (selected: {id:string;quantity:number}[]) => Promise<void>;
}
const po = (id: string): PurchaseOrder => ({id,companyId:'taebaek',status:'pending',itemId:'material',itemName:'재료',quantity:3,createdAt:'2026-10-12',partnerId:'chosen-partner'});
function harness() {
  const originals=[po('first'),po('second')], scope={current:{token:{},companyId:'taebaek'}}, auth={currentUser:{uid:'employee'} as {uid:string}|null};
  const command=vi.fn().mockResolvedValue({status:'confirmed'}), notice=vi.fn().mockResolvedValue(undefined), oldWriter=vi.fn();
  const run=handler({companyId:'taebaek',purchaseOrders:originals,orderAskScope:scope,auth,confirmPendingPurchaseOrder:command,awaitNotice:notice,updateItem:oldWriter,partnerIn:[{itemId:'material',partnerId:'wrong-first-partner'}],partners:[]});
  return {run,originals,scope,auth,command,notice,oldWriter};
}
function deferred() { let resolve!:()=>void; let reject!:(reason:Error)=>void; const promise=new Promise<void>((done,fail)=>{resolve=done;reject=fail});return {promise,resolve,reject}; }
describe('실제 AdminApp 발주확정 callback',()=>{
  it('선택 원문과 거래처를 그대로 서비스에 전달하고 generic writer를 종료한다',async()=>{
    const h=harness();await h.run([{id:'first',quantity:99},{id:'second',quantity:0}]);
    expect(h.command.mock.calls).toEqual([['taebaek',h.originals[0]],['taebaek',h.originals[1]]]);expect(h.command.mock.calls[0][1].partnerId).toBe('chosen-partner');expect(h.oldWriter).not.toHaveBeenCalled();expect(h.notice).not.toHaveBeenCalled();
  });
  it('정상 동일원문 재확정도 서비스의 idempotent 판정을 소비한다',async()=>{
    const h=harness();h.command.mockResolvedValue({status:'already-confirmed'});await h.run([{id:'first',quantity:3}]);expect(h.command).toHaveBeenCalledOnce();expect(h.notice).not.toHaveBeenCalled();
  });
  it('삭제·입고·원문변경 거절은 현재 회사에 안내하고 다음 발주를 쓰지 않는다',async()=>{
    const h=harness();h.command.mockRejectedValue(new Error('발주 내용이 변경됐습니다'));await h.run([{id:'first',quantity:3},{id:'second',quantity:3}]);expect(h.command).toHaveBeenCalledOnce();expect(h.notice).toHaveBeenCalledWith('발주 내용이 변경됐습니다','발주확정 중단');
  });
  it('승인 대상이 없어졌으면 조용히 skip하지 않고 중단한다',async()=>{
    const h=harness();await h.run([{id:'deleted',quantity:3},{id:'second',quantity:3}]);expect(h.command).not.toHaveBeenCalled();expect(h.notice).toHaveBeenCalledWith(expect.stringContaining('삭제'),'발주확정 중단');
  });
  it.each(['company','uid','same-company-session'] as const)('%s 전환 뒤 이전 완료가 남은 발주를 확정하지 않는다',async kind=>{
    const h=harness(), gate=deferred();h.command.mockReturnValueOnce(gate.promise);const pending=h.run([{id:'first',quantity:3},{id:'second',quantity:3}]);
    if(kind==='uid')h.auth.currentUser={uid:'other'};else h.scope.current={token:{},companyId:kind==='company'?'punghoe':'taebaek'};
    gate.resolve();await pending;expect(h.command).toHaveBeenCalledOnce();expect(h.notice).not.toHaveBeenCalled();
  });
  it('이전 회사의 늦은 실패가 새 회사에 오류를 띄우지 않는다',async()=>{
    const h=harness(),gate=deferred();h.command.mockReturnValueOnce(gate.promise);const pending=h.run([{id:'first',quantity:3}]);h.scope.current={token:{},companyId:'punghoe'};gate.reject(new Error('태백 늦은 오류'));await pending;expect(h.notice).not.toHaveBeenCalled();
  });
  it('확정 기다리는 동안 구독이 바뀌어도 두번째 원문을 갈아 끼우지 않는다',async()=>{
    const h=harness(),gate=deferred(),second=h.originals[1];h.command.mockReturnValueOnce(gate.promise);const pending=h.run([{id:'first',quantity:3},{id:'second',quantity:3}]);h.originals[1]={...second,quantity:50};gate.resolve();await pending;expect(h.command.mock.calls[1]).toEqual(['taebaek',second]);
  });
  it('로그아웃 또는 이미 바뀐 회사는 호출하지 않는다',async()=>{
    const h=harness();h.auth.currentUser=null;await h.run([{id:'first',quantity:3}]);h.auth.currentUser={uid:'employee'};h.scope.current.companyId='punghoe';await h.run([{id:'first',quantity:3}]);expect(h.command).not.toHaveBeenCalled();
  });
});
