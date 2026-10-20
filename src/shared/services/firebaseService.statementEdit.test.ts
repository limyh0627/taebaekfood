import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
const source=readFileSync('src/shared/services/firebaseService.ts','utf8');
const parsed=ts.createSourceFile('service.ts',source,ts.ScriptTarget.Latest,true);
let declaration='';parsed.forEachChild(node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text==='editIssuedStatementCommand')declaration=node.getText(parsed).replace(/^export /,'');});
const code=ts.transpileModule(declaration+';return editIssuedStatementCommand;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(yes=>resolve=yes);return{promise,resolve};};
function setup(authReady=Promise.resolve(),release:()=>Promise<string>=async()=> 'release',cryptoPort:Pick<Crypto,'subtle'>=webcrypto as unknown as Crypto){
 const auth={currentUser:{uid:'a'} as {uid:string}|null},call=vi.fn().mockResolvedValue({});
 const run=new Function('authReady','auth','activeReleaseId','httpsCallable','functions','stripUndefined','crypto','TextEncoder',code)(authReady,auth,release,()=>call,{},(value:unknown)=>JSON.parse(JSON.stringify(value)),cryptoPort,TextEncoder) as (...args:unknown[])=>Promise<void>;
 return{auth,call,run};
}
it('정상 기존 4인자 및 승인 5인자는 원 wire를 유지한다',async()=>{const {call,run}=setup();await run('s',{memo:'원문'},0,'operation');expect(call).toHaveBeenLastCalledWith({statementId:'s',patch:{memo:'원문'},expectedRevision:0,operationId:'operation',releaseId:'release'});await run('s',{},0,'approval',{id:'p',memo:'승인'});expect(call).toHaveBeenLastCalledWith(expect.objectContaining({pendingEditRequestId:'p',pendingEditRequestHash:expect.stringMatching(/^[a-f0-9]{64}$/)}));});
it('authReady 대기 중 UID교체는 송신하지 않는다',async()=>{const wait=deferred(),{run,auth,call}=setup(wait.promise);const result=run('s',{},0,'op');auth.currentUser={uid:'b'};wait.resolve();await expect(result).rejects.toThrow('로그인');expect(call).not.toHaveBeenCalled();});
it.each(['uid','scope'])('release 조회 중 %s 교체는 RPC0',async mode=>{const wait=deferred(),{run,auth,call}=setup(Promise.resolve(),async()=>{await wait.promise;return'release';});let current=true;const pending=run('s',{},0,'op',undefined,'a',()=>current);await Promise.resolve();if(mode==='uid')auth.currentUser={uid:'b'};else current=false;wait.resolve();await expect(pending).rejects.toThrow('전송하지');expect(call).not.toHaveBeenCalled();});
it('승인 digest 대기 뒤 UID/current를 다시 검사한다',async()=>{const wait=deferred(),digest=vi.fn(async()=>{await wait.promise;return new Uint8Array(32).buffer;});const {run,auth,call}=setup(Promise.resolve(),async()=> 'release',{subtle:{digest} as unknown as SubtleCrypto});const pending=run('s',{},0,'op',{id:'approval'},'a',()=>true);await vi.waitFor(()=>expect(digest).toHaveBeenCalled());auth.currentUser=null;wait.resolve();await expect(pending).rejects.toThrow('전송하지');expect(call).not.toHaveBeenCalled();});
