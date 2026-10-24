import { useEffect, useRef, useState, type SetStateAction } from 'react';
import type { CompanyId, Item } from '../../../shared/types';
import { unitsPerBoxOf, type OrderUnitInputs } from '../../../shared/orderUnits';
export interface PurchaseCartRow {
    id: string;
    qty: number;
    isBox: boolean;
    partnerId?: string;
}
export interface PurchaseCartPayload {
    id: string;
    partnerId?: string;
    quantity: number;
    boxQuantity?: number;
}
export function usePurchaseCartDraft(options: {
    companyId: CompanyId;
    getUid: () => string | undefined;
    items: Item[];
    inputs?: OrderUnitInputs;
    save: (rows: PurchaseCartPayload[]) => void | Promise<unknown>;
    onCommitted: () => void;
}) {
    const [, paint] = useState(0), mounted = useRef(false), latest = useRef(options);
    latest.current = options;
    const make = () => ({ companyId: options.companyId, uid: options.getUid(), rows: [] as PurchaseCartRow[], panel: false, error: '', run: null as object | null });
    const owner = useRef(make());
    if (owner.current.companyId !== options.companyId || owner.current.uid !== options.getUid())
        owner.current = make();
    const state = owner.current;
    const current = () => mounted.current && owner.current === state && !!state.uid && latest.current.getUid() === state.uid;
    const notify = () => { if (current())
        paint(n => n + 1); };
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const editable = () => current() && !state.run;
    const setCart = (value: SetStateAction<PurchaseCartRow[]>) => { if (!editable())
        return; state.rows = typeof value === 'function' ? value(state.rows) : value; state.error = ''; notify(); };
    const setPanel = (value: SetStateAction<boolean>) => { if (!editable())
        return; state.panel = typeof value === 'function' ? value(state.panel) : value; notify(); };
    const submit = async () => {
        if (!editable() || !state.rows.length)
            return;
        const source = latest.current, cart = state.rows.map(row => ({ ...row })), items = source.items, orderUnitInputs = source.inputs;
        const run = {};
        state.run = run;
        state.error = '';
        notify();
        const own = () => current() && state.run === run;
        let committed = false;
        try {
            await source.save(cart.map(c => {
                const per = unitsPerBoxOf(items.find(p => p.id === c.id), orderUnitInputs);
                const box = c.isBox && per > 1;
                return { id: c.id, partnerId: c.partnerId, quantity: box ? c.qty * per : c.qty, ...(box ? { boxQuantity: c.qty } : {}) };
            }));
            if (own()) {
                state.rows = [];
                state.panel = false;
                committed = true;
            }
        }
        catch (error) {
            if (own())
                state.error = `발주 저장 결과를 확인하지 못했습니다. ${error instanceof Error ? error.message : '다시 확인해 주세요.'} 일부 발주가 이미 생성되었을 수 있습니다. 발주 내역을 먼저 확인해 주세요. 입력은 유지했으며 자동으로 다시 보내지 않았습니다.`;
        }
        finally {
            if (own()) {
                state.run = null;
                notify();
            }
        }
        if (committed && current())
            latest.current.onCommitted();
    };
    return { cart: state.rows, panel: state.panel, busy: !!state.run, error: state.error, setCart, setPanel, submit, canEdit: editable };
}
