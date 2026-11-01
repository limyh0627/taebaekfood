/** @vitest-environment jsdom */
import React from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {OemConditionModal} from './OemConditionModal';
import {IssueModal} from './OemIssueModal';
import {partnerEditKey,type PartnerEditBindings,type PartnerEditEntry} from '../../../shared/services/partnerEditWrites';
import {serializePartnerEditRequest} from '../../../shared/partnerEditCommand';
const mock=vi.hoisted(()=>({auth:{currentUser:{uid:'uid'}}}));
vi.mock('../../../shared/firebase',()=>({auth:mock.auth}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:()=>()=>{}}));
vi.mock('../../../shared/services/oemExternalStockEvidence',()=>({readOemExternalStockEvidence:vi.fn().mockResolvedValue([])}));
HTMLElement.prototype.scrollIntoView=vi.fn();
afterEach(cleanup);
function ports(){const rows:PartnerEditEntry[]=[];const api:PartnerEditBindings={read:vi.fn(async()=>rows),open:vi.fn(async(scope,reference,opening)=>({reference,actorUid:scope.actorUid,opening,expectedVersion:'1:000000000'})),prepare:vi.fn(async(scope,request)=>{const raw=serializePartnerEditRequest(request),entry:PartnerEditEntry={key:partnerEditKey(scope,request.reference),reference:request.reference,request:JSON.parse(raw),requestHash:'a'.repeat(64),referenceHash:null,observedLocalText:raw,observedReferenceText:null,status:'valid',description:'거래처'};rows.push(entry);return entry;}),command:vi.fn<PartnerEditBindings['command']>(async(_scope,entry)=>{rows.splice(rows.indexOf(entry),1);return {terminal:true,result:{version:1,reference:entry.reference!,actorUid:'uid',status:'applied',requestHash:entry.requestHash,message:'완료'},outcome:{status:'saved'}};}),discard:vi.fn<PartnerEditBindings['discard']>(async()=>({status:'cleared',message:'정리'})),history:vi.fn(async(scope)=>({version:1,...scope,entries:[],nextCursor:null}))};return {api,rows};}
const items=[{id:'one',companyId:'taebaek',name:'합성제품',type:'product',procureType:'임가공'}] as any;
async function selectPartner(name:string){await waitFor(()=>expect(screen.getByRole('button',{name:'조건 외주공장'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'조건 외주공장'}));fireEvent.click(screen.getByRole('option',{name}));await screen.findByRole('button',{name:'품목 추가'});}
it('표시 없는 등록 거래처도 실제 편집 훅으로 조건을 저장하고 미입력과 0원을 구분한다',async()=>{
 const initial=[{id:'factory',companyId:'taebaek',name:'기존 거래처',type:'일반'},{id:'other',companyId:'punghoe',name:'다른회사',type:'일반'},{id:'archived',companyId:'taebaek',name:'보관 거래처',type:'일반',archived:true}] as any;
 const {api}=ports();const view=render(<OemConditionModal companyId="taebaek" actorUid="uid" partners={initial} items={items} onClose={vi.fn()} partnerEditBindings={api}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'조건 외주공장'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'조건 외주공장'}));expect(screen.queryByRole('option',{name:'다른회사'})).toBeNull();expect(screen.queryByRole('option',{name:'보관 거래처'})).toBeNull();fireEvent.click(screen.getByRole('option',{name:'기존 거래처'}));
 await screen.findByRole('button',{name:'품목 추가'});fireEvent.click(screen.getByRole('button',{name:'품목 추가'}));fireEvent.click(screen.getByRole('button',{name:'조건 1 품목'}));fireEvent.click(screen.getByRole('option',{name:'합성제품'}));
 fireEvent.click(screen.getByRole('button',{name:'조건 저장'}));expect(screen.getByRole('alert')).toHaveTextContent('각각 입력');expect(api.prepare).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('1 processing 단가'),{target:{value:'0'}});fireEvent.change(screen.getByLabelText('1 vendorPackaging 단가'),{target:{value:'120'}});fireEvent.change(screen.getByLabelText('1 vendorPackaging 단위'),{target:{value:'box'}});fireEvent.click(screen.getByRole('button',{name:'조건 저장'}));
 await waitFor(()=>expect(api.prepare).toHaveBeenCalledTimes(1));expect(vi.mocked(api.prepare).mock.calls[0][1].patch).toEqual({oemReceiptTermsV2:{version:2,rows:[{itemId:'one',processing:{unit:'kg',grossUnitPrice:0,taxExempt:false},vendorPackaging:{unit:'box',grossUnitPrice:120,taxExempt:false}}]}});
 await waitFor(()=>expect(screen.getByText('거래처를 수정했습니다.')).toBeInTheDocument());view.rerender(<OemConditionModal companyId="taebaek" actorUid="uid" partners={[...initial,{id:'new',companyId:'taebaek',name:'신규 거래처',type:'일반'}]} items={items} onClose={vi.fn()} partnerEditBindings={api}/>);await selectPartner('신규 거래처');expect(vi.mocked(api.open).mock.calls.at(-1)?.[1].targetId).toBe('new');
});
it('손상된 기존 조건은 빈 목록으로 저장하지 않고 원본 확인을 요구한다',async()=>{
 const partner={id:'factory',companyId:'taebaek',name:'외주공장',type:'일반',oemReceiptTermsV2:{version:2,rows:[{itemId:'bad'}]}} as any;const {api}=ports();
 render(<OemConditionModal companyId="taebaek" actorUid="uid" partners={[partner]} items={[]} onClose={vi.fn()} partnerEditBindings={api}/>);await waitFor(()=>expect(screen.getByRole('button',{name:'조건 외주공장'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'조건 외주공장'}));fireEvent.click(screen.getByRole('option',{name:'외주공장'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('원본을 확인');expect(screen.getByRole('button',{name:'조건 저장'})).toBeDisabled();expect(api.prepare).not.toHaveBeenCalled();
});
it('무표시 거래처의 실제 저장 요청을 받은 뒤 갱신된 발주 화면에서 그 거래처를 선택한다',async()=>{
 const partner={id:'plain',companyId:'taebaek',name:'새 외주처',type:'일반'},flagged={id:'flag',companyId:'taebaek',name:'표시 공장',type:'일반',isOemFactory:true};const {api}=ports();
 const view=render(<OemConditionModal companyId="taebaek" actorUid="uid" partners={[partner,flagged] as any} items={items} onClose={vi.fn()} partnerEditBindings={api}/>);await selectPartner('새 외주처');fireEvent.click(screen.getByRole('button',{name:'품목 추가'}));fireEvent.click(screen.getByRole('button',{name:'조건 1 품목'}));fireEvent.click(screen.getByRole('option',{name:'합성제품'}));fireEvent.change(screen.getByLabelText('1 processing 단가'),{target:{value:'100'}});fireEvent.change(screen.getByLabelText('1 vendorPackaging 단가'),{target:{value:'0'}});fireEvent.click(screen.getByRole('button',{name:'조건 저장'}));await waitFor(()=>expect(api.prepare).toHaveBeenCalledTimes(1));const saved=vi.mocked(api.prepare).mock.calls[0][1].patch.oemReceiptTermsV2!;await waitFor(()=>expect(api.command).toHaveBeenCalledTimes(1));
 const submit=vi.fn();view.rerender(<IssueModal companyId="taebaek" partners={[{...partner,oemReceiptTermsV2:saved},flagged] as any} rawItems={[{id:'raw',companyId:'taebaek',name:'참깨',type:'raw'}] as any} rawStockKg={()=>100} issueDrafts={[]} busy={false} onClose={vi.fn()} onSubmit={submit}/>);
 expect(submit).not.toHaveBeenCalled();fireEvent.change(screen.getByRole('option',{name:'새 외주처'}).parentElement!,{target:{value:'plain'}});fireEvent.change(screen.getByRole('option',{name:'참깨'}).parentElement!,{target:{value:'참깨'}});fireEvent.change(screen.getByPlaceholderText('kg'),{target:{value:'20'}});fireEvent.click(screen.getByRole('button',{name:'발주 (원료 내보내기)'}));expect(submit).toHaveBeenCalledWith(expect.objectContaining({oemPartnerId:'plain',sent:[{material:'참깨',kg:20}]}));
});
