import {appConfirm} from '../../../shared/components/appDialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Partner, Item, PartnerItem, Order, OrderItem } from '../../../../types';
import type {CompanyId} from '../../../shared/types';
import type {PendingSubmissionRead} from '../../../shared/services/pendingSubmissionRead';
import { OrderStatus, OrderSource } from '../../../../types';
import { isLinkedToPartner, salePriceOf } from '../../../shared/partnerPrice';
import {readOwnedCheckpoint,writeOwnedCheckpoint,ownedCheckpointKey,CheckpointConflict,type CheckpointOwner} from '../../../shared/sessionOwnedCheckpointStore';
import {registerSessionWork,isSessionWorkChecking} from '../../../shared/sessionWorkCheckpoint';
type PortalDraft={partnerIdInput:string;partnerId:string|null;cart:Record<string,number>};
type PortalCheckpoint={phase:'draft'|'prepared'|'submitted'|'acknowledged';draft:PortalDraft;order?:Order};
const feature='partner-portal';
const validCheckpoint=(value:unknown):value is PortalCheckpoint=>{
 const p=value as PortalCheckpoint;if(!p||!['draft','prepared','submitted','acknowledged'].includes(p.phase)||!p.draft||typeof p.draft.partnerIdInput!=='string'||!(p.draft.partnerId===null||typeof p.draft.partnerId==='string')||!p.draft.cart||Array.isArray(p.draft.cart)||Object.values(p.draft.cart).some(q=>typeof q!=='number'||!Number.isFinite(q)||q<0))return false;
 if(p.phase==='draft')return p.order===undefined;
 return !!p.order&&typeof p.order.id==='string'&&p.order.id.startsWith('WEB-')&&typeof p.order.partnerId==='string'&&typeof p.order.partnerName==='string'&&typeof p.order.status==='string'&&typeof p.order.email==='string'&&typeof p.order.source==='string'&&typeof p.order.region==='string'&&typeof p.order.totalAmount==='number'&&Number.isFinite(p.order.totalAmount)&&typeof p.order.createdAt==='string'&&typeof p.order.deliveryDate==='string'&&Array.isArray(p.order.items)&&p.order.items.every(r=>typeof r.itemId==='string'&&typeof r.name==='string'&&typeof r.quantity==='number'&&Number.isFinite(r.quantity)&&r.quantity>0&&typeof r.price==='number'&&Number.isFinite(r.price));
};
type Owned={owner:CheckpointOwner|null;payload:PortalCheckpoint;bytes:string|null;error:string;queue:Promise<void>;confirmed:boolean;foreignPacket:boolean;preSendEpoch:number};
interface Options {
    companyId:CompanyId; employeeId:string; getUid:()=>string|undefined; getSignal:()=>AbortSignal;
    readOrder:(id:string,partnerId:string,signal:AbortSignal)=>Promise<PendingSubmissionRead<Order>>;
    partners: Partner[];
    items: Item[];
    partnerItems?: PartnerItem[];
    onOrderSubmit: (order: Order) => Promise<unknown>;
    onExit: () => void;
}
export function usePartnerPortalDraft(options: Options) {
    const {partners,items,partnerItems,onOrderSubmit,onExit}=options;
    const [,paint]=useState(0),latest=useRef(options);latest.current=options;
    const actorKey=options.companyId+':'+options.employeeId+':'+(options.getUid()??'');
    const makeOwned=():Owned=>{const uid=options.getUid(),owner=uid?{uid,companyId:options.companyId,employeeId:options.employeeId}:null;const h:Owned={owner,payload:{phase:'draft',draft:{partnerIdInput:'',partnerId:null,cart:{}}},bytes:null,error:'',queue:Promise.resolve(),confirmed:false,foreignPacket:false,preSendEpoch:0};try{if(owner){const saved=readOwnedCheckpoint(owner,feature,validCheckpoint);if(saved){h.payload=saved.envelope.payload;h.bytes=saved.bytes;}}}catch(error){h.error=String(error);}return h;};
    type Pending={order:Order;signal:AbortSignal;readRun:object|null;result:PendingSubmissionRead<Order>|null;matches:boolean;notice:string};
    const recovery=useRef<{actorKey:string;pending:Pending|null;closeRun:object|null;owned:Owned}|null>(null);
    if(!recovery.current||recovery.current.actorKey!==actorKey){const owned=makeOwned();recovery.current={actorKey,owned,pending:owned.payload.order&&owned.payload.phase!=='acknowledged'?{order:owned.payload.order,signal:options.getSignal(),readRun:null,result:null,matches:false,notice:'이 기기에 보관된 최초 요청입니다. 자동으로 다시 보내지 않았습니다. 주문 저장 여부를 확인해 주세요.'}:null,closeRun:null};}
    const state=recovery.current,h=state.owned;
    const actorCurrent=()=>recovery.current===state&&latest.current.companyId+':'+latest.current.employeeId+':'+(latest.current.getUid()??'')===actorKey;
    const [step, setStep] = useState<'auth' | 'order' | 'confirm'>(h.payload.phase==='acknowledged'?'confirm':partners.some(p=>p.id===h.payload.draft.partnerId)?'order':'auth');
    const [partnerIdInput, setPartnerIdInput] = useState(h.payload.draft.partnerIdInput);
    const [selectedClient, setSelectedClient] = useState<Partner | null>(partners.find(p=>p.id===h.payload.draft.partnerId)??null);
    const [cart, setCart] = useState<{
        [itemId: string]: number;
    }>(h.payload.draft.cart);
    const [isSuccess, setIsSuccess] = useState(h.payload.phase==='acknowledged');
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const mounted = useRef(true);
    const generation = useRef(0);
    const run = useRef<object | null>(null);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; run.current = null; }; }, []);
    const [error, setError] = useState('');
    useEffect(()=>{generation.current++;run.current=null;savingRef.current=false;setSaving(false);setError('');setPartnerIdInput(h.payload.draft.partnerIdInput);setCart(h.payload.draft.cart);setSelectedClient(latest.current.partners.find(p=>p.id===h.payload.draft.partnerId)??null);setStep(h.payload.phase==='acknowledged'?'confirm':latest.current.partners.some(p=>p.id===h.payload.draft.partnerId)?'order':'auth');setIsSuccess(h.payload.phase==='acknowledged');},[actorKey]);
    useEffect(()=>{const signal=options.getSignal();const abort=()=>{if(!mounted.current||recovery.current!==state)return;state.pending=null;generation.current++;run.current=null;savingRef.current=false;setSaving(false);setCart({});setSelectedClient(null);setStep('auth');setIsSuccess(false);setError('로그인 범위가 변경되었습니다. 다시 입장해 주세요.');paint(n=>n+1);};signal.addEventListener('abort',abort);return()=>signal.removeEventListener('abort',abort);},[state,options.getSignal]);
    const pending=state.pending;
    const notify=()=>{if(actorCurrent()&&mounted.current)paint(n=>n+1);};
    const blocked=()=>!!h.owner&&isSessionWorkChecking(h.owner);
    const enqueue=(payload:PortalCheckpoint)=>{h.payload=structuredClone(payload);const fixed=structuredClone(payload);h.queue=h.queue.catch(()=>{}).then(async()=>{if(!h.owner)throw Error('현재 로그인 계정을 확인한 뒤 다시 보관해 주세요.');if(h.foreignPacket)throw Error('다른 창의 최초 요청을 덮지 않았습니다. 다시 읽고 보관본을 확인해 주세요.');const saved=await writeOwnedCheckpoint(h.owner,feature,h.bytes,fixed,validCheckpoint);h.bytes=saved.bytes;h.error='';}).catch(error=>{h.error=String(error);}).then(()=>notify());return h.queue;};
    const checkpointDraft=(patch:Partial<PortalDraft>)=>{void enqueue({...h.payload,draft:{...h.payload.draft,...patch}});};
    const flushCheckpoint=async()=>{await h.queue;if(h.error)throw Error(h.error);};
    useEffect(()=>{if(!h.owner)return;return registerSessionWork(h.owner,{name:'거래처 주문',flush:async retry=>{h.preSendEpoch++;if(retry)await enqueue(h.payload);await flushCheckpoint();}});},[state]);
    const retryCheckpoint=async()=>{if(blocked()||savingRef.current||!actorCurrent())return;await enqueue(h.payload);};
    const readCheckpoint=()=>{if(blocked()||savingRef.current||!actorCurrent()||!h.owner)return;try{const saved=readOwnedCheckpoint(h.owner,feature,validCheckpoint);h.bytes=saved?.bytes??null;h.foreignPacket=!!saved?.envelope.payload.order&&JSON.stringify(saved.envelope.payload.order)!==JSON.stringify(h.payload.order);h.error=saved&&JSON.stringify(saved.envelope.payload)===JSON.stringify(h.payload)?'':'현재 입력과 보관된 내용이 다릅니다. 입력은 보존했습니다. 다시 보관하거나 보관본을 명시적으로 열어 주세요.';}catch(error){h.error=String(error);}notify();};
    const restoreCheckpoint=async()=>{if(blocked()||savingRef.current||!actorCurrent()||!h.owner||state.closeRun)return;const signal=latest.current.getSignal(),epoch=generation.current,execution={};state.closeRun=execution;try{const saved=readOwnedCheckpoint(h.owner,feature,validCheckpoint);if(!saved)throw Error('기기에 보관된 입력이 없습니다. 현재 입력은 보존했습니다.');const approved=await appConfirm({title:'보관된 주문 입력을 열까요?',message:'현재 화면의 입력을 기기에 보관된 내용으로 바꿉니다. 서버 주문은 변경하거나 취소하지 않습니다.',confirmText:'보관본 열기',cancelText:'현재 입력 유지'});if(!approved||blocked()||!actorCurrent()||!mounted.current||signal.aborted||generation.current!==epoch||state.closeRun!==execution)return;if(localStorage.getItem(ownedCheckpointKey(h.owner,feature))!==saved.bytes)throw Error('다른 창의 보관 내용이 다시 바뀌었습니다. 다시 읽어 주세요.');h.payload=saved.envelope.payload;h.bytes=saved.bytes;h.error='';h.foreignPacket=false;h.confirmed=h.payload.phase==='acknowledged';state.pending=h.payload.order&&h.payload.phase!=='acknowledged'?{order:h.payload.order,signal,readRun:null,result:null,matches:false,notice:'기기에 보관된 최초 요청입니다. 자동으로 다시 보내지 않았습니다.'}:null;generation.current++;setPartnerIdInput(h.payload.draft.partnerIdInput);setCart(h.payload.draft.cart);setSelectedClient(latest.current.partners.find(p=>p.id===h.payload.draft.partnerId)??null);setStep(h.payload.phase==='acknowledged'?'confirm':latest.current.partners.some(p=>p.id===h.payload.draft.partnerId)?'order':'auth');setIsSuccess(h.payload.phase==='acknowledged');setError('');}catch(error){if(actorCurrent()&&mounted.current)h.error=String(error);}finally{if(state.closeRun===execution)state.closeRun=null;notify();}};
    const readPending=async()=>{
        const attempt=state.pending;if(savingRef.current||!attempt||attempt.readRun||!actorCurrent()||attempt.signal.aborted)return;
        const execution={};attempt.readRun=execution;attempt.result=null;attempt.matches=false;attempt.notice='주문 내역을 확인 중입니다.';notify();
        const current=()=>actorCurrent()&&mounted.current&&state.pending===attempt&&!attempt.signal.aborted&&attempt.readRun===execution;
        try{let result=await latest.current.readOrder(attempt.order.id,attempt.order.partnerId!,attempt.signal);if(!current())return;setError('');
            if(result.kind==='found'&&(result.record.id!==attempt.order.id||result.record.companyId!==latest.current.companyId||result.record.partnerId!==attempt.order.partnerId))result={kind:'unconfirmed',reason:'현재 요청의 기록을 확인하지 못했습니다.'};
            attempt.result=result;attempt.matches=result.kind==='found'&&!isDeleted(result.record)&&orderOriginal(result.record)===orderOriginal(attempt.order);
            attempt.notice=result.kind==='missing'?'현재 등록된 내역에서 주문을 찾지 못했습니다. 최초 요청의 미처리나 취소를 뜻하지 않습니다. 입력을 보존했으며 다시 조회할 수 있습니다.':result.kind==='unconfirmed'?result.reason: isDeleted(result.record)?'삭제 상태의 주문입니다. 최초 요청을 다시 보내지 않았습니다.':attempt.matches?'현재 등록된 내역에 같은 내용의 주문이 있습니다. 확인 후 새 주문을 작성할 수 있습니다.':'조회한 주문 내용이 최초 요청과 다릅니다. 입력을 보존했으며 덮어쓰지 않았습니다.';
        }catch{if(current()){setError('');attempt.result={kind:'unconfirmed',reason:'조회하지 못했습니다. 입력을 보존했습니다. 다시 조회해 주세요.'};attempt.matches=false;attempt.notice=attempt.result.reason;}}finally{if(current()){attempt.readRun=null;notify();}}
    };
    const startNewOrder=async()=>{const attempt=state.pending;if(blocked()||savingRef.current||!attempt?.matches||attempt.readRun||!actorCurrent()||attempt.signal.aborted)return;savingRef.current=true;setSaving(true);try{await enqueue({phase:'draft',draft:{...h.payload.draft,cart:{}}});if(h.error||!actorCurrent()||!mounted.current||state.pending!==attempt||attempt.signal.aborted)return;state.pending=null;generation.current++;setCart({});setIsSuccess(false);setStep('order');setError('');notify();}finally{if(actorCurrent()&&mounted.current){savingRef.current=false;setSaving(false);}}};
    const edit = (action: () => void) => {
        if (blocked()||!actorCurrent()||savingRef.current)
            return;
        generation.current++;
        setError('');
        action();
    };
    const changePartnerInput = (value: string) => edit(() => {setPartnerIdInput(value);checkpointDraft({partnerIdInput:value});});
    const backToAuth = () => edit(() => { setStep('auth'); });
    const exit = async () => {
        const signal=latest.current.getSignal();
        if (blocked()||!mounted.current||!actorCurrent()||signal.aborted||savingRef.current||state.closeRun)return;
        const attempt=state.pending;
        if(!attempt){const execution={},owner=generation.current;state.closeRun=execution;try{await flushCheckpoint();if(mounted.current&&actorCurrent()&&!signal.aborted&&state.closeRun===execution&&generation.current===owner&&!savingRef.current)latest.current.onExit();}catch{/* 미보관 입력은 같은 화면에서 다시 보관한다. */}finally{if(state.closeRun===execution)state.closeRun=null;}return;}
        const execution={},owner=generation.current;
        state.closeRun=execution;
        const current=()=>mounted.current&&actorCurrent()&&!signal.aborted&&!attempt.signal.aborted&&state.closeRun===execution&&generation.current===owner&&state.pending===attempt&&!savingRef.current;
        try{
            await flushCheckpoint();if(!current())return;
            const approved=await appConfirm({title:'주문 확인 화면을 나갈까요?',message:'주문 '+attempt.order.id+'의 원문은 이 기기에 보관되어 같은 계정으로 다시 확인할 수 있습니다. 서버 주문은 취소되지 않습니다.',confirmText:'나가기',cancelText:'계속 확인'});
            if(approved&&current())latest.current.onExit();
        }catch{/* 확인창을 열지 못했거나 거절되면 원문을 보존한다. */}
        finally{if(state.closeRun===execution)state.closeRun=null;}
    };
    const orderAgain = async () => {if(state.pending||blocked()||savingRef.current||!actorCurrent())return;savingRef.current=true;try{await enqueue({phase:'draft',draft:{...h.payload.draft,cart:{}}});if(h.error||!actorCurrent()||!mounted.current)return;generation.current++;setStep('order');setCart({});setIsSuccess(false);}finally{if(actorCurrent()&&mounted.current)savingRef.current=false;}};
    const handleAuth = (e: React.FormEvent) => {
        e.preventDefault();
        if (blocked()||!actorCurrent()||savingRef.current)
            return;
        generation.current++;
        const partner = partners.find(c => c.id.toLowerCase() === partnerIdInput.toLowerCase());
        if (partner) {
            setSelectedClient(partner);
            setStep('order');
            checkpointDraft({partnerId:partner.id});
        }
        else {
            alert('유효하지 않은 거래처 코드입니다. (예: c1, c2)');
        }
    };
    const associatedProducts = useMemo(() => {
        if (!selectedClient)
            return [];
        return items.filter(p => p.type === 'product' &&
            isLinkedToPartner(partnerItems, selectedClient.id, p.id));
    }, [items, selectedClient, partnerItems]);
    const updateCart = (itemId: string, delta: number) => {
        if (blocked()||!actorCurrent()||savingRef.current)
            return;
        generation.current++;
        const nextCart=(() => {const prev=h.payload.draft.cart;
            const current = prev[itemId] || 0;
            const next = Math.max(0, current + delta);
            if (next === 0) {
                const { [itemId]: _unused, ...rest } = prev;
                return rest;
            }
            return { ...prev, [itemId]: next };
        })();setCart(nextCart);checkpointDraft({cart:nextCart});
    };
    /** 이 거래처에 파는 단가. 안 정해져 있으면 undefined — 0 으로 눙치지 않는다. */
    const 단가 = (itemId: string) => salePriceOf(partnerItems, selectedClient?.id ?? '', itemId);
    // Fix: Explicitly type reduce parameters to avoid arithmetic error with unknown types
    const totalAmount = Object.entries(cart).reduce((sum: number, [id, qty]) => {
        const product = items.find(p => p.id === id);
        // Fix: Explicitly cast qty as number as Object.entries value might be inferred as unknown in some environments
        return sum + (product ? (단가(product.id) ?? 0) * (qty as number) : 0);
    }, 0);
    const handleSubmit = async () => {
        if (blocked()||!selectedClient || savingRef.current || state.pending || !actorCurrent() || options.getSignal().aborted)
            return;
        savingRef.current = true;
        setSaving(true);
        setError('');
        const owner = generation.current,signal=options.getSignal();
        const execution = {};
        run.current = execution;
        const current = () => mounted.current && actorCurrent() && !signal.aborted && generation.current === owner && run.current === execution;
        const preSendEpoch=h.preSendEpoch,canSend=()=>{if(current()&&!blocked()&&h.preSendEpoch===preSendEpoch)return true;if(current()){const message='로그아웃 보관 확인이 시작되어 주문을 전송하지 않았습니다. 입력은 보존했습니다.';setError(message);if(state.pending)state.pending.notice=message+' 최초 주문 번호로 저장 여부를 확인할 수 있습니다.';notify();}return false;};
        let sent = false;
        try {
            if (!current())
                return;
            if (!partners.some(partner => partner.id === selectedClient.id))
                throw Error('선택한 거래처가 현재 목록에 없습니다. 거래처를 다시 확인해 주세요.');
            for (const [id, qty] of Object.entries(cart)) {
                if (!items.some(product => product.id === id))
                    throw Error('주문할 품목이 현재 목록에 없습니다. 품목을 다시 확인해 주세요.');
                if (!isLinkedToPartner(partnerItems, selectedClient.id, id))
                    throw Error('현재 거래처와 연결되지 않은 품목이 있습니다. 품목 연결을 다시 확인해 주세요.');
                if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0)
                    throw Error('주문 수량은 0보다 큰 유한한 숫자로 입력해 주세요.');
            }
            const orderItems: OrderItem[] = Object.entries(cart).map(([id, qty]) => {
                const product = items.find(p => p.id === id)!;
                return {
                    itemId: id,
                    name: product.name,
                    // Fix: Explicitly cast qty as number to match OrderItem.quantity type
                    quantity: qty as number,
                    price: 단가(id) ?? 0,
                    checked: false
                };
            });
            const newOrder: Order = {
                id: `WEB-${Date.now()}`,
                partnerId: selectedClient.id,
                partnerName: selectedClient.name,
                items: orderItems,
                totalAmount,
                status: OrderStatus.PENDING,
                createdAt: new Date().toISOString(),
                deliveryDate: new Date(Date.now() + 86400000 * 3).toISOString(), // 기본 3일 뒤
                email: selectedClient.email || '',
                source: selectedClient.type as OrderSource,
                region: selectedClient.region || '미지정'
            };
            if (!current())
                return;
            const original=JSON.parse(JSON.stringify(newOrder)) as Order;
            await flushCheckpoint();if(!canSend())return;
            state.pending={order:original,signal,readRun:null,result:null,matches:false,notice:''};
            await enqueue({phase:'prepared',draft:h.payload.draft,order:original});await flushCheckpoint();if(!canSend())return;
            await enqueue({...h.payload,phase:'submitted'});await flushCheckpoint();if(!canSend())return;
            if(!canSend())return;
            sent = true;
            await onOrderSubmit(JSON.parse(JSON.stringify(original)) as Order);
            h.confirmed=true;
            await enqueue({...h.payload,phase:'acknowledged',order:original});
            if (!current())
                return;
            state.pending=null;
            setIsSuccess(true);
            setStep('confirm');
        }
        catch (error) {
            if (!current())
                return;
            const message = sent
                ? `주문 저장 결과를 확인하지 못했습니다. ${error instanceof Error ? error.message : '응답을 받지 못했습니다.'} 주문 내역을 먼저 확인해 주세요. 입력은 유지했으며 자동으로 다시 보내지 않았습니다.`
                : `주문 내용을 확인해 주세요. ${error instanceof Error ? error.message : '입력 내용을 다시 확인해 주세요.'}`;
            setError(message);
            window.alert(message);
        }
        finally {
            if (run.current===execution) {
                run.current = null;
                savingRef.current = false;
                if(mounted.current&&actorCurrent())setSaving(false);
            }
        }
    };
    let checkpointText=JSON.stringify(h.payload);if(h.error&&h.owner){try{checkpointText=JSON.stringify({currentInput:h.payload,storedOriginal:localStorage.getItem(ownedCheckpointKey(h.owner,feature))});}catch{/* 현재 화면의 입력 원문은 계속 복사할 수 있다. */}}
    return { storageError:h.error,confirmedLocally:h.confirmed,flushCheckpoint,retryCheckpoint,readCheckpoint,restoreCheckpoint,checkpointText,pending,readPending,startNewOrder, step, partnerIdInput, selectedClient, cart, isSuccess, saving, error, associatedProducts, updateCart, 단가, totalAmount, handleSubmit, handleAuth, changePartnerInput, backToAuth, exit, orderAgain };
}

function isDeleted(order:Order):boolean {const value=order as unknown as Record<string,unknown>;return !!(value.deletedAt||value.deletedBy||value.isDeleted||value.deleted);}
function orderOriginal(order:Order):string{return JSON.stringify({partnerId:order.partnerId,partnerName:order.partnerName,items:Array.isArray(order.items)?order.items.map(row=>({itemId:row.itemId,name:row.name,quantity:row.quantity,price:row.price})):null,totalAmount:order.totalAmount,createdAt:order.createdAt,deliveryDate:order.deliveryDate,email:order.email,source:order.source,region:order.region});}
