/** @vitest-environment jsdom */
import {act,cleanup,fireEvent,render,renderHook,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {Partner} from '../../../shared/types';
const mock=vi.hoisted(()=>({auth:{currentUser:{uid:'uid'} as {uid:string}|null},confirm:vi.fn(),listener:null as null|((user:{uid:string}|null)=>void)}));
vi.mock('../../../shared/firebase',()=>({auth:mock.auth}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_a:unknown,cb:typeof mock.listener)=>{mock.listener=cb;return()=>{};}}));
vi.mock('../../../shared/components/appDialog',()=>({appConfirm:mock.confirm}));
vi.mock('../ui/OemIssueModal',async()=>{const React=await import('react');return {IssueModal:()=>{const [value,setValue]=React.useState('');return <input aria-label="부모 세대 확인" value={value} onChange={e=>setValue(e.target.value)}/>;},OemExternalEvidenceRows:()=>null};});
import {useOemConditions} from './useOemConditions';
import {OemConditionModal} from '../ui/OemConditionModal';
import OemManager from '../../../../components/OemManager';
import {partnerEditKey,type PartnerEditBindings,type PartnerEditEntry} from '../../../shared/services/partnerEditWrites';
import {serializePartnerEditRequest} from '../../../shared/partnerEditCommand';
afterEach(()=>{cleanup();mock.auth.currentUser={uid:'uid'};});
HTMLElement.prototype.scrollIntoView=vi.fn();
it('기존 거래처 편집 수명을 통해 원문 조건을 보관하고 같은 tick 중복 저장을 막는다',async()=>{
 const partner:Partner={id:'p',name:'공장',type:'일반',companyId:'taebaek',isOemFactory:true};let release!:(v:any)=>void;const pending=new Promise<any>(r=>release=r);const stored:PartnerEditEntry[]=[];
 const ports:PartnerEditBindings={open:vi.fn(async(_s,reference,opening)=>({reference,actorUid:'uid',opening,expectedVersion:'1:000000000'})),read:vi.fn(async()=>stored),prepare:vi.fn(async(scope,request)=>{const raw=serializePartnerEditRequest(request);const row:PartnerEditEntry={key:partnerEditKey(scope,request.reference),reference:request.reference,request:JSON.parse(raw),requestHash:'a'.repeat(64),referenceHash:null,observedLocalText:raw,observedReferenceText:null,status:'valid',description:'공장'};stored.push(row);return row;}),command:vi.fn(()=>pending),discard:vi.fn(async()=>({status:'cleared' as const,message:'정리'})),history:vi.fn(async(scope)=>({version:1 as const,...scope,entries:[],nextCursor:null}))};
 const h=renderHook(()=>useOemConditions({companyId:'taebaek',actorUid:'uid',partners:[partner],partnerEditBindings:ports}));await waitFor(()=>expect(h.result.current.readLoading).toBe(false));await act(async()=>h.result.current.openEditing(partner));
 const terms={version:2 as const,rows:[{itemId:'item',processing:{unit:'kg' as const,grossUnitPrice:0,taxExempt:false},vendorPackaging:{unit:'box' as const,grossUnitPrice:3,taxExempt:true}}]};
 act(()=>{h.result.current.setEditForm(p=>p?{...p,oemReceiptTermsV2:terms}:p);void h.result.current.saveEditing();void h.result.current.saveEditing();});await waitFor(()=>expect(ports.command).toHaveBeenCalledTimes(1));expect(ports.prepare).toHaveBeenCalledTimes(1);expect(stored[0].request?.patch).toEqual({oemReceiptTermsV2:terms});
 await act(async()=>{release({terminal:false,outcome:{status:'unknown',message:'응답 유실'}});await pending;});expect(h.result.current.failureCount).toBe(1);expect(h.result.current.canRetry(h.result.current.failureRows[0].entry)).toBe(true);
});
it('거래처 원문 열기 대기 중에는 품목 추가와 저장이 차단되고 응답 뒤 편집할 수 있다',async()=>{
 const partner={id:'p',companyId:'taebaek',name:'공장 A',type:'일반',isOemFactory:true} as Partner;
 let release!:(value:any)=>void;const pending=new Promise<any>(resolve=>release=resolve);
 const ports:PartnerEditBindings={open:vi.fn(()=>pending),read:vi.fn(async()=>[]),prepare:vi.fn(),command:vi.fn(),discard:vi.fn(),history:vi.fn(async(scope)=>({version:1 as const,...scope,entries:[],nextCursor:null}))};
 render(<OemConditionModal companyId="taebaek" actorUid="uid" partners={[partner]} items={[]} onClose={vi.fn()} partnerEditBindings={ports}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'조건 외주공장'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'조건 외주공장'}));fireEvent.click(screen.getByRole('option',{name:'공장 A'}));
 const add=await screen.findByRole('button',{name:'품목 추가'});expect(add).toBeDisabled();expect(screen.getByRole('button',{name:'조건 저장'})).toBeDisabled();fireEvent.click(add);expect(screen.queryByLabelText('1 processing 단가')).toBeNull();expect(ports.prepare).not.toHaveBeenCalled();
 const [scope,reference,opening]=vi.mocked(ports.open).mock.calls[0];await act(async()=>{release({reference,actorUid:scope.actorUid,opening,expectedVersion:'1:000000000'});await pending;});
 await waitFor(()=>expect(screen.getByRole('button',{name:'품목 추가'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'품목 추가'}));expect(screen.getByLabelText('1 processing 단가')).toBeInTheDocument();expect(ports.prepare).not.toHaveBeenCalled();
});
it('실제 편집 훅으로 UI 조건 원문을 한 번만 저장하고 미저장 전환·닫기를 거절하면 입력을 보존한다',async()=>{
 const partners=[{id:'p',companyId:'taebaek',name:'공장 A',type:'일반',isOemFactory:true},{id:'q',companyId:'taebaek',name:'공장 B',type:'일반',isOemFactory:true}] as Partner[];
 const items=[{id:'item',companyId:'taebaek',name:'입고품',type:'product',procureType:'임가공'}] as any;
 const stored:PartnerEditEntry[]=[];let release!:(value:any)=>void;const pending=new Promise<any>(r=>release=r);
 const ports:PartnerEditBindings={open:vi.fn(async(_s,reference,opening)=>({reference,actorUid:'uid',opening,expectedVersion:'1:000000000'})),read:vi.fn(async()=>stored),prepare:vi.fn(async(scope,request)=>{const raw=serializePartnerEditRequest(request);const row:PartnerEditEntry={key:partnerEditKey(scope,request.reference),reference:request.reference,request:JSON.parse(raw),requestHash:'a'.repeat(64),referenceHash:null,observedLocalText:raw,observedReferenceText:null,status:'valid',description:'공장'};stored.push(row);return row;}),command:vi.fn(()=>pending),discard:vi.fn(async()=>({status:'cleared' as const,message:'정리'})),history:vi.fn(async(scope)=>({version:1 as const,...scope,entries:[],nextCursor:null}))};
 mock.confirm.mockResolvedValue(false);const onClose=vi.fn();render(<OemConditionModal companyId="taebaek" actorUid="uid" partners={partners} items={items} onClose={onClose} partnerEditBindings={ports}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'조건 외주공장'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'조건 외주공장'}));fireEvent.click(screen.getByRole('option',{name:'공장 A'}));await waitFor(()=>expect(screen.getByRole('button',{name:'품목 추가'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'품목 추가'}));fireEvent.click(screen.getByRole('button',{name:'조건 1 품목'}));fireEvent.click(screen.getByRole('option',{name:'입고품'}));fireEvent.change(screen.getByLabelText('1 processing 단가'),{target:{value:'0'}});fireEvent.change(screen.getByLabelText('1 vendorPackaging 단가'),{target:{value:'120'}});fireEvent.change(screen.getByLabelText('1 vendorPackaging 단위'),{target:{value:'box'}});
 fireEvent.click(screen.getByRole('button',{name:'조건 외주공장'}));fireEvent.click(screen.getByRole('option',{name:'공장 B'}));await waitFor(()=>expect(mock.confirm).toHaveBeenCalledTimes(1));expect(screen.getByLabelText('1 processing 단가')).toHaveValue('0');
 fireEvent.click(screen.getByRole('button',{name:'취소'}));await waitFor(()=>expect(mock.confirm).toHaveBeenCalledTimes(2));expect(onClose).not.toHaveBeenCalled();expect(screen.getByLabelText('1 vendorPackaging 단가')).toHaveValue('120');
 fireEvent.click(screen.getByRole('button',{name:'조건 저장'}));fireEvent.click(screen.getByRole('button',{name:'조건 저장'}));await waitFor(()=>expect(ports.command).toHaveBeenCalledTimes(1));expect(ports.prepare).toHaveBeenCalledTimes(1);expect(stored[0].request?.patch).toEqual({oemReceiptTermsV2:{version:2,rows:[{itemId:'item',processing:{unit:'kg',grossUnitPrice:0,taxExempt:false},vendorPackaging:{unit:'box',grossUnitPrice:120,taxExempt:false}}]}});expect(screen.getByLabelText('1 processing 단가')).toBeDisabled();
 await act(async()=>{release({terminal:false,outcome:{status:'unknown',message:'응답 유실'}});await pending;});expect(screen.getByText(/저장 요청 1건/)).toBeInTheDocument();expect(screen.getByLabelText('1 processing 단가')).toHaveValue('0');
});
it('폐기 확인 대기 중 UID가 바뀌면 옛 확인은 새 화면을 닫지 않고 초안을 노출하지 않는다',async()=>{
 const partner={id:'p',companyId:'taebaek',name:'공장 A',type:'일반',isOemFactory:true} as Partner;
 const ports:PartnerEditBindings={open:vi.fn(async(scope,reference,opening)=>({reference,actorUid:scope.actorUid,opening,expectedVersion:'1:000000000'})),read:vi.fn(async()=>[]),prepare:vi.fn(),command:vi.fn(),discard:vi.fn(),history:vi.fn(async(scope)=>({version:1 as const,...scope,entries:[],nextCursor:null}))};
 let answer!:(value:boolean)=>void;mock.confirm.mockReset().mockImplementation(()=>new Promise<boolean>(r=>answer=r));const onClose=vi.fn();
 const props={companyId:'taebaek' as const,actorUid:'uid',partners:[partner],items:[],onClose,partnerEditBindings:ports};const view=render(<OemConditionModal {...props}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'조건 외주공장'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'조건 외주공장'}));fireEvent.click(screen.getByRole('option',{name:'공장 A'}));await waitFor(()=>expect(screen.getByRole('button',{name:'품목 추가'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'품목 추가'}));fireEvent.change(screen.getByLabelText('1 processing 단가'),{target:{value:'777'}});fireEvent.click(screen.getByRole('button',{name:'취소'}));await waitFor(()=>expect(mock.confirm).toHaveBeenCalledTimes(1));
 await act(async()=>{mock.auth.currentUser={uid:'other'};mock.listener?.({uid:'other'});view.rerender(<OemConditionModal {...props} actorUid="other"/>);});
 expect(screen.queryByDisplayValue('777')).toBeNull();expect(screen.getByRole('button',{name:'조건 외주공장'})).toHaveTextContent('선택');await act(async()=>answer(true));expect(onClose).not.toHaveBeenCalled();await waitFor(()=>expect(screen.getByRole('button',{name:'조건 외주공장'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'조건 외주공장'}));fireEvent.click(screen.getByRole('option',{name:'공장 A'}));await waitFor(()=>expect(screen.getByRole('button',{name:'품목 추가'})).toBeEnabled());expect(screen.queryByDisplayValue('777')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'품목 추가'}));fireEvent.change(screen.getByLabelText('1 processing 단가'),{target:{value:'888'}});view.rerender(<OemConditionModal {...props} companyId="punghoe" actorUid="other"/>);expect(screen.queryByDisplayValue('888')).toBeNull();view.rerender(<OemConditionModal {...props} actorUid="other"/>);expect(screen.queryByDisplayValue('888')).toBeNull();
});
it('실제 OEM 부모는 회사 또는 UID가 바뀌면 열린 발주 하위 화면의 세대를 새로 만든다',()=>{
 const props={companyId:'taebaek' as const,actorUid:'uid',items:[],partners:[],rawStockKg:()=>0,issueDrafts:[],purchaseOrders:[],issueOpen:true,receiveTarget:null,feeTarget:null,onClose:vi.fn(),onIssue:vi.fn(),onReceive:vi.fn(),onIssueFee:vi.fn()};
 const view=render(<OemManager {...props}/>);fireEvent.change(screen.getByLabelText('부모 세대 확인'),{target:{value:'기존 초안'}});
 view.rerender(<OemManager {...props} actorUid="other"/>);expect(screen.getByLabelText('부모 세대 확인')).toHaveValue('');
 fireEvent.change(screen.getByLabelText('부모 세대 확인'),{target:{value:'다른 계정'}});view.rerender(<OemManager {...props} companyId="punghoe" actorUid="other"/>);expect(screen.getByLabelText('부모 세대 확인')).toHaveValue('');
});
