// @vitest-environment jsdom
import React,{useRef,useState} from 'react';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {act,cleanup,render,renderHook,screen,fireEvent,within,waitFor} from '@testing-library/react';
import ModalShell from '../../shared/components/ModalShell';
import ActionButton from '../../shared/components/ActionButton';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useOrderCopyRecovery,type OrderCopyEvidence} from './hooks/useOrderCopyRecovery';
import type {Order} from '../../shared/types';
import type {OrderInterpretationRequest} from '../../shared/orderInterpretation';
import type {OrderCopyRecoveryEntry,OrderCopyRecoveryObservation} from '../../shared/services/orderCopyService';
const api=vi.hoisted(()=>({auth:{currentUser:{uid:'actor'}},nextOrderNo:vi.fn(()=> 'ORD-261014-001'),lines:vi.fn((rows:Order['items'])=>rows.map((row,index)=>({...row,lineId:`first-${index}`})))}));
vi.mock('../../shared/firebase',()=>({auth:api.auth,authReady:Promise.resolve()}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,listener:(user:{uid:string}|null)=>void)=>{listener(api.auth.currentUser);return()=>{};}}));
vi.mock('../../shared/services/orderCopyService',()=>({orderCopyRecoveryServices:{}}));
vi.mock('../../shared/day',()=>({today:()=> '2026-10-14'}));
vi.mock('../../shared/cardNo',()=>({nextOrderNo:api.nextOrderNo}));
vi.mock('../../shared/orderLineInventory',()=>({ensureOrderLineIds:api.lines}));
const draft:Omit<Order,'id'|'status'>={partnerId:'partner',partnerName:'거래처',createdAt:'2026-10-14T00:00:00Z',deliveryDate:'2026-10-15T00:00:00Z',items:[{itemId:'oil',name:'참기름',quantity:24,price:100,isBoxUnit:true,boxQuantity:2,unitsPerBox:12,orderedAs:'참기름 2박스'}],totalAmount:2400,email:'',source:'일반',shipMethod:'배송',region:'미지정',pallets:[]};
const evidence:OrderCopyEvidence={sourceText:'  참기름 2박스\n',firstAnalysis:{kind:'rules',lines:[{qty:2}]},inputLines:[{orderedAs:'참기름 2박스',itemId:'oil',quantity:2,isBoxUnit:true}]};
const unknown=():OrderCopyRecoveryObservation=>({terminal:false,outcome:{status:'unknown',message:'처리 결과를 확인하지 못했습니다.',nextAction:'같은 요청을 확인해 주세요.'}});
function entryOf(request:OrderInterpretationRequest):OrderCopyRecoveryEntry{return {key:request.requestId,bodyText:JSON.stringify(request),referenceText:'관측 참조 A',reference:{companyId:request.companyId,requestId:request.requestId},request,requestHash:'a'.repeat(64),referenceHash:'a'.repeat(64),orderId:String(request.confirmed.orderDraft.id),status:'valid',description:'거래처 · 최초 주문'};}
function fixture(){
 const entries:OrderCopyRecoveryEntry[]=[],committed=vi.fn();
 const send=vi.fn(async(request:OrderInterpretationRequest,_current:()=>boolean=()=>true):Promise<OrderCopyRecoveryObservation>=>{if(!entries.some(row=>row.reference?.requestId===request.requestId))entries.push(entryOf(request));return unknown();});
 const services={read:vi.fn(async()=>[...entries]),send,reconnect:vi.fn(async()=>unknown()),resolve:vi.fn(async()=>unknown()),retry:vi.fn(async(_scope:unknown,entry:OrderCopyRecoveryEntry,current:()=>boolean=()=>true)=>entry.request?send(entry.request,current):unknown()),discard:vi.fn(async():Promise<{status:'cleared'|'blocked';message:string}>=>({status:'cleared',message:'이 기기 사본만 정리했습니다.'})),list:vi.fn(async()=>({version:1 as const,companyId:'taebaek' as const,actorUid:'actor',entries:[],nextCursor:null}))};
 const view=renderHook(()=>useOrderCopyRecovery({companyId:'taebaek',orders:[],onCommitted:committed},services));
 const ready=async()=>{await waitFor(()=>expect(view.result.current.readLoading).toBe(false));act(()=>{view.result.current.openDraft(evidence.sourceText,'chat-first');});};
 const save=async(value=draft,input=evidence)=>{act(()=>view.result.current.updateSourceText(input.sourceText));await act(()=>view.result.current.save(value,input));};
 const recover=async(entry:OrderCopyRecoveryEntry,action:'inspect'|'retry'|'discard')=>{await act(()=>action==='inspect'?view.result.current.inspect(entry):action==='retry'?view.result.current.retry(entry):view.result.current.discardCopy(entry));};
 const applied=(entry:OrderCopyRecoveryEntry):OrderCopyRecoveryObservation=>({terminal:true,outcome:{status:'saved'},result:{version:1,reference:entry.reference!,actorUid:'actor',status:'applied',requestHash:'a'.repeat(64),message:'주문 저장 완료',orderId:entry.orderId!}});
 return {view,entries,services,committed,ready,save,recover,applied};
}
beforeEach(()=>{vi.clearAllMocks();api.auth.currentUser.uid='actor';});
afterEach(()=>{cleanup();vi.useRealTimers();});
it('거절 확인 후 명시적으로 재작성할 때만 선택한 주문 내용을 복원하고 미확인 내용은 복원하지 않는다',async()=>{
 const f=fixture();await f.ready();await f.save();const entry=f.entries[0];act(()=>{f.view.result.current.rewrite(entry);});expect(f.view.result.current.initialText).toBe(evidence.sourceText);
 act(()=>f.view.result.current.updateSourceText('보존할 새 초안'));act(()=>f.view.result.current.rewrite(entry));expect(f.view.result.current.sourceText).toBe('보존할 새 초안');
 f.services.resolve.mockResolvedValueOnce({terminal:true,outcome:{status:'rejected',message:'주문 내용을 확인해 주세요.'},result:{...f.applied(entry).result!,status:'rejected',message:'품목 확인'}});await f.recover(entry,'inspect');
 const oldVersion=f.view.result.current.draftVersion;act(()=>f.view.result.current.rewrite(entry));expect(f.view.result.current.initialText).toBe(evidence.sourceText);expect(f.view.result.current.sourceChatMessageId).toBe('chat-first');expect(f.view.result.current.draftVersion).toBeGreaterThan(oldVersion);expect(f.services.send).toHaveBeenCalledOnce();
});
it.each([false,true])('A 저장 확인 전후에 입력한 B 초안은 아직 저장하지 않아도 유지한다: %s',async during=>{
 const f=fixture();await f.ready();await f.save();const entry=f.entries[0];let finish!:(value:OrderCopyRecoveryObservation)=>void;f.services.resolve.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));
 if(!during)act(()=>f.view.result.current.updateSourceText('B 초안'));let work!:Promise<void>;act(()=>{work=f.view.result.current.inspect(entry);});act(()=>f.view.result.current.updateSourceText('B 초안'));await act(async()=>{finish(f.applied(entry));await work;});
 expect(f.committed).toHaveBeenCalledWith(entry.orderId,false);expect(f.view.result.current.draftOpen).toBe(true);expect(f.view.result.current.sourceText).toBe('B 초안');
});
it.each(['',evidence.sourceText])('재접속 후 준비 ref 없는 과거 완료는 현재 새 입력을 닫지 않고 기존 주문만 연다: %s',async text=>{
 const f=fixture();await f.ready();await f.save();const entry=f.entries[0];act(()=>{f.view.result.current.closeDraft();f.view.result.current.openDraft(text);});f.services.resolve.mockResolvedValueOnce(f.applied(entry));await f.recover(entry,'inspect');
 expect(f.committed).toHaveBeenCalledWith(entry.orderId,false);expect(f.view.result.current.draftOpen).toBe(true);expect(f.view.result.current.sourceText).toBe(text);expect(f.services.send).toHaveBeenCalledOnce();
});
it('재진입한 같은 내용의 미확인 요청은 숨김 표시와 무관하게 새 번호를 만들지 않고 무관한 새 주문은 허용한다',async()=>{
 const f=fixture();await f.ready();await f.save();act(()=>{f.view.result.current.closeDraft();f.view.result.current.openDraft(evidence.sourceText,'chat-first');});await f.save();expect(f.services.send).toHaveBeenCalledOnce();expect(f.view.result.current.selectedEntry).toBe(f.entries[0]);await f.save({...draft,partnerId:'b'},{...evidence,sourceText:'들기름 1박스'});expect(f.services.send).toHaveBeenCalledTimes(2);expect(f.entries[0].request!.sourceText).toBe(evidence.sourceText);
});
it('같은 내용 재시도는 저장된 요청을 그대로 쓰고 성공은 현재 주문만 닫는다',async()=>{
 const f=fixture();await f.ready();await f.save();const entry=f.entries[0];f.services.retry.mockResolvedValueOnce(f.applied(entry));await f.recover(entry,'retry');expect(f.services.retry).toHaveBeenCalledWith(expect.any(Object),entry,expect.any(Function));expect(f.services.send).toHaveBeenCalledOnce();expect(f.committed).toHaveBeenCalledWith(entry.orderId,true);expect(f.view.result.current.draftOpen).toBe(false);
});
it('이전 A의 성공 확인은 새로 작성 중인 B 입력과 identity를 지우지 않는다',async()=>{
 const f=fixture();await f.ready();await f.save();const entry=f.entries[0];await f.save({...draft,partnerId:'b'},{...evidence,sourceText:'B 내용'});const b=f.entries[1];f.services.resolve.mockResolvedValueOnce(f.applied(entry));await f.recover(entry,'inspect');expect(f.committed).toHaveBeenCalledWith(entry.orderId,false);expect(f.view.result.current.draftOpen).toBe(true);expect(f.view.result.current.sourceText).toBe('B 내용');await f.save({...draft,partnerId:'b'},{...evidence,sourceText:'B 내용'});expect(f.services.send.mock.calls.at(-1)![0]).toEqual(b.request);
});
it('거절 확정만 명시적 재작성 상태로 바꾸며 미확인은 확인 단계에 남긴다',async()=>{
 const f=fixture();await f.ready();await f.save();const entry=f.entries[0];await f.recover(entry,'inspect');expect(f.view.result.current.canRewrite(entry)).toBe(false);expect(f.committed).not.toHaveBeenCalled();f.services.resolve.mockResolvedValueOnce({terminal:true,outcome:{status:'rejected',message:'품목 확인'},result:{...f.applied(entry).result!,status:'rejected',message:'품목 확인'}});await f.recover(entry,'inspect');expect(f.view.result.current.canRewrite(entry)).toBe(true);expect(f.view.result.current.selectedEntry).toBe(entry);expect(f.committed).not.toHaveBeenCalled();
});
it('늦은 확인 응답이 다른 UID의 새 화면을 닫지 않으며 다른 탭 변경은 송신 전에 멈춘다',async()=>{
 const f=fixture();await f.ready();await f.save();const entry=f.entries[0];let finish!:(value:OrderCopyRecoveryObservation)=>void;f.services.resolve.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));let work!:Promise<void>;act(()=>{work=f.view.result.current.inspect(entry);});api.auth.currentUser.uid='other';await act(async()=>{finish(f.applied(entry));await work;});expect(f.committed).not.toHaveBeenCalled();api.auth.currentUser.uid='actor';f.services.retry.mockImplementationOnce(async()=>unknown());await f.recover({...entry,bodyText:'교체 전 관측 원문'},'retry');expect(f.services.send).toHaveBeenCalledOnce();
});
const adminSource=readFileSync('src/features/admin/AdminApp.tsx','utf8');
const adminTree=ts.createSourceFile('AdminApp.tsx',adminSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function adminExpression(name:string,deps:Record<string,unknown>){let code='';const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(adminTree)===name&&node.initializer)code=node.initializer.getText(adminTree);ts.forEachChild(node,visit);};visit(adminTree);if(!code)throw Error('실제 부모 표현식 누락: '+name);const js=ts.transpileModule('return ('+code+')',{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;return Function('React','ModalShell','ActionButton',...Object.keys(deps),js)(React,ModalShell,ActionButton,...Object.values(deps));}
function RecoveryUi({controller,scope='taebaek:actor'}:{controller:ReturnType<typeof useOrderCopyRecovery>;scope?:string}){
 const token=useRef({scope});if(token.current.scope!==scope)token.current={scope};
 const [owner,setOwner]=useState<typeof token.current|null>(null),[view,setView]=useState<'failure'|'history'>('history');
 const visible=adminExpression('copyRecoveryVisible',{copyRecoveryOwner:owner,copyScope:token});
 const deps={copyRecovery:controller,copyScope:token,copyRecoveryVisible:visible,copyRecoveryView:view,setCopyRecoveryOwner:setOwner,setCopyRecoveryView:setView};
 return <>{adminExpression('orderCopyRecoveryTools',deps)}{adminExpression('orderCopyRecoveryModal',deps)}</>;
}
it('상시 실패·규칙 버튼과 별도 실패목록은 없고 작성 안 관리자 규칙·조건부 안내를 전달한다',async()=>{
 const f=fixture();await f.ready();render(<RecoveryUi controller={f.view.result.current}/>);expect(screen.queryByRole('button',{name:/실패 \d/})).toBeNull();expect(screen.getByRole('button',{name:'처리 기록'})).toBeEnabled();expect(screen.queryByRole('dialog')).toBeNull();
 expect(adminSource).not.toContain('복사주문 실패 작업');expect(adminSource).not.toContain('const copyPrepared');expect(adminSource).toContain('onOpenRules={isAdmin?()=>setCopyRulesOpen(true):undefined}');expect(adminSource).toContain('saveRecovery={orderCopyRecoveryTools}');expect(adminSource).toContain('suspended={copyRulesOpen || copyRecoveryVisible}');
});
it('실패 N 진입은 미해결만 보이고 처리 기록 전환은 추가 조회와 저장 없이 같은 모달에서 열린다',async()=>{
 const f=fixture();await f.ready();await f.save();const entry=f.entries[0],controller={...f.view.result.current,historyRows:[{entry:{...entry,key:'done',description:'완료 기록'},currentState:'주문 저장 완료',cause:'처리를 확인했습니다.',nextAction:'새 업무를 진행하세요.'}]};
 render(<RecoveryUi controller={controller}/>);fireEvent.click(screen.getByRole('button',{name:'실패 1'}));const modal=await screen.findByRole('dialog',{name:'복사주문 처리 확인'});expect(modal).toHaveTextContent('거래처 · 최초 주문');expect(modal).not.toHaveTextContent('완료 기록');
 const reads=f.services.read.mock.calls.length;fireEvent.click(within(modal).getByRole('button',{name:'처리 기록 보기'}));expect(modal).toHaveTextContent('완료 기록');expect(f.services.read).toHaveBeenCalledTimes(reads);expect(f.services.list).not.toHaveBeenCalled();expect(f.services.send).toHaveBeenCalledOnce();
});
it('손상 원문도 표시 관측 행 그대로 조회·중단·명시 정리를 연결하며 현재 작성은 닫지 않는다',async()=>{
 const f=fixture();await f.ready();await f.save();const entry={...f.entries[0],request:null,status:'corrupt' as const,bodyText:'표시 원문 A',referenceText:'표시 참조 A'};
 const inspect=vi.fn(),stop=vi.fn(),discardCopy=vi.fn(),controller={...f.view.result.current,inspect,stop,discardCopy,failureCount:1,failureRows:[{entry,currentState:'처리 여부 확인 필요',cause:'원문 손상',nextAction:'결과를 확인해 주세요.'}]};
 render(<RecoveryUi controller={controller}/>);fireEvent.click(screen.getByRole('button',{name:'실패 1'}));const modal=await screen.findByRole('dialog');expect(within(modal).queryByRole('button',{name:'같은 주문 요청 재시도'})).toBeNull();
 fireEvent.click(within(modal).getByRole('button',{name:'결과 확인'}));expect(inspect).toHaveBeenCalledWith(entry);fireEvent.click(within(modal).getByRole('button',{name:'미처리 주문 요청 중단'}));expect(stop).toHaveBeenCalledWith(entry);fireEvent.click(within(modal).getByRole('button',{name:'이 기기 사본만 정리'}));expect(discardCopy).toHaveBeenCalledWith(entry);expect(f.view.result.current.draftOpen).toBe(true);expect(f.committed).not.toHaveBeenCalled();
});
it('처리 기록 열기·닫기·재열기는 원문을 유지하고 회사UID owner가 바뀌면 옛 모달이 숨겨진다',async()=>{
 const f=fixture();await f.ready();await f.save();const view=render(<RecoveryUi controller={f.view.result.current}/>);fireEvent.click(screen.getByRole('button',{name:'실패 1'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'닫기'}));expect(f.entries).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'처리 기록'}));expect(screen.getByRole('dialog')).toHaveTextContent('거래처 · 최초 주문');view.rerender(<RecoveryUi controller={f.view.result.current} scope="punghoe:other"/>);expect(screen.queryByRole('dialog')).toBeNull();expect(f.services.discard).not.toHaveBeenCalled();
});
it('이력 0건도 이전 오류와 최신 조회 안내를 함께 보이고 빈 페이지의 다음 커서를 숨기지 않는다',async()=>{
 const f=fixture();await f.ready();const nextHistory=vi.fn(),controller={...f.view.result.current,error:'이전 주문 결과는 아직 확인하지 못했습니다.',notice:'이번 조회 0건입니다. 목록에 없다는 이유로 미처리를 확정하지 않습니다.',historyMore:'opaque-cursor',nextHistory};
 render(<RecoveryUi controller={controller}/>);fireEvent.click(screen.getByRole('button',{name:'처리 기록'}));const modal=await screen.findByRole('dialog');expect(within(modal).getByRole('alert')).toHaveTextContent('이전 주문 결과');expect(within(modal).getByRole('status')).toHaveTextContent('이번 조회 0건');fireEvent.click(within(modal).getByRole('button',{name:'다음 주문 이력 확인'}));expect(nextHistory).toHaveBeenCalledOnce();expect(f.services.send).not.toHaveBeenCalled();
});
it('후크가 현재 작업 닫기를 거절하면 생성 선택기로 이동하거나 작성 상태를 정리하지 않는다',()=>{
 const setChooser=vi.fn(),setRules=vi.fn(),copyRecovery={busy:false,closeDraft:vi.fn(()=>false)};
 const close=adminExpression('closeOrderCreation',{copyRecovery,directOrderCreation:{current:{busy:false}},pasteOrderCreation:{current:{busy:false}},resetOrderCreationSession:vi.fn(),setIsAddOrderOpen:vi.fn(),setCopyRulesOpen:setRules,setIsOrderCreateChooserOpen:setChooser});
 close('paste',true);expect(copyRecovery.closeDraft).toHaveBeenCalledOnce();expect(setChooser).not.toHaveBeenCalled();expect(setRules).not.toHaveBeenCalled();
});
