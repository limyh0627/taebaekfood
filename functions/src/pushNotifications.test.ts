import {describe,expect,it,vi} from 'vitest';
vi.mock('firebase-admin',()=>({firestore:{FieldValue:{arrayRemove:(...tokens:string[])=>({remove:tokens})}}}));
import {handleNewOrderNotification,handleChatMessageNotification,sendPushNotifications,type PushDependencies} from './pushNotifications';
type Row=Record<string,any>;
function fixture(employees:Record<string,Row>={},rooms:Record<string,Row>={},codes:string[]=[],afterSend?:()=>void){
 const sent:Row[]=[],updates:Row[]=[],queries:unknown[]=[];
 const snapshot=(id:string,row:Row|undefined)=>({id,exists:!!row,data:()=>row,get:(key:string)=>row?.[key]});
 const db={collection:(name:string)=>{
  const rows=name==='employees'?employees:rooms;
  const query:any={where:(...args:unknown[])=>{queries.push(args);return query;},get:async()=>({docs:Object.entries(rows).map(([id,row])=>snapshot(id,row))}),doc:(id:string)=>({id,get:async()=>snapshot(id,rows[id])})};return query;
 },runTransaction:async(run:(tx:unknown)=>unknown)=>run({get:async(ref:{id:string})=>snapshot(ref.id,employees[ref.id]),update:(ref:{id:string},value:Row)=>updates.push({id:ref.id,value})})};
 const messaging={sendEachForMulticast:async(payload:Row)=>{sent.push(payload);afterSend?.();return {successCount:payload.tokens.length-codes.filter(Boolean).length,responses:payload.tokens.map((_:unknown,i:number)=>codes[i]?{success:false,error:{code:codes[i]}}:{success:true})};}};
 return {deps:{db,messaging} as unknown as PushDependencies,sent,updates,queries};
}
const event=(row:Row)=>({data:{data:()=>row},params:{orderId:'test-order',msgId:'test-message'}});
const data={title:'합성',body:'합성',tag:'test',view:'orders'};
describe('공용 서버 푸시 회사·토큰 경계',()=>{
 it.each(['messaging/invalid-argument','messaging/internal-error','messaging/permission-denied','registration-token-not-registered'])('%s는 토큰 삭제 근거가 아니다',async code=>{
  const f=fixture({same:{companyId:'taebaek',fcmTokens:['synthetic']}},{},[code]);await sendPushNotifications(f.deps,'taebaek',[{id:'same',tokens:['synthetic']}],data,'test');expect(f.updates).toHaveLength(0);
 });
 it('정확한 미등록 응답만 같은 직원의 원 토큰에서 제거한다',async()=>{
  const f=fixture({same:{companyId:'taebaek',fcmTokens:['synthetic','new-synthetic']}},{},['messaging/registration-token-not-registered']);
  await sendPushNotifications(f.deps,'taebaek',[{id:'same',tokens:['synthetic']}],data,'test');expect(f.updates).toEqual([{id:'same',value:{fcmTokens:{remove:['synthetic']}}}]);
 });
 it.each(['company','deleted','replaced'])('송신 후 %s가 변하면 과거 토큰 정리 쓰기를 하지 않는다',async mode=>{
  const employees:Record<string,Row>={same:{companyId:'taebaek',fcmTokens:['synthetic']}};
  const f=fixture(employees,{},['messaging/registration-token-not-registered'],()=>{if(mode==='deleted')delete employees.same;else employees.same=mode==='company'?{companyId:'punghoe',fcmTokens:['synthetic']}:{companyId:'taebaek',fcmTokens:['new-synthetic']};});
  await sendPushNotifications(f.deps,'taebaek',[{id:'same',tokens:['synthetic']}],data,'test');expect(f.updates).toHaveLength(0);
 });
 it('송신 자체가 거절되면 정리하지 않는다',async()=>{
  const f=fixture();f.deps.messaging.sendEachForMulticast=vi.fn().mockRejectedValue(new Error('합성 송신 오류'));
  await expect(sendPushNotifications(f.deps,'taebaek',[{id:'same',tokens:['synthetic']}],data,'test')).rejects.toThrow('합성');expect(f.updates).toHaveLength(0);
 });
 it('잘못된 토큰 값을 문자열로 바꾸어 보내지 않는다',async()=>{
  const f=fixture();await sendPushNotifications(f.deps,'taebaek',[{id:'same',tokens:[null,123,'',' ',{},'synthetic'] as unknown as string[]}],data,'test');expect(f.sent[0].tokens).toEqual(['synthetic']);
 });
 it('주문은 회사 query와 문서 재검으로 다른 회사·작성자를 제외한다',async()=>{
  const f=fixture({same:{companyId:'taebaek',fcmTokens:['same-synthetic']},other:{companyId:'punghoe',fcmTokens:['other-synthetic']},author:{companyId:'taebaek',fcmTokens:['author-synthetic']}});
  await handleNewOrderNotification(f.deps,event({companyId:'taebaek',createdBy:'author',partnerName:'합성'}));expect(f.queries).toEqual([['companyId','==','taebaek']]);expect(f.sent[0].tokens).toEqual(['same-synthetic']);expect(f.sent[0].data.tag).toBe('new-order:test-order');
 });
 it.each([undefined,'invalid'])('회사 %s 주문을 태백으로 추정하지 않는다',async companyId=>{
  const f=fixture({same:{companyId:'taebaek',fcmTokens:['synthetic']}});await handleNewOrderNotification(f.deps,event({companyId}));expect(f.sent).toHaveLength(0);expect(f.queries).toHaveLength(0);
 });
 it.each(['room-company','employee-company','sender-absent','deleted','bad-room','missing-company'])('채팅 %s는 보내지 않는다',async mode=>{
  const f=fixture({same:{companyId:mode==='employee-company'?'punghoe':'taebaek',fcmTokens:['synthetic']}},{room:{companyId:mode==='room-company'?'punghoe':'taebaek',participantIds:mode==='sender-absent'?['same']:['sender','same']}});
  await handleChatMessageNotification(f.deps,event({companyId:mode==='missing-company'?undefined:'taebaek',roomId:mode==='bad-room'?'bad/path':'room',senderId:'sender',deletedAt:mode==='deleted'?'time':undefined}));expect(f.sent).toHaveLength(0);
 });
 it.each(['text','image','file','empty'])('정상 채팅 %s의 개인 방명·요약을 보존한다',async kind=>{
  const f=fixture({same:{companyId:'taebaek',fcmTokens:['synthetic']}},{room:{companyId:'taebaek',participantIds:['sender','same'],name:'일반',nameBy:{same:'개인방'}}});
  await handleChatMessageNotification(f.deps,event({companyId:'taebaek',roomId:'room',senderId:'sender',...(kind==='text'?{text:'가'.repeat(90)}:kind==='image'?{imageUrl:'synthetic'}:kind==='file'?{fileUrl:'synthetic'}:{})}));
  expect(f.sent).toHaveLength(1);expect(f.sent[0].data).toMatchObject({title:'💬 개인방',tag:'room',view:'officetalk',body:kind==='text'?'가'.repeat(80)+'…':kind==='image'?'사진을 보냈습니다':kind==='file'?'파일을 보냈습니다':'새 메시지가 도착했습니다.'});
 });
});
