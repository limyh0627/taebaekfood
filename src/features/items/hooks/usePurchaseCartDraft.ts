import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { auth } from '../../../shared/firebase';
import { purchaseBatchWrites, PURCHASE_BATCH_EVENT, type PurchaseBatchEntry } from '../../../shared/services/purchaseBatchWrites';
import type { PreparePurchaseOrderBatch, PurchaseOrderBatchResult } from '../../../shared/services/purchaseOrderBatchService';
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
    prepareBatch?: PreparePurchaseOrderBatch;
}) {
    const [, paint] = useState(0), mounted = useRef(false), latest = useRef(options);
    latest.current = options;
    const make = () => ({ companyId: options.companyId, uid: options.getUid(), rows: [] as PurchaseCartRow[], panel: false, error: '',
        run: null as object | null, revision: 0, attempt: null as PurchaseBatchEntry | null,
        result: null as PurchaseOrderBatchResult | null, recoveryOpen: false, recoveryError: '', loading: false, readGeneration: 0,
        submitted: null as {
            revision: number;
            reference: string;
        } | null });
    const owner = useRef(make());
    if (owner.current.companyId !== options.companyId || owner.current.uid !== options.getUid())
        owner.current = make();
    const state = owner.current;
    const current = () => mounted.current && owner.current === state && !!state.uid && latest.current.getUid() === state.uid;
    const notify = () => {
        if (current())
            paint(n => n + 1);
    };
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const editable = () => current() && !state.run;
    const scope = () => ({ companyId: state.companyId, actorUid: state.uid ?? '', isCurrent: current });
    const setCart = (value: SetStateAction<PurchaseCartRow[]>) => {
        if (!editable())
            return;
        state.rows = typeof value === 'function' ? value(state.rows) : value;
        state.revision++;
        state.error = '';
        notify();
    };
    const setPanel = (value: SetStateAction<boolean>) => {
        if (!editable())
            return;
        state.panel = typeof value === 'function' ? value(state.panel) : value;
        notify();
    };
    const readRecovery = async () => {
        if (!current() || !latest.current.prepareBatch || state.run)
            return;
        const generation = ++state.readGeneration;
        state.loading = true;
        notify();
        try {
            const entry = await purchaseBatchWrites.read(scope());
            if (current() && generation === state.readGeneration && !state.run) {
                state.attempt = entry;
                state.result = null;
                state.recoveryError = '';
            }
        }
        catch (error) {
            if (current() && generation === state.readGeneration)
                state.recoveryError = error instanceof Error ? error.message : '보관된 요청을 읽지 못했습니다.';
        }
        finally {
            if (current() && generation === state.readGeneration) {
                state.loading = false;
                notify();
            }
        }
    };
    useEffect(() => {
        void readRecovery();
        const update = () => { void readRecovery(); };
        window.addEventListener(PURCHASE_BATCH_EVENT, update);
        window.addEventListener('storage', update);
        const stop = auth.onAuthStateChanged?.(() => {
            if (mounted.current && owner.current === state && latest.current.getUid() !== state.uid) {
                owner.current = make();
                paint(n => n + 1);
            }
        });
        return () => { stop?.(); window.removeEventListener(PURCHASE_BATCH_EVENT, update); window.removeEventListener('storage', update); };
    }, [state]);
    const recover = async (mode: 'apply' | 'inspect' | 'cancel' | 'discard') => {
        if (!editable() || !state.attempt)
            return;
        const captured = state.attempt, run = {};
        state.run = run;
        ++state.readGeneration;
        state.loading = false;
        state.recoveryError = '';
        notify();
        const own = () => current() && state.run === run;
        const executionScope = { ...scope(), isCurrent: own };
        let committed = false;
        const onOwn = (next: PurchaseBatchEntry | null, previous: PurchaseBatchEntry) => {
            if (own() && state.attempt?.bodyRaw === previous.bodyRaw && state.attempt?.referenceRaw === previous.referenceRaw)
                state.attempt = next;
        };
        try {
            if (mode === 'discard') {
                await purchaseBatchWrites.discard(executionScope, captured, onOwn);
                if (own()) {
                    state.attempt = null;
                    state.result = null;
                    state.error = '';
                    state.recoveryError = '보관된 사본만 정리했습니다. 현재 입력으로 새 발주를 작성할 수 있습니다.';
                }
            }
            else {
                const observed = await purchaseBatchWrites.command(executionScope, captured, mode, onOwn);
                if (own()) {
                    state.attempt = observed.entry;
                    state.result = observed.result ?? null;
                    if (observed.result?.status === 'applied' || observed.result?.status === 'cancelled')
                        state.error = '';
                    if (observed.result?.status === 'applied' && state.submitted?.revision === state.revision
                        && state.submitted.reference === JSON.stringify(observed.result.reference)) {
                        state.rows = [];
                        state.panel = false;
                        state.submitted = null;
                        state.error = '';
                        committed = true;
                    }
                }
            }
        }
        catch (error) {
            if (own())
                state.recoveryError = error instanceof Error ? error.message : '처리 결과를 확인하지 못했습니다.';
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
    const submit = async () => {
        if (!editable() || !state.rows.length)
            return;
        if (latest.current.prepareBatch && (state.attempt || state.loading)) {
            state.recoveryOpen = true;
            notify();
            return;
        }
        const source = latest.current, cart = state.rows.map(row => ({ ...row })), items = source.items, orderUnitInputs = source.inputs;
        const run = {};
        state.run = run;
        ++state.readGeneration;
        state.error = '';
        state.recoveryError = '';
        notify();
        const own = () => current() && state.run === run;
        const executionScope = { ...scope(), isCurrent: own };
        const revision = state.revision;
        let committed = false;
        try {
            const payload = cart.map(c => {
                const per = unitsPerBoxOf(items.find(p => p.id === c.id), orderUnitInputs);
                const box = c.isBox && per > 1;
                return { id: c.id, partnerId: c.partnerId, quantity: box ? c.qty * per : c.qty, ...(box ? { boxQuantity: c.qty } : {}) };
            });
            if (source.prepareBatch) {
                const existing = await purchaseBatchWrites.read(executionScope);
                if (!own())
                    return;
                if (existing) {
                    state.attempt = existing;
                    state.recoveryOpen = true;
                    return;
                }
                const request = await source.prepareBatch(payload);
                if (!own())
                    return;
                const retained = await purchaseBatchWrites.prepare(executionScope, request);
                if (!own())
                    return;
                state.attempt = retained;
                state.submitted = { revision, reference: JSON.stringify(retained.reference) };
                const observed = await purchaseBatchWrites.command(executionScope, retained, 'apply', (next, previous) => {
                    if (own() && state.attempt?.bodyRaw === previous.bodyRaw && state.attempt?.referenceRaw === previous.referenceRaw)
                        state.attempt = next;
                });
                if (!own())
                    return;
                state.attempt = observed.entry;
                state.result = observed.result ?? null;
                if (observed.result?.status !== 'applied') {
                    state.recoveryOpen = true;
                    return;
                }
            }
            else
                await source.save(payload);
            if (own() && state.revision === revision) {
                state.rows = [];
                state.panel = false;
                state.submitted = null;
                committed = true;
            }
        }
        catch (error) {
            if (own() && source.prepareBatch) {
                state.recoveryOpen = true;
                state.error = error instanceof Error ? error.message : '발주 저장 응답을 확인하지 못했습니다. 처리 결과를 먼저 확인해 주세요.';
                try {
                    const observed = await purchaseBatchWrites.read(executionScope);
                    if (own())
                        state.attempt = observed;
                }
                catch (readError) {
                    if (own())
                        state.recoveryError = readError instanceof Error ? readError.message : '보관 요청을 읽지 못했습니다. 다시 읽어 주세요.';
                }
            }
            else if (own())
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
    return {
        attempt: state.attempt, recoveryResult: state.result, recoveryError: state.recoveryError,
        recoveryOpen: state.recoveryOpen, loading: state.loading, readRecovery, recover,
        openRecovery: () => {
            if (current()) {
                state.recoveryOpen = true;
                notify();
            }
        },
        closeRecovery: () => {
            if (editable()) {
                state.recoveryOpen = false;
                notify();
            }
        },
        cart: state.rows, panel: state.panel, busy: !!state.run, error: state.error, setCart, setPanel, submit, canEdit: editable,
    };
}
