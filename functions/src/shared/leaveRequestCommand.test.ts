import {expect,it} from 'vitest';
import {normalizeLeaveBatchRequest,serializeLeaveBatchRequest,normalizeLeaveBatchResult,leaveRequestExpected,leaveRequestBusinessIds,type LeaveCreateRequest} from './leaveRequestCommand';
const row={id:'lv-1',employeeId:'e1',employeeName:'직원',type:'휴가' as const,startDate:'2026-10-19',endDate:'2026-10-20',reason:'단체휴가',status:'approved' as const,requestedAt:'2026-10-18T22:05:01.123Z',daysUsed:2,deductsLeave:false};
const request=():LeaveCreateRequest=>({version:1,companyId:'taebaek',planId:'plan-1',rows:[{...row}]});
it('개인 날짜와 단체 실제 ISO 작성시각을 원문 그대로 보존하고 key순서만 고정한다',()=>{const r=request(),before=structuredClone(r);expect(normalizeLeaveBatchRequest(r).rows[0].requestedAt).toBe(row.requestedAt);const pending={...row,status:'pending',type:'연차',requestedAt:'2026-10-18',daysUsed:0} as Record<string,unknown>;delete pending.deductsLeave;expect(normalizeLeaveBatchRequest({...r,rows:[pending]}).rows[0].requestedAt).toBe('2026-10-18');expect(serializeLeaveBatchRequest({rows:r.rows,planId:r.planId,companyId:r.companyId,version:1})).toBe(serializeLeaveBatchRequest(r));expect(r).toEqual(before);});
it.each([{startDate:'2026-02-30'},{endDate:'2025-02-29'},{requestedAt:'2026-02-30T00:00:00.000Z'},{daysUsed:NaN},{daysUsed:Infinity},{daysUsed:0},{deductsLeave:'false'},{status:'rejected'},{type:'임의유형'},{approvedBy:'위조'},{id:'bad/id'}])('손상된 휴가 행은 거절한다 %j',patch=>{const r=request();expect(()=>normalizeLeaveBatchRequest({...r,rows:[{...row,...patch}]})).toThrow();});
it('같은 직원·요청번호 중복과 401명 및 UTF8 256KiB초과는 거절한다',()=>{const r=request();expect(()=>normalizeLeaveBatchRequest({...r,rows:[row,{...row,id:'lv2'}]})).toThrow();expect(()=>normalizeLeaveBatchRequest({...r,rows:[row,{...row,employeeId:'e2'}]})).toThrow();expect(()=>normalizeLeaveBatchRequest({...r,rows:Array.from({length:401},(_,i)=>({...row,id:'lv'+i,employeeId:'e'+i}))})).toThrow();expect(()=>normalizeLeaveBatchRequest({...r,rows:[{...row,reason:'한'.repeat(90000)}]})).toThrow();expect(normalizeLeaveBatchRequest({...r,rows:[{...row,startDate:'2024-02-29',endDate:'2024-02-29'}]}).rows).toHaveLength(1);});
it('pending은 한 직원·결재필드 및 차감override없이만 허용하고 approved와 섞지 않는다',()=>{const p={...row,status:'pending',type:'연차',daysUsed:0} as Record<string,unknown>;delete p.deductsLeave;expect(normalizeLeaveBatchRequest({...request(),rows:[p]}).rows).toHaveLength(1);expect(()=>normalizeLeaveBatchRequest({...request(),rows:[{...p,deductsLeave:false}]})).toThrow();expect(()=>normalizeLeaveBatchRequest({...request(),rows:[p,{...p,id:'lv2',employeeId:'e2'}]})).toThrow();expect(()=>normalizeLeaveBatchRequest({...request(),rows:[p,{...row,id:'lv2',employeeId:'e2'}]})).toThrow();});
it('응답은 회사·계정·계획·해시와 terminal형태를 모두 대조한다',()=>{const ref={companyId:'taebaek' as const,planId:'plan-1'},good={...ref,actorUid:'u',status:'applied',requestHash:'a'.repeat(64),requestIds:['lv-1'],message:'완료'};expect(normalizeLeaveBatchResult(good,ref,'u','a'.repeat(64)).status).toBe('applied');for(const patch of [{companyId:'punghoe'},{actorUid:'other'},{planId:'other'},{requestHash:'b'.repeat(64)},{requestHash:null},{requestIds:[]},{requestIds:['lv-1','lv-1']}])expect(()=>normalizeLeaveBatchResult({...good,...patch},ref,'u','a'.repeat(64))).toThrow();expect(normalizeLeaveBatchResult({...good,status:'cancelled',requestHash:null,requestIds:[]},ref,'u').status).toBe('cancelled');expect(normalizeLeaveBatchResult({...good,status:'unknown',requestHash:null,requestIds:[]},ref,'u').status).toBe('unknown');});

