/** @vitest-environment jsdom */
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {expect,it,vi} from 'vitest';
import {companyOf,type CompanyId} from '../../shared/types';
const sdk=vi.hoisted(()=>({tx:vi.fn(),doc:vi.fn(),auth:{currentUser:{uid:'actor',getIdTokenResult:async()=>({claims:{companyId:'taebaek',employeeId:'employee'}})}}}));
vi.mock('../../shared/firebase',()=>({auth:sdk.auth,authReady:Promise.resolve(),db:{}}));
vi.mock('firebase/firestore',()=>({doc:sdk.doc,runTransaction:sdk.tx}));
import {sendSharedChatMessage} from '../../shared/services/sharedChatMessageService';

// Admin 전체를 모킹해 새 구현을 만드는 대신 실제 JSX 콜백 본문을 실행한다.
function callback(){
 const ast=ts.createSourceFile('AdminApp.tsx',readFileSync(process.env.QUALITY_CHAT_CANDIDATE_SOURCE || 'src/features/admin/AdminApp.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const matches:string[]=[];
 const visit=(node:ts.Node)=>{if(ts.isJsxAttribute(node)&&node.name.getText(ast)==='onSendMessage'&&node.initializer&&ts.isJsxExpression(node.initializer)&&node.initializer.expression)matches.push(node.initializer.expression.getText(ast));ts.forEachChild(node,visit);};visit(ast);
 if(matches.length!==1)throw Error('실제 공유 전송 콜백을 하나로 확인하지 못했습니다.');
 return ts.transpileModule('const callback='+matches[0],{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
}
const source=callback();
const message=()=>({id:'MSG-share-123e4567-e89b-42d3-a456-426614174000',companyId:'taebaek' as CompanyId,roomId:'room',senderId:'employee',senderName:'직원',text:'  첫 공유 원문\n@관리자  ',createdAt:'2026-10-14T00:00:00Z',imageUrl:'https://example.invalid/first.jpg',fileUrl:'https://example.invalid/first.pdf',fileName:'first.pdf',fileSize:42});
const shareId='123e4567-e89b-42d3-a456-426614174000';
function fixture(){
 const deps={companyId:'taebaek',auth:{currentUser:{uid:'actor'} as {uid:string}|null},companyOf,
  sendSharedChatMessage:vi.fn(async(_message:unknown,_shareId:string,_uid:string)=>'created'),
  addItem:vi.fn(async(_collection:string,_data:unknown,_options?:unknown)=>{}),updateItem:vi.fn(async(_collection:string,_id:string,_data:unknown)=>{}),
  chatRooms:[{id:'room',name:'방',participantIds:['employee','recipient'],lastReadBy:{}}],employees:[{id:'recipient',name:'수신 직원'}]};
 return{deps,run:new Function(...Object.keys(deps),source+';return callback;')(...Object.values(deps)) as (msg:ReturnType<typeof message>,uuid?:string,uid?:string,beforeSend?:()=>void)=>Promise<unknown>};
}
it('공유 created는 고정한 첫 본문·회사·UID·UUID의 정확 ACK를 반환한다',async()=>{
 const f=fixture(),first=message(),original=JSON.stringify(first);const result=await f.run(first,shareId,'actor');
 expect(f.deps.sendSharedChatMessage).toHaveBeenCalledWith(JSON.parse(original),shareId,'actor');
 expect(result).toEqual({companyId:'taebaek',actorUid:'actor',shareId,messageText:original});
 expect(f.deps.addItem.mock.calls.some(([name])=>name==='chatMessages')).toBe(false);
});
it('호출 뒤 입력 객체·중첩 자료를 바꿔도 서비스와 ACK의 첫 원문은 바뀌지 않는다',async()=>{
 const f=fixture(),first=message(),original=JSON.stringify(first);let finish!:(value:string)=>void;
 f.deps.sendSharedChatMessage.mockReturnValueOnce(new Promise(resolve=>finish=resolve));const work=f.run(first,shareId,'actor');
 first.text='후행 변경';first.imageUrl='https://example.invalid/changed.jpg';first.fileName='changed.pdf';first.roomId='other-room';finish('created');const result=await work;
 expect(f.deps.sendSharedChatMessage.mock.calls[0][0]).toEqual(JSON.parse(original));
 expect(f.deps.sendSharedChatMessage.mock.calls[0][0]).not.toBe(first);
 expect(result).toEqual({companyId:'taebaek',actorUid:'actor',shareId,messageText:original});
});
it('duplicate ACK는 원문만 확인하고 방 요약·알림·관리자 언급을 다시 쓰지 않는다',async()=>{
 const f=fixture(),first=message();f.deps.sendSharedChatMessage.mockResolvedValue('duplicate');
 expect(await f.run(first,shareId,'actor')).toEqual({companyId:'taebaek',actorUid:'actor',shareId,messageText:JSON.stringify(first)});
 await Promise.resolve();expect(f.deps.updateItem).not.toHaveBeenCalled();expect(f.deps.addItem).not.toHaveBeenCalled();
});
it.each(['uid','company'] as const)('전송 전 %s 불일치는 서비스와 부가 쓰기 모두 시작하지 않는다',async kind=>{
 const f=fixture(),first=message();if(kind==='uid')f.deps.auth.currentUser={uid:'other'};else first.companyId='punghoe';
 await expect(f.run(first,shareId,'actor')).rejects.toThrow('범위');expect(f.deps.sendSharedChatMessage).not.toHaveBeenCalled();expect(f.deps.updateItem).not.toHaveBeenCalled();expect(f.deps.addItem).not.toHaveBeenCalled();
});
it.each(['other-uid','logout'] as const)('응답 대기 중 %s 전환은 이미 전송한 원문에 ACK와 부가 쓰기를 주지 않는다',async kind=>{
 const f=fixture(),first=message();let finish!:(value:string)=>void;f.deps.sendSharedChatMessage.mockReturnValueOnce(new Promise(resolve=>finish=resolve));
 const work=f.run(first,shareId,'actor');f.deps.auth.currentUser=kind==='logout'?null:{uid:'other'};finish('created');
 await expect(work).rejects.toThrow('범위');expect(f.deps.sendSharedChatMessage).toHaveBeenCalledOnce();expect(f.deps.updateItem).not.toHaveBeenCalled();expect(f.deps.addItem).not.toHaveBeenCalled();
});
it('미확인 완료 상태는 성공 ACK와 부가 쓰기로 승격하지 않는다',async()=>{
 const f=fixture();f.deps.sendSharedChatMessage.mockResolvedValue('unknown');await expect(f.run(message(),shareId,'actor')).rejects.toThrow('완료 응답');expect(f.deps.updateItem).not.toHaveBeenCalled();expect(f.deps.addItem).not.toHaveBeenCalled();
});
it('공유 UUID 없는 일반 대화는 기존 chatMessages 경로를 사용하고 공유 ACK를 반환하지 않는다',async()=>{
 const f=fixture(),first=message();expect(await f.run(first)).toBeUndefined();expect(f.deps.sendSharedChatMessage).not.toHaveBeenCalled();expect(f.deps.addItem).toHaveBeenCalledWith('chatMessages',first,undefined);
});
it('일반 전송 guard는 본문 밖 options에 원 callback으로 전달되며 부모가 먼저 실행하지 않는다',async()=>{const f=fixture(),first=message(),guard=vi.fn();expect(await f.run(first,undefined,undefined,guard)).toBeUndefined();expect(f.deps.addItem).toHaveBeenCalledWith('chatMessages',first,{chatBeforeSend:guard});expect(guard).not.toHaveBeenCalled();expect(first).not.toHaveProperty('chatBeforeSend');});
it('공유 UUID와 일반 guard 혼합은 모든 쓰기 전에 거절한다',async()=>{const f=fixture(),guard=vi.fn();await expect(f.run(message(),shareId,'actor',guard)).rejects.toThrow('경계');expect(guard).not.toHaveBeenCalled();expect(f.deps.addItem).not.toHaveBeenCalled();expect(f.deps.updateItem).not.toHaveBeenCalled();expect(f.deps.sendSharedChatMessage).not.toHaveBeenCalled();});
it.each([{privateToken:'비공개'},{images:['nested']},{extra:{nested:true}}])('실 공유 서비스는 허용하지 않은 필드를 거래 전에 거절한다 %j',async extra=>{sdk.tx.mockClear();sdk.doc.mockClear();const original={...message(),...extra};await expect(sendSharedChatMessage(original,shareId,'actor')).rejects.toThrow('원문');expect(sdk.tx).not.toHaveBeenCalled();expect(sdk.doc).not.toHaveBeenCalled();expect(original).toMatchObject(extra);});
it('실 공유 서비스는 허용된 첨부 원문만 모델 transaction에 전달한다',async()=>{const first=message(),write=vi.fn();sdk.doc.mockImplementation((_db,collection,id)=>({collection,id}));sdk.tx.mockImplementation(async(_db,callback)=>callback({get:async(ref:{collection:string})=>ref.collection==='chatRooms'?{exists:()=>true,data:()=>({companyId:'taebaek',participantIds:['employee']})}:{exists:()=>false},set:write}));expect(await sendSharedChatMessage(first,shareId,'actor')).toBe('created');expect(write).toHaveBeenCalledExactlyOnceWith({collection:'chatMessages',id:first.id},first);});
