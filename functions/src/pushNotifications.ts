import * as admin from 'firebase-admin';

type Row=Record<string,any>;
type Company='taebaek'|'punghoe';
type Recipient={id:string;tokens:string[]};
type PushData={title:string;body:string;tag:string;view:string};
export type PushDependencies={db:admin.firestore.Firestore;messaging:Pick<admin.messaging.Messaging,'sendEachForMulticast'>;log?:(message:string)=>void};
type CreatedEvent={data?:{data():Row|undefined};params:Record<string,string>};
const company=(value:unknown):value is Company=>value==='taebaek'||value==='punghoe';
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value);
const tokens=(value:unknown):string[]=>Array.isArray(value)?value.filter((token):token is string=>typeof token==='string'&&!!token.trim()):[];

/** 메시지 형식 오류는 기기 폐기의 증거가 아니다. 확정 미등록 응답만 현재 소유 회사와 다시 대조한다. */
export async function sendPushNotifications(deps:PushDependencies,companyId:Company,recipients:Recipient[],data:PushData,label:string){
 const targets=recipients.flatMap(person=>tokens(person.tokens).map(token=>({token,employeeId:person.id})));
 if(!targets.length)return;
 const response=await deps.messaging.sendEachForMulticast({tokens:targets.map(target=>target.token),data,
  android:{priority:'high'},webpush:{headers:{Urgency:'high'}}});
 const stale=new Map<string,string[]>();
 response.responses.forEach((result,index)=>{
  if(result.success||result.error?.code!=='messaging/registration-token-not-registered'||!targets[index])return;
  const target=targets[index];stale.set(target.employeeId,[...(stale.get(target.employeeId)??[]),target.token]);
 });
 await Promise.all([...stale].map(([employeeId,oldTokens])=>deps.db.runTransaction(async tx=>{
  const ref=deps.db.collection('employees').doc(employeeId),current=await tx.get(ref);
  if(!current.exists||current.get('companyId')!==companyId)return;
  const remaining=tokens(current.get('fcmTokens')),remove=oldTokens.filter(token=>remaining.includes(token));
  if(remove.length)tx.update(ref,{fcmTokens:admin.firestore.FieldValue.arrayRemove(...remove)});
 })));
 deps.log?.(`[${label}] 발송 ${response.successCount}/${targets.length}`);
}

export async function handleNewOrderNotification(deps:PushDependencies,event:CreatedEvent){
 const order=event.data?.data();
 if(!order||order.partnerName==='생산기록'||!company(order.companyId))return;
 const employees=await deps.db.collection('employees').where('companyId','==',order.companyId).get();
 const recipients=employees.docs.filter(doc=>doc.id!==String(order.createdBy??'')&&doc.data().companyId===order.companyId)
  .map(doc=>({id:doc.id,tokens:tokens(doc.data().fcmTokens)})).filter(person=>person.tokens.length);
 await sendPushNotifications(deps,order.companyId,recipients,{title:'🧾 신규 주문',body:`${order.partnerName??'거래처'} 주문이 들어왔습니다.`,
  tag:`new-order:${event.params.orderId}`,view:'orders'},'notifyNewOrder');
}

export async function handleChatMessageNotification(deps:PushDependencies,event:CreatedEvent){
 const message=event.data?.data();
 if(!message||message.deletedAt||!company(message.companyId)||!identifier(message.roomId)||!identifier(message.senderId))return;
 const roomSnapshot=await deps.db.collection('chatRooms').doc(message.roomId).get();
 if(!roomSnapshot.exists)return;
 const room=roomSnapshot.data()??{};
 if(room.companyId!==message.companyId||!Array.isArray(room.participantIds)
  ||!room.participantIds.every(identifier)||!room.participantIds.includes(message.senderId))return;
 const participants:string[]=room.participantIds.filter((id:string)=>id!==message.senderId);
 const employees=await Promise.all(participants.map(id=>deps.db.collection('employees').doc(id).get()));
 const text=message.text?String(message.text):message.imageUrl?'사진을 보냈습니다':message.fileUrl?'파일을 보냈습니다':'새 메시지가 도착했습니다.';
 for(const employee of employees){
  if(!employee.exists||employee.get('companyId')!==message.companyId)continue;
  const ownTokens=tokens(employee.get('fcmTokens'));if(!ownTokens.length)continue;
  const name=room.nameBy?.[employee.id]?.trim()||room.name?.trim()||message.senderName||'오피스톡';
  await sendPushNotifications(deps,message.companyId,[{id:employee.id,tokens:ownTokens}],{
   title:`💬 ${name}`,body:text.length>80?`${text.slice(0,80)}…`:text,tag:message.roomId,view:'officetalk'},'notifyChatMessage');
 }
}
