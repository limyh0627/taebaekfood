import {describe,it,expect} from 'vitest';
import {directoryDeleteOpening,normalizeDirectoryDeleteReference,normalizeDirectoryDeleteRequest,normalizeDirectoryDeletePreview,normalizeDirectoryDeleteResult,serializeDirectoryDeleteRequest} from './directoryDeleteCommand';
const reference={companyId:'taebaek' as const,planId:'plan',kind:'partner' as const,targetId:'긴한글거래처'.repeat(20)};
const opening=directoryDeleteOpening({name:'거래처',companyId:'taebaek',id:'합성',price:1});
const request={version:1 as const,reference,opening,expectedVersion:'123:000000001'};
describe('디렉터리 삭제 원문 계약',()=>{
  it('이름·회사만 존재성을 보존하고 긴 기존 ID와 native 나노초를 유지한다',()=>{
    expect(opening).toEqual(['map',[['companyId',['string','taebaek']],['name',['string','거래처']]]]);
    expect(directoryDeleteOpening({name:'거래처'})).not.toEqual(opening);
    expect(directoryDeleteOpening({name:null})).toEqual(['map',[['name',['null']]]]);
    expect(normalizeDirectoryDeleteReference(reference)).toEqual(reference);
    expect(JSON.parse(serializeDirectoryDeleteRequest(request))).toEqual(request);
    expect(()=>normalizeDirectoryDeleteRequest({...request,expectedVersion:'123:1'})).toThrow();
    expect(()=>normalizeDirectoryDeleteReference({...reference,targetId:'a/b'})).toThrow();
  });
  it('알 수 없는 patch·collection과 원문 필드 추가를 거절한다',()=>{
    expect(()=>normalizeDirectoryDeleteReference({...reference,collection:'users'})).toThrow();
    expect(()=>normalizeDirectoryDeleteRequest({...request,patch:{name:'변경'}})).toThrow();
    expect(()=>normalizeDirectoryDeleteRequest({...request,opening:['map',[['id',['string','다른번호']]]]})).toThrow();
  });
  it('preview와 결과는 회사·UID·종류·대상·해시 전체에 묶인다',()=>{
    const preview={reference,actorUid:'uid',opening,expectedVersion:request.expectedVersion};
    expect(normalizeDirectoryDeletePreview(preview,reference,'uid')).toEqual(preview);
    expect(()=>normalizeDirectoryDeletePreview(preview,{...reference,kind:'employee'},'uid')).toThrow();
    const result={version:1 as const,reference,actorUid:'uid',status:'applied' as const,requestHash:'a'.repeat(64),message:'완료'};
    expect(normalizeDirectoryDeleteResult(result,reference,'uid','a'.repeat(64))).toEqual(result);
    expect(()=>normalizeDirectoryDeleteResult(result,reference,'other')).toThrow();
    expect(()=>normalizeDirectoryDeleteResult(result,reference,'uid','b'.repeat(64))).toThrow();
    expect(()=>normalizeDirectoryDeleteResult({...result,requestHash:null},reference,'uid')).toThrow();
    expect(()=>normalizeDirectoryDeleteResult({...result,status:'rejected',requestHash:null},reference,'uid')).toThrow();
    expect(normalizeDirectoryDeleteResult({...result,status:'cancelled',requestHash:null},reference,'uid').status).toBe('cancelled');
  });
});
