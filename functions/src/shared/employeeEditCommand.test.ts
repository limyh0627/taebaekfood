import {it,expect} from 'vitest';
import {normalizeEmployeeEditRequest,normalizeEmployeeEditReference,serializeEmployeeEditRequest,normalizeEmployeeEditResult,employeeEditExpected,type EmployeeProfileDraft} from './employeeEditCommand';
import {documentId} from './documentId';
import {itemEditorDocumentId} from './itemEditorCommand';
const reference={companyId:'taebaek' as const,planId:'plan',targetId:'employee'};
const profile:EmployeeProfileDraft={name:'직원',position:'담당',department:'생산',joinDate:'옛 날짜',birthDate:'',phone:'',status:'재직',healthCertDate:'',annualLeave:{carryOverLeave:-1,bonusLeave:0.5}};
const create={version:1,...reference,kind:'create',expected:null,profile};
it('중립 문서 ID 정본은 기존 품목 재수출과 같은 함수이며 UTF8 1500바이트 경계를 보존한다',()=>{
 expect(itemEditorDocumentId).toBe(documentId);expect(documentId('가'.repeat(500))).toBe(true);expect(documentId('가'.repeat(501))).toBe(false);expect(documentId('a'.repeat(1500))).toBe(true);expect(documentId('a'.repeat(1501))).toBe(false);for(const value of ['','a/b','.','..','__reserved__'])expect(documentId(value)).toBe(false);
});
it('프로필은 8문자와 두 연차만 허용하고 날짜·양수 새 정책을 만들지 않는다',()=>{
 expect(normalizeEmployeeEditRequest(create)).toMatchObject({profile});
 for(const field of ['isAdmin','authUid','fcmTokens','salary','password'])expect(()=>normalizeEmployeeEditRequest({...create,profile:{...profile,[field]:'위조'}})).toThrow();
 expect(()=>normalizeEmployeeEditRequest({...create,balance:{carryOverLeave:0,bonusLeave:0}})).toThrow();
 expect(()=>normalizeEmployeeEditRequest({...create,profile:{...profile,annualLeave:{...profile.annualLeave,usedLeave:10}}})).toThrow();
 expect(()=>normalizeEmployeeEditRequest({...create,profile:{...profile,phone:123}})).toThrow();
 expect(()=>normalizeEmployeeEditRequest({...create,profile:{...profile,annualLeave:{carryOverLeave:Infinity,bonusLeave:0}}})).toThrow();
});
it('연차 원문은 두 scalar 존재성을 비교하고 나머지 연차·FCM·급여 변화는 섞지 않는다',()=>{
 const row={name:'원문',annualLeave:{bonusLeave:0,carryOverLeave:2,usedLeave:7},fcmTokens:['old'],salary:10};
 expect(employeeEditExpected(row,'balance')).toEqual(employeeEditExpected({...row,name:'다른 이름',annualLeave:{...row.annualLeave,usedLeave:8},fcmTokens:['new'],salary:20},'balance'));
 expect(employeeEditExpected(row,'profile')).not.toEqual(employeeEditExpected({...row,name:'다른 이름'},'profile'));
 expect(employeeEditExpected({},'balance')).not.toEqual(employeeEditExpected({annualLeave:{}},'balance'));
 expect(employeeEditExpected({annualLeave:null},'balance')).not.toEqual(employeeEditExpected({annualLeave:{bonusLeave:0}},'balance'));
 expect(()=>normalizeEmployeeEditRequest({version:1,...reference,kind:'balance',expected:employeeEditExpected(row,'balance'),balance:{carryOverLeave:2,bonusLeave:3},profile})).toThrow();
});
it('정규화 직렬화는 입력 key 순서와 무관하고 전체 초안 크기를 제한한다',()=>{
 expect(serializeEmployeeEditRequest(create)).toBe(serializeEmployeeEditRequest({...create,profile:{annualLeave:{bonusLeave:0.5,carryOverLeave:-1},healthCertDate:'',status:'재직',phone:'',birthDate:'',joinDate:'옛 날짜',department:'생산',position:'담당',name:'직원'}}));
 expect(()=>normalizeEmployeeEditRequest({...create,profile:{...profile,name:'가'.repeat(100000)}})).toThrow('너무 큽니다');
 expect(normalizeEmployeeEditReference({...reference,targetId:'가'.repeat(400)}).targetId).toHaveLength(400);
});
it('결과는 회사·UID·대상·원문을 정확히 대조하고 null hash는 unknown·opaque cancel만 허용한다',()=>{
 const response={...reference,actorUid:'actor',requestHash:'a'.repeat(64),status:'applied',message:'완료'};
 expect(normalizeEmployeeEditResult(response,reference,'actor','a'.repeat(64)).status).toBe('applied');
 for(const patch of [{actorUid:'other'},{companyId:'punghoe'},{targetId:'other'},{planId:'other'},{requestHash:null},{status:'unknown'}])expect(()=>normalizeEmployeeEditResult({...response,...patch},reference,'actor')).toThrow();
 expect(()=>normalizeEmployeeEditResult(response,reference,'actor','b'.repeat(64))).toThrow();
 expect(normalizeEmployeeEditResult({...response,status:'cancelled',requestHash:null},reference,'actor').status).toBe('cancelled');
});
