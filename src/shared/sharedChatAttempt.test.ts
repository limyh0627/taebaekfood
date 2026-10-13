/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { beginSharedChatAttempt, beginSharedTextChatAttempt, readSharedChatAttempt, readSharedChatAttempts, readRetainedSharedChatAttempts, completeSharedChatAttempt, clearSharedChatAttempt, assertSharedChatDraft, sharedChatAttemptText, discardSharedChatAttemptText } from './sharedChatAttempt';
const id='123e4567-e89b-42d3-a456-426614174000';
const draft=()=>({id,file:new File(['pdf'],'quote.pdf',{type:'application/pdf'}),text:'견적'});
beforeEach(()=>{localStorage.clear();vi.stubGlobal('crypto',webcrypto);});
it('회사·Firebase UID·공유 번호별 원문과 최초 방을 보존한다',async()=>{
 const a=await beginSharedChatAttempt('taebaek','uid',draft(),'room1','employee','나');
 expect(await beginSharedChatAttempt('taebaek','uid',draft(),'room2','employee','다른 이름')).toEqual(a);
 expect(readSharedChatAttempt('punghoe','uid',id)).toBeNull();expect(readSharedChatAttempt('taebaek','another',id)).toBeNull();
});
it('이름과 길이가 같은 다른 파일도 내용 해시로 거절한다',async()=>{
 const a=await beginSharedChatAttempt('taebaek','uid',draft(),'room','employee','나');
 await expect(assertSharedChatDraft(a,{...draft(),file:new File(['bad'],'quote.pdf',{type:'application/pdf'})})).rejects.toThrow('최초 전송 원문');
 expect(readSharedChatAttempt('taebaek','uid',id)).toEqual(a);
});
it('완성 메시지 저장과 삭제는 보존된 원문이 동일할 때만 한다',async()=>{
 const a=await beginSharedChatAttempt('taebaek','uid',draft(),'room','employee','나');
 const message={id:'MSG-share-'+id,companyId:'taebaek' as const,roomId:a.roomId,senderId:a.senderId,senderName:a.senderName,text:a.text,createdAt:a.createdAt,fileUrl:'https://example.test/f',fileName:a.file.name,fileSize:a.file.size};
 const complete=completeSharedChatAttempt(a,message);
 expect(()=>clearSharedChatAttempt(a)).toThrow('다른 공유 전송 원문');
 expect(()=>completeSharedChatAttempt(a,{...message,text:'변경'})).toThrow();
 clearSharedChatAttempt(complete);expect(readSharedChatAttempt('taebaek','uid',id)).toBeNull();
});
it('손상된 저장 원문을 임의로 지우거나 새 전송으로 교체하지 않는다',async()=>{
 await beginSharedChatAttempt('taebaek','uid',draft(),'room','employee','나');
 const key=Object.keys(localStorage)[0];localStorage.setItem(key,'broken');
 expect(()=>readSharedChatAttempt('taebaek','uid',id)).toThrow('손상');
 await expect(beginSharedChatAttempt('taebaek','uid',draft(),'new','employee','나')).rejects.toThrow('손상');
 expect(localStorage.getItem(key)).toBe('broken');
});

it('명시 삭제는 손상 원문도 내부 보존하되 대기 중 바뀐 원문은 유지한다',async()=>{
 await beginSharedChatAttempt('taebaek','uid',draft(),'room','employee','나');
 const key=Object.keys(localStorage)[0];localStorage.setItem(key,'broken');
 const expected=sharedChatAttemptText('taebaek','uid',id);localStorage.setItem(key,'changed');
 expect(()=>discardSharedChatAttemptText('taebaek','uid',id,expected)).toThrow('변경');expect(localStorage.getItem(key)).toBe('changed');
 discardSharedChatAttemptText('taebaek','uid',id,'changed');expect(localStorage.getItem(key)).toBe('changed');
 expect(localStorage.getItem(key+':deleted')).toBe('changed');
 expect(readSharedChatAttempts('taebaek','uid')).toEqual([]);
});
it('텍스트 최초 UUID·방·본문·시각을 저장하고 다른 로그인에는 노출하지 않는다',()=>{
 const a=beginSharedTextChatAttempt('taebaek','uid',{id,text:'  원문\n두 줄 '},'room1','employee','나');
 expect(a.version).toBe(2);expect(a.kind).toBe('text');expect(a.message.id).toBe('MSG-share-'+id);
 expect(beginSharedTextChatAttempt('taebaek','uid',{id,text:a.text},'room2','employee','다른 이름')).toEqual(a);
 expect(readSharedChatAttempts('taebaek','other')).toEqual([]);
 expect(()=>beginSharedTextChatAttempt('taebaek','uid',{id,text:'바뀜'},'room2','employee','나')).toThrow('최초');
});
it('텍스트 삭제는 목록에서 제외하고 unknown 원문은 유지하며 정확 ACK만 정리한다',()=>{
 const a=beginSharedTextChatAttempt('taebaek','uid',{id,text:'원문'},'room','employee','나');
 const original=sharedChatAttemptText('taebaek','uid',id);
 discardSharedChatAttemptText('taebaek','uid',id,original);
 expect(readSharedChatAttempts('taebaek','uid')).toEqual([]);
 expect(readRetainedSharedChatAttempts('taebaek','uid')).toEqual([a]);
 expect(sharedChatAttemptText('taebaek','uid',id)).toBe(original);
 expect(()=>clearSharedChatAttempt({...a,text:'새 원문'})).toThrow();
 clearSharedChatAttempt(a);expect(readRetainedSharedChatAttempts('taebaek','uid')).toEqual([]);expect(localStorage.length).toBe(0);
});
it('옛 version1 파일 원문은 재시도 때 재작성하거나 종류를 바꾸지 않는다',async()=>{
 const a=await beginSharedChatAttempt('taebaek','uid',draft(),'room','employee','나');
 const {kind,...old}=a;const legacy={...old,version:1};
 const storageKey=Object.keys(localStorage)[0];localStorage.setItem(storageKey,JSON.stringify(legacy));
 expect(await beginSharedChatAttempt('taebaek','uid',draft(),'newroom','employee','나')).toEqual(legacy);
 expect(localStorage.getItem(storageKey)).toBe(JSON.stringify(legacy));
});
