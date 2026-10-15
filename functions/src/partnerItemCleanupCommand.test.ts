import {describe,it,expect} from 'vitest';
import {executePartnerItemCleanup,partnerItemCleanupReceiptId} from './partnerItemCleanupCommand';
import {normalizePartnerItemCleanupRequest,serializePartnerItemCleanupRequest,normalizePartnerItemCleanupReference} from './shared/partnerItemCleanup';
const request={version:1 as const,companyId:'taebaek' as const,linkId:'link',operationId:'operation',releaseId:'release',expectedVersion:'123:000000001',reason:'보관 연결 정리'};
describe('연결 단건 정리 계약',()=>{
 it('최초 원문을 안정적으로 직렬화한다',()=>{expect(JSON.parse(serializePartnerItemCleanupRequest(request))).toEqual(request);expect(serializePartnerItemCleanupRequest({...request})).toBe(serializePartnerItemCleanupRequest(request));});
 it('손상되거나 추가된 입력은 거절한다',()=>{for(const patch of [{version:2},{linkId:'../x'},{expectedVersion:'123:1'},{reason:''},{reason:'x'.repeat(501)},{companyId:'unknown'},{operationId:'x/y'},{extra:true}])expect(()=>normalizePartnerItemCleanupRequest({...request,...patch})).toThrow();});
 it('원문 손상 중단용 참조는 엄격한 세 칸만 허용한다',()=>{expect(normalizePartnerItemCleanupReference({companyId:'taebaek',linkId:'l',operationId:'o'}).linkId).toBe('l');expect(()=>normalizePartnerItemCleanupReference({...request})).toThrow();});
 it('다른 회사와 UID는 같은 작업 번호를 공유하지 않는다',()=>{expect(new Set([partnerItemCleanupReceiptId('taebaek','a','op'),partnerItemCleanupReceiptId('punghoe','a','op'),partnerItemCleanupReceiptId('taebaek','b','op')]).size).toBe(3);});
 it('권한 없는 요청은 DB에 닿기 전에 거절한다',async()=>{for(const actor of [undefined,{uid:'u',token:{isAdmin:'true',companyId:'taebaek',employeeId:'e'}},{uid:'u',token:{isAdmin:true,companyId:'other',employeeId:'e'}},{uid:'u',token:{isAdmin:true,companyId:'taebaek'}}])await expect(executePartnerItemCleanup({} as any,actor,{mode:'read',companyId:'taebaek',linkId:'l'})).rejects.toThrow();});
});