it('확정 응답은 알고 있는 최초 업무 ID의 개수·순서까지 같아야 한다',()=>{const ref={companyId:'taebaek' as const,planId:'p'},good={...ref,actorUid:'u',status:'applied',requestHash:'a'.repeat(64),requestIds:['one','two'],message:'완료'};expect(normalizeLeaveBatchResult(good,ref,'u','a'.repeat(64),['one','two']).status).toBe('applied');for(const ids of [['one'],['two','one'],['one','other']])expect(()=>normalizeLeaveBatchResult({...good,requestIds:ids},ref,'u','a'.repeat(64),['one','two'])).toThrow();});

it('rejected는최초원문hash가필수라null응답으로보관원문삭제를유도하지못한다',()=>{const ref={companyId:'taebaek' as const,planId:'p'};expect(()=>normalizeLeaveBatchResult({...ref,actorUid:'u',status:'rejected',requestHash:null,requestIds:[],message:'거절'},ref,'u')).toThrow();});

it('create v1 직렬화 바이트를 고정하고 mutation은 별도 명시 버전으로만 구별한다',()=>{
 expect(serializeLeaveBatchRequest(request())).toBe('{"version":1,"companyId":"taebaek","planId":"plan-1","rows":[{"id":"lv-1","employeeId":"e1","employeeName":"직원","type":"휴가","startDate":"2026-10-19","endDate":"2026-10-20","reason":"단체휴가","requestedAt":"2026-10-18T22:05:01.123Z","daysUsed":2,"status":"approved","deductsLeave":false}]}');
 const expected=leaveRequestExpected({...row,companyId:'taebaek',deductsLeave:null,reason:null,extra:'제외'});
 const mutation=normalizeLeaveBatchRequest({version:2,kind:'mutation',companyId:'taebaek',planId:'m1',targetId:'lv-1',expected,action:'cancel',reason:' 취소 '});
 expect(leaveRequestBusinessIds(mutation)).toEqual(['lv-1']);
 expect(JSON.parse(serializeLeaveBatchRequest(mutation)).expected).toMatchObject({deductsLeave:null,reason:null});
 expect(expected).not.toHaveProperty('id');expect(expected).not.toHaveProperty('extra');
 expect(leaveRequestExpected({status:'approved',deductsLeave:false,daysUsed:0})).toEqual({status:'approved',daysUsed:0,deductsLeave:false});
 expect(leaveRequestExpected({status:'approved'})).not.toHaveProperty('deductsLeave');
});
it('기존 비교값은 legacy 원문으로 보존하지만 새 변경 입력과 JSON손상은 거절한다',()=>{
 const base={version:2,kind:'mutation',companyId:'taebaek',planId:'m2',targetId:'lv-1',expected:{status:'approved',startDate:'옛날짜',modifyRequest:null},action:'request-modify',modifyRequest:{startDate:'2026-10-19',endDate:'2026-10-19',reason:'변경',daysUsed:0}};
 expect(normalizeLeaveBatchRequest(base)).toMatchObject({expected:base.expected});
 for(const patch of [{startDate:'2026-02-30'},{endDate:'2026-10-18'},{daysUsed:NaN},{daysUsed:-1},{reason:' '}])expect(()=>normalizeLeaveBatchRequest({...base,modifyRequest:{...base.modifyRequest,...patch}})).toThrow();
 expect(()=>normalizeLeaveBatchRequest({...base,expected:{status:'approved',id:'위조'}})).toThrow();
 expect(()=>leaveRequestExpected({reason:undefined})).toThrow();
 expect(()=>leaveRequestExpected({daysUsed:Infinity})).toThrow();
 expect(()=>normalizeLeaveBatchRequest({...base,kind:undefined})).toThrow();
});