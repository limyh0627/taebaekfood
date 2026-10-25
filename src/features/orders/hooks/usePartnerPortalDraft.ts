import {appConfirm} from '../../../shared/components/appDialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Partner, Item, PartnerItem, Order, OrderItem } from '../../../../types';
import type {CompanyId} from '../../../shared/types';
import type {PendingSubmissionRead} from '../../../shared/services/pendingSubmissionRead';
import { OrderStatus, OrderSource } from '../../../../types';
import { isLinkedToPartner, salePriceOf } from '../../../shared/partnerPrice';
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
    type Pending={order:Order;signal:AbortSignal;readRun:object|null;result:PendingSubmissionRead<Order>|null;matches:boolean;notice:string};
    const recovery=useRef({actorKey,pending:null as Pending|null,closeRun:null as object|null});
    const state=recovery.current.actorKey===actorKey?recovery.current:(recovery.current={actorKey,pending:null,closeRun:null});
    const actorCurrent=()=>recovery.current===state&&latest.current.companyId+':'+latest.current.employeeId+':'+(latest.current.getUid()??'')===actorKey;
    const [step, setStep] = useState<'auth' | 'order' | 'confirm'>('auth');
    const [partnerIdInput, setPartnerIdInput] = useState('');
    const [selectedClient, setSelectedClient] = useState<Partner | null>(null);
    const [cart, setCart] = useState<{
        [itemId: string]: number;
    }>({});
    const [isSuccess, setIsSuccess] = useState(false);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const mounted = useRef(true);
    const generation = useRef(0);
    const run = useRef<object | null>(null);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; run.current = null; }; }, []);
    const [error, setError] = useState('');
    useEffect(()=>{generation.current++;run.current=null;savingRef.current=false;setSaving(false);setError('');setCart({});setSelectedClient(null);setStep('auth');setIsSuccess(false);},[actorKey]);
    useEffect(()=>{const signal=options.getSignal();const abort=()=>{if(!mounted.current||recovery.current!==state)return;state.pending=null;generation.current++;run.current=null;savingRef.current=false;setSaving(false);setCart({});setSelectedClient(null);setStep('auth');setIsSuccess(false);setError('로그인 범위가 변경되었습니다. 다시 입장해 주세요.');paint(n=>n+1);};signal.addEventListener('abort',abort);return()=>signal.removeEventListener('abort',abort);},[state,options.getSignal]);
    const pending=state.pending;
    const notify=()=>{if(actorCurrent()&&mounted.current)paint(n=>n+1);};
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
    const startNewOrder=()=>{const attempt=state.pending;if(savingRef.current||!attempt?.matches||attempt.readRun||!actorCurrent()||attempt.signal.aborted)return;state.pending=null;generation.current++;setCart({});setIsSuccess(false);setStep('order');setError('');notify();};
    const edit = (action: () => void) => {
        if (savingRef.current)
            return;
        generation.current++;
        setError('');
        action();
    };
    const changePartnerInput = (value: string) => edit(() => setPartnerIdInput(value));
    const backToAuth = () => edit(() => { setStep('auth'); });
    const exit = async () => {
        const signal=latest.current.getSignal();
        if (!mounted.current||!actorCurrent()||signal.aborted||savingRef.current||state.closeRun)return;
        const attempt=state.pending;
        if(!attempt){latest.current.onExit();return;}
        const execution={},owner=generation.current;
        state.closeRun=execution;
        const current=()=>mounted.current&&actorCurrent()&&!signal.aborted&&!attempt.signal.aborted&&state.closeRun===execution&&generation.current===owner&&state.pending===attempt&&!savingRef.current;
        try{
            const approved=await appConfirm({title:'주문 확인 화면을 나갈까요?',message:'주문 '+attempt.order.id+'의 원문은 이 화면에만 보관됩니다. 나가면 원문을 잃을 수 있으며 서버 주문은 취소되지 않습니다.',confirmText:'나가기',cancelText:'계속 확인'});
            if(approved&&current())latest.current.onExit();
        }catch{/* 확인창을 열지 못했거나 거절되면 원문을 보존한다. */}
        finally{if(state.closeRun===execution)state.closeRun=null;}
    };
    const orderAgain = () => {if(state.pending)return;edit(() => { setStep('order'); setCart({}); setIsSuccess(false); });};
    const handleAuth = (e: React.FormEvent) => {
        e.preventDefault();
        if (savingRef.current)
            return;
        generation.current++;
        const partner = partners.find(c => c.id.toLowerCase() === partnerIdInput.toLowerCase());
        if (partner) {
            setSelectedClient(partner);
            setStep('order');
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
        if (savingRef.current)
            return;
        generation.current++;
        setCart(prev => {
            const current = prev[itemId] || 0;
            const next = Math.max(0, current + delta);
            if (next === 0) {
                const { [itemId]: _unused, ...rest } = prev;
                return rest;
            }
            return { ...prev, [itemId]: next };
        });
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
        if (!selectedClient || savingRef.current || state.pending || !actorCurrent() || options.getSignal().aborted)
            return;
        savingRef.current = true;
        setSaving(true);
        setError('');
        const owner = generation.current,signal=options.getSignal();
        const execution = {};
        run.current = execution;
        const current = () => mounted.current && actorCurrent() && !signal.aborted && generation.current === owner && run.current === execution;
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
            state.pending={order:original,signal,readRun:null,result:null,matches:false,notice:''};
            sent = true;
            await onOrderSubmit(JSON.parse(JSON.stringify(original)) as Order);
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
            if (current()) {
                run.current = null;
                savingRef.current = false;
                setSaving(false);
            }
        }
    };
    return { pending,readPending,startNewOrder, step, partnerIdInput, selectedClient, cart, isSuccess, saving, error, associatedProducts, updateCart, 단가, totalAmount, handleSubmit, handleAuth, changePartnerInput, backToAuth, exit, orderAgain };
}

function isDeleted(order:Order):boolean {const value=order as unknown as Record<string,unknown>;return !!(value.deletedAt||value.deletedBy||value.isDeleted||value.deleted);}
function orderOriginal(order:Order):string{return JSON.stringify({partnerId:order.partnerId,partnerName:order.partnerName,items:Array.isArray(order.items)?order.items.map(row=>({itemId:row.itemId,name:row.name,quantity:row.quantity,price:row.price})):null,totalAmount:order.totalAmount,createdAt:order.createdAt,deliveryDate:order.deliveryDate,email:order.email,source:order.source,region:order.region});}
