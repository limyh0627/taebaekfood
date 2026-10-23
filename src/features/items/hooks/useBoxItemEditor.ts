import { useEffect, useRef, useState, type SetStateAction } from 'react';
import type { CompanyId, Item } from '../../../shared/types';
export interface BoxForm {
    name: string;
    count: string;
    comps: {
        id: string;
        qty: string;
    }[];
}
export type BoxPayload = {
    name: string;
    count: number;
    components: {
        id: string;
        qty: number;
    }[];
};
export function useBoxItemEditor(options: {
    companyId: CompanyId;
    requestScopeKey?: string;
    items: Item[];
    save?: (unit: Item, options: BoxPayload) => Promise<void>;
}) {
    const [, paint] = useState(0), mounted = useRef(false), latest = useRef(options);
    latest.current = options;
    const make = () => ({ companyId: options.companyId, scope: options.requestScopeKey ?? '', unit: null as Item | null, form: { name: '', count: '10', comps: [] } as BoxForm, error: '', run: null as object | null, selection: {}, generation: 0 });
    const owner = useRef(make());
    if (owner.current.companyId !== options.companyId || owner.current.scope !== (options.requestScopeKey ?? ''))
        owner.current = make();
    const state = owner.current, selection = state.selection;
    const current = () => mounted.current && owner.current === state && state.selection === selection;
    const notify = () => { if (mounted.current && owner.current === state)
        paint(v => v + 1); };
    const canEdit = () => current() && !state.run;
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; owner.current.generation++; }; }, []);
    const setForm = (value: SetStateAction<BoxForm>) => { if (!canEdit())
        return; state.form = typeof value === 'function' ? value(state.form) : value; notify(); };
    const open = (unit: Item) => { if (!canEdit())
        return; state.unit = unit; state.form = { name: `${unit.name} (10개입)`, count: '10', comps: [] }; state.error = ''; state.selection = {}; notify(); };
    const close = () => { if (!canEdit())
        return; state.unit = null; state.selection = {}; state.error = ''; notify(); };
    const setCount = (value: string) => setForm(form => { const auto = state.unit ? `${state.unit.name} (${form.count}개입)` : ''; return { ...form, count: value, name: form.name !== auto ? form.name : `${state.unit?.name ?? ''} (${value}개입)` }; });
    const save = async () => { const write = latest.current.save; if (!canEdit() || !state.unit || !write)
        return; const count = parseFloat(state.form.count) || 0; if (count <= 0) {
        state.error = '개입수를 입력하세요.';
        notify();
        return;
    } const unit = state.unit, name = state.form.name.trim() || `${unit.name} (${count}개입)`; if (latest.current.items.some(item => !item.archived && item.name === name)) {
        state.error = '같은 이름의 품목이 이미 있습니다.';
        notify();
        return;
    } const payload = { name, count, components: state.form.comps.filter(c => c.id).map(c => ({ id: c.id, qty: parseFloat(c.qty) || 0 })) }; const run = {}, generation = state.generation; state.run = run; state.error = ''; notify(); const own = () => current() && state.run === run && state.generation === generation; try {
        if (!own())
            return;
        await write(unit, payload);
        if (own()) {
            state.unit = null;
            state.selection = {};
        }
    }
    catch (error) {
        if (own())
            state.error = error instanceof Error ? error.message : '박스 품목 처리 결과를 확인하지 못했습니다. 입력을 유지합니다.';
    }
    finally {
        if (state.run === run) {
            state.run = null;
            notify();
        }
    } };
    return { unit: state.unit, form: state.form, error: state.error, busy: !!state.run, open, close, setForm, setCount, save, canEdit };
}
