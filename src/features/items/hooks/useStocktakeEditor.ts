import { useEffect, useRef, useState, type SetStateAction } from 'react';
import type { CompanyId, Item } from '../../../shared/types';
import type { ProductStocktakeAttempt } from '../../../shared/productStocktakeAttempt';
export function useStocktakeEditor(options: {
    companyId: CompanyId;
    actorKey?: string;
    getUid: () => string | undefined;
}) {
    const [, paint] = useState(0), mounted = useRef(false);
    const latest = useRef(options);
    latest.current = options;
    const make = () => ({ companyId: options.companyId, actorKey: options.actorKey, uid: options.getUid(), item: null as Item | null, form: {} as Partial<Item>, lotId: '', pending: null as ProductStocktakeAttempt | null, run: null as object | null, selection: {} });
    const owner = useRef(make());
    if (owner.current.companyId !== options.companyId || owner.current.actorKey !== options.actorKey || owner.current.uid !== options.getUid())
        owner.current = make();
    const state = owner.current;
    const operationId = useRef('');
    const owns = () => mounted.current && owner.current === state && latest.current.getUid() === state.uid;
    const notify = () => { if (mounted.current && owner.current === state)
        paint(n => n + 1); };
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; owner.current.selection = {}; }; }, []);
    const capture = () => {
        const selection = state.selection, uid = options.getUid();
        return () => owns() && state.selection === selection && latest.current.getUid() === uid;
    };
    const canEdit = () => owns() && !state.run && !state.pending;
    const setForm = (value: SetStateAction<Partial<Item>>) => { if (!canEdit())
        return; state.form = typeof value === 'function' ? value(state.form) : value; notify(); };
    const setLotId = (value: string) => { if (!canEdit())
        return; state.lotId = value; notify(); };
    const setPending = (value: ProductStocktakeAttempt | null) => { if (!owns())
        return; state.pending = value; notify(); };
    const close = () => { if (!owns())
        return; state.selection = {}; state.item = null; state.run = null; notify(); };
    const open = (item: Item, form: Partial<Item>, lotId: string, pending: ProductStocktakeAttempt | null) => {
        if (!owns())
            return;
        state.selection = {};
        state.run = null;
        state.item = item;
        state.form = form;
        state.lotId = lotId;
        state.pending = pending;
        operationId.current = `stocktake-${item.id}-${crypto.randomUUID()}`;
        notify();
    };
    const begin = () => {
        if (!owns() || !state.item || state.run)
            return null;
        const run = {};
        state.run = run;
        const selected = capture();
        notify();
        const isCurrent = () => selected() && state.run === run;
        return { isCurrent, finish: () => { if (!isCurrent())
                return; state.run = null; notify(); } };
    };
    return { item: state.item, form: state.form, lotId: state.lotId, pending: state.pending, saving: !!state.run, operationId, setForm, setLotId, setPending, open, close, capture, begin, canEdit };
}
