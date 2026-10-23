import { useEffect, useMemo, useRef, useState } from 'react';
import type { Partner, Item, PartnerItem, Order, OrderItem } from '../../../../types';
import { OrderStatus, OrderSource } from '../../../../types';
import { isLinkedToPartner, salePriceOf } from '../../../shared/partnerPrice';
interface Options {
    partners: Partner[];
    items: Item[];
    partnerItems?: PartnerItem[];
    onOrderSubmit: (order: Order) => Promise<unknown>;
    onExit: () => void;
}
export function usePartnerPortalDraft({ partners, items, partnerItems, onOrderSubmit, onExit }: Options) {
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
    const edit = (action: () => void) => { if (savingRef.current)
        return; generation.current++; setError(''); action(); };
    const changePartnerInput = (value: string) => edit(() => setPartnerIdInput(value));
    const backToAuth = () => edit(() => { setStep('auth'); });
    const exit = () => { if (!savingRef.current)
        onExit(); };
    const orderAgain = () => edit(() => { setStep('order'); setCart({}); setIsSuccess(false); });
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
        if (!selectedClient || savingRef.current)
            return;
        savingRef.current = true;
        setSaving(true);
        setError('');
        const owner = generation.current;
        const execution = {};
        run.current = execution;
        const current = () => mounted.current && generation.current === owner && run.current === execution;
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
        try {
            await onOrderSubmit(newOrder);
            if (!current())
                return;
            setIsSuccess(true);
            setStep('confirm');
        }
        catch (error) {
            if (!current())
                return;
            const message = `주문을 저장하지 못했습니다. ${error instanceof Error ? error.message : '다시 시도해 주세요.'}`;
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
    return { step, partnerIdInput, selectedClient, cart, isSuccess, saving, error, associatedProducts, updateCart, 단가, totalAmount, handleSubmit, handleAuth, changePartnerInput, backToAuth, exit, orderAgain };
}
