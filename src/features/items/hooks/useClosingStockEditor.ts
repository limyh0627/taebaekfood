import { useEffect, useRef, useState } from 'react';
export function useClosingStockEditor(options: {
    scope: object;
    modalOpen: boolean;
    view: string;
    getUid: () => string | undefined;
}) {
    const [, paint] = useState(0), mounted = useRef(false), latest = useRef(options);
    latest.current = options;
    const make = () => ({ scope: options.scope, open: options.modalOpen, view: options.view, uid: options.getUid(), id: null as string | null, value: '', error: '', run: null as object | null, selection: {} });
    const owner = useRef(make());
    if (owner.current.scope !== options.scope || owner.current.open !== options.modalOpen || owner.current.view !== options.view || owner.current.uid !== options.getUid())
        owner.current = make();
    const state = owner.current;
    const current = () => mounted.current && !!state.uid && owner.current === state && latest.current.getUid() === state.uid && latest.current.scope === state.scope && latest.current.modalOpen === state.open && latest.current.view === state.view;
    const notify = () => { if (current())
        paint(n => n + 1); };
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; owner.current.selection = {}; }; }, []);
    const open = (id: string, value: string) => { if (!current() || state.run)
        return; state.selection = {}; state.id = id; state.value = value; state.error = ''; notify(); };
    const setValue = (value: string) => { if (!current() || state.run)
        return; state.value = value; state.error = ''; notify(); };
    const cancel = () => { if (!current() || state.run)
        return; state.selection = {}; state.id = null; state.value = ''; state.error = ''; notify(); };
    const execute = async (id: string, value: string, task: (isCurrent: () => boolean) => Promise<boolean | 'cancelled'>) => {
        if (!current() || !state.open || state.run)
            return false;
        const previous = { id: state.id, value: state.value };
        state.id = id;
        state.value = value;
        state.error = '';
        const run = {}, selection = state.selection;
        state.run = run;
        notify();
        const own = () => current() && state.run === run && state.selection === selection;
        try {
            const ok = await task(own);
            if (!own())
                return false;
            if (ok === 'cancelled') {
                state.id = previous.id;
                state.value = previous.value;
                return false;
            }
            if (ok) {
                state.id = null;
                state.value = '';
            }
            else
                state.error = '처리 결과를 확인하지 못했습니다. 입력을 유지합니다. 보관된 실사 결과를 먼저 확인한 뒤 다시 시도해 주세요.';
            return ok;
        }
        catch (error) {
            if (own())
                state.error = `처리 결과를 확인하지 못했습니다. 입력을 유지합니다. ${error instanceof Error ? error.message : '다시 확인해 주세요.'}`;
            return false;
        }
        finally {
            if (own()) {
                state.run = null;
                notify();
            }
        }
    };
    return { id: state.id, value: state.value, error: state.error, busy: !!state.run, canAct: () => current() && !state.run, open, setValue, cancel, execute };
}
