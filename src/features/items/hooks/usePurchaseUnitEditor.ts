import { useEffect, useRef, useState } from 'react';
import type { CompanyId, Item, ItemPurchaseUnit } from '../../../shared/types';
import { subscribeItemPurchaseUnits, saveItemPurchaseUnit } from '../../../shared/services/itemPurchaseUnitService';
export function usePurchaseUnitEditor(options: {
    companyId: CompanyId;
    item: Item;
    onClose: () => void;
}) {
    const [, paint] = useState(0), mounted = useRef(false), latest = useRef(options);
    latest.current = options;
    const make = () => ({ companyId: options.companyId, itemId: options.item.id, units: [] as ItemPurchaseUnit[], selected: null as ItemPurchaseUnit | null, partnerId: '', label: '', weight: '', isDefault: false, error: '', run: null as object | null, newId: null as string | null, newCreatedAt: null as string | null, selection: {}, generation: 0 });
    const owner = useRef(make());
    if (owner.current.companyId !== options.companyId || owner.current.itemId !== options.item.id)
        owner.current = make();
    const state = owner.current, selection = state.selection;
    const current = () => mounted.current && owner.current === state && state.selection === selection;
    const notify = () => { if (mounted.current && owner.current === state)
        paint(v => v + 1); };
    const canEdit = () => current() && !state.run;
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; owner.current.generation++; }; }, []);
    useEffect(() => { let active = true; const stop = subscribeItemPurchaseUnits(state.companyId, rows => { if (!active || !mounted.current || owner.current !== state)
        return; state.units = rows.filter(row => row.itemId === state.itemId); notify(); }, error => { if (active && mounted.current && owner.current === state) {
        state.error = error.message;
        notify();
    } }); return () => { active = false; stop(); }; }, [state]);
    const resetFields = () => { state.newId = null; state.newCreatedAt = null; state.selected = null; state.partnerId = ''; state.label = ''; state.weight = ''; state.isDefault = false; state.error = ''; state.selection = {}; };
    const reset = () => { if (!canEdit())
        return; resetFields(); notify(); };
    const choose = (unit: ItemPurchaseUnit) => { if (!canEdit())
        return; state.selected = unit; state.partnerId = unit.partnerId ?? ''; state.label = unit.purchaseUnit; state.weight = String(unit.unitKg); state.isDefault = unit.isDefault; state.error = ''; state.selection = {}; notify(); };
    const patch = (value: Partial<Pick<typeof state, 'partnerId' | 'label' | 'weight' | 'isDefault'>>) => { if (!canEdit())
        return; Object.assign(state, value); notify(); };
    const close = () => { if (canEdit())
        latest.current.onClose(); };
    const save = async (active = true) => { if (!canEdit())
        return; const now = new Date().toISOString(), id = state.selected?.id ?? (state.newId ??= crypto.randomUUID()), createdAt = state.selected?.createdAt ?? (state.newCreatedAt ??= now); const payload = { id, companyId: state.companyId, itemId: state.itemId, ...(state.partnerId ? { partnerId: state.partnerId } : {}), purchaseUnit: state.label.trim(), unitKg: Number(state.weight), isDefault: state.isDefault, active, createdAt, updatedAt: now }; const run = {}, generation = state.generation; state.run = run; state.error = ''; notify(); const own = () => current() && state.run === run && state.generation === generation; try {
        if (!own())
            return;
        await saveItemPurchaseUnit(payload);
        if (own())
            resetFields();
    }
    catch (error) {
        if (own())
            state.error = error instanceof Error ? error.message : String(error);
    }
    finally {
        if (state.run === run) {
            state.run = null;
            notify();
        }
    } };
    return { ...state, busy: !!state.run, reset, choose, patch, close, save, canEdit };
}
