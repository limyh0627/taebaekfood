import { useEffect, useReducer, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../../shared/firebase';
import { today } from '../../../shared/day';
import type { CompanyId, PalletStock, Partner } from '../../../shared/types';
import { normalizePalletTransactionRequest, type PalletTransactionReference, type PalletTransactionRequest, type PalletTransactionResult } from '../../../shared/palletTransactionCommand';
import palletTransactionWrites, { type PalletTransactionObservation } from '../../../shared/services/palletTransactionWrites';

type Entry = Awaited<ReturnType<typeof palletTransactionWrites.read>>[number];
type Mode = 'in' | 'out' | 'exchange';
interface Draft { partnerId: string; palletId: string; quantity: string; returnQty: string; newQty: string; note: string; isTransfer: boolean }
interface Execution { key: string | null; accepted: Set<string>; other: boolean; initial: boolean }
interface Prepared { entry: Entry; form: object; requestHash: string | null; referenceKey: string | null; bodyRaw: string | null; referenceRaw: string | null }
interface Owner {
    companyId: CompanyId; actorUid: string; form: object; execution: Execution | null; open: boolean; mode: Mode; draft: Draft;
    reference: PalletTransactionReference | null; date: string; originalTotal: number | null;
    prepared: Prepared | null; locked: boolean; inlineError: string; inlineMessage: string;
    entries: Entry[]; results: Map<string, PalletTransactionResult>; readSeq: number; readLoading: boolean; readError: string; recoveryError: string; recoveryOpen: boolean;
}
const emptyDraft = (): Draft => ({ partnerId: '', palletId: '', quantity: '', returnQty: '0', newQty: '0', note: '', isTransfer: false });
const createOwner = (companyId: CompanyId, actorUid: string): Owner => ({ companyId, actorUid, form: {}, execution: null, open: false, mode: 'in', draft: emptyDraft(), reference: null, date: '', originalTotal: null, prepared: null, locked: false, inlineError: '', inlineMessage: '', entries: [], results: new Map(), readSeq: 0, readLoading: false, readError: '', recoveryError: '', recoveryOpen: false });
const pair = (entry: Entry | null, key = '') => JSON.stringify([entry?.key ?? key, entry?.bodyRaw ?? null, entry?.referenceRaw ?? null]);
const resultKey = (reference: PalletTransactionReference) => JSON.stringify(reference);
const preparedOf = (entry: Entry, form: object): Prepared => ({ entry, form, requestHash: entry.requestHash, referenceKey: entry.reference ? resultKey(entry.reference) : null, bodyRaw: entry.bodyRaw, referenceRaw: entry.referenceRaw });
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function usePalletTransactionEditor({ companyId, pallets, partners = [] }: { companyId: CompanyId; pallets: readonly PalletStock[]; partners?: readonly Partner[] }) {
    const [, repaint] = useReducer(value => value + 1, 0);
    const latest = useRef({ companyId, pallets, partners }); latest.current = { companyId, pallets, partners };
    const owner = useRef(createOwner(companyId, auth.currentUser?.uid ?? ''));
    const uid = auth.currentUser?.uid ?? '';
    if (owner.current.companyId !== companyId || owner.current.actorUid !== uid) owner.current = createOwner(companyId, uid);
    const captured = owner.current;
    const mount = useRef<object | null>({});
    const currentOwner = (value: Owner, token: object | null) => token !== null && mount.current === token && owner.current === value && auth.currentUser?.uid === value.actorUid;
    const mounted = mount.current;
    const current = () => currentOwner(captured, mounted);
    const scope = { companyId: captured.companyId, actorUid: captured.actorUid };
    const observe = (value: Owner, entries: Entry[]) => {
        const execution = value.execution;
        if (execution?.key) {
            const matching = entries.find(entry => entry.key === execution.key) ?? null;
            if (!execution.accepted.has(pair(matching, execution.key))) execution.other = true;
        }
    };
    const readFor = async (value: Owner, token: object | null) => {
        if (!value.actorUid || !currentOwner(value, token)) return;
        const seq = ++value.readSeq; value.readLoading = true; repaint();
        try {
            const entries = await palletTransactionWrites.read({ companyId: value.companyId, actorUid: value.actorUid }, () => currentOwner(value, token));
            if (!currentOwner(value, token) || value.readSeq !== seq) return;
            observe(value, entries); value.entries = entries; value.readError = '';
        } catch (error) { if (currentOwner(value, token) && value.readSeq === seq) value.readError = errorText(error); }
        finally { if (currentOwner(value, token) && value.readSeq === seq) { value.readLoading = false; repaint(); } }
    };
    useEffect(() => {
        const token = {}; mount.current = token; repaint(); void readFor(captured, token);
        const changed = () => { void readFor(captured, token); };
        window.addEventListener('pallet-transaction-pending', changed); window.addEventListener('storage', changed);
        return () => { if (mount.current === token) mount.current = null; window.removeEventListener('pallet-transaction-pending', changed); window.removeEventListener('storage', changed); };
    }, [captured]);
    useEffect(() => onAuthStateChanged(auth, user => {
        const actorUid = user?.uid ?? '';
        if (owner.current.actorUid !== actorUid) { owner.current = createOwner(latest.current.companyId, actorUid); repaint(); }
    }), []);
    const refresh = () => readFor(captured, mounted);
    const newReference = () => ({ companyId: captured.companyId, operationId: `pallet-op-${crypto.randomUUID()}`, transactionId: `ptrans-${crypto.randomUUID()}` });
    const open = (mode: Mode, partnerId = '') => {
        if (!current() || captured.execution) return;
        captured.form = {}; captured.open = true; captured.mode = mode; captured.draft = { ...emptyDraft(), partnerId }; captured.reference = newReference(); captured.date = today(); captured.originalTotal = null; captured.prepared = null; captured.locked = false; captured.inlineError = ''; captured.inlineMessage = ''; repaint();
    };
    const close = () => { if (!current() || captured.execution) return; captured.open = false; captured.form = {}; repaint(); };
    const change = <Key extends keyof Draft>(field: Key, value: Draft[Key]) => {
        if (!current() || captured.execution || captured.locked) return;
        if (captured.draft[field] === value) return;
        captured.draft = { ...captured.draft, [field]: value }; captured.form = {}; captured.inlineError = '';
        if (field === 'palletId') {
            const selected = latest.current.pallets.find(row => row.id === value);
            captured.originalTotal = typeof selected?.total === 'number' && Number.isFinite(selected.total) ? selected.total : null;
        }
        repaint();
    };
    const begin = (entry?: Entry) => {
        if (!current() || captured.execution || !captured.actorUid) return null;
        const execution: Execution = { key: entry?.key ?? null, accepted: new Set(entry ? [pair(entry)] : []), other: false, initial: !entry };
        captured.execution = execution; captured.recoveryError = ''; repaint(); return execution;
    };
    const ownObserver = (execution: Execution) => (entry: Entry | null) => {
        if (!current() || captured.execution !== execution) return;
        if (entry) execution.key = entry.key;
        execution.accepted.add(pair(entry, execution.key ?? ''));
        if (!execution.other && entry) {
            captured.entries = [...captured.entries.filter(row => row.key !== entry.key), entry];
            const prepared = captured.prepared;
            if (prepared && prepared.entry.key === entry.key && prepared.bodyRaw === entry.bodyRaw && prepared.requestHash === entry.requestHash && prepared.referenceKey === (entry.reference ? resultKey(entry.reference) : null))
                captured.prepared = { ...prepared, entry, referenceRaw: entry.referenceRaw };
        }
    };
    const consume = (_entry: Entry, result: PalletTransactionResult | undefined) => { if (result) captured.results.set(resultKey(result.reference), result); };
    const changedNotice = (showInline: boolean) => { captured.recoveryError = '보관된 파렛트 요청이 바뀌었습니다. 보관 요청을 다시 읽고 확인해 주세요.'; if (showInline) captured.inlineMessage = '보관 요청을 다시 읽고 처리 결과를 확인해 주세요.'; };
    const submit = async () => {
        if (!current() || captured.execution || captured.locked || !captured.open) return;
        const draft = { ...captured.draft }, form = captured.form, reference = captured.reference;
        if (!draft.partnerId) { captured.inlineError = '거래처를 선택해주세요.'; repaint(); return; }
        if (!draft.palletId) { captured.inlineError = '파렛트 종류를 선택해주세요.'; repaint(); return; }
        const quantity = parseInt(captured.mode === 'exchange' ? draft.newQty : draft.quantity) || 0;
        if (quantity <= 0) { captured.inlineError = captured.mode === 'exchange' ? '교체 지급(신규) 수량을 입력해주세요.' : '수량을 입력해주세요.'; repaint(); return; }
        const execution = begin(); if (!execution || !reference) return;
        const executing = () => current() && captured.execution === execution && captured.form === form;
        captured.inlineError = ''; captured.inlineMessage = '';
        let entry: Entry | null = null;
        try {
            const exchange = captured.mode === 'exchange';
            const transaction = { partnerId: draft.partnerId, palletId: draft.palletId, type: exchange ? 'out' as const : captured.mode as 'in' | 'out', quantity, date: captured.date,
                note: exchange ? `교체 지급${draft.note ? ' — ' + draft.note : ''}` : draft.note,
                ...(exchange ? { status: '교체중' as const, exchangeReturnQty: parseInt(draft.returnQty) || 0 } : draft.isTransfer ? { isTransfer: true } : {}) };
            const existing = palletTransactionWrites.findMatching(await palletTransactionWrites.read(scope, executing), transaction);
            if (!executing()) return;
            if (existing) {
                captured.prepared = preparedOf(existing, form); captured.locked = true; captured.recoveryOpen = true;
                captured.inlineMessage = '같은 내용의 보관 요청이 있습니다. 기존 요청의 처리 결과를 확인해 주세요.';
                return;
            }
            let transfer: PalletTransactionRequest['transfer'];
            if (draft.isTransfer && !exchange) {
                if (captured.originalTotal === null) throw Error('선택한 파렛트의 보유량을 확인하고 다시 선택해 주세요.');
                const opening = await palletTransactionWrites.open(scope, reference, draft.palletId, captured.originalTotal, executing);
                if (!executing()) return;
                transfer = { originalTotal: opening.originalTotal, expectedVersion: opening.expectedVersion };
            }
            const request = normalizePalletTransactionRequest({ version: 1, reference, transaction, ...(transfer ? { transfer } : {}) });
            entry = await palletTransactionWrites.prepare(scope, request, executing, ownObserver(execution));
            if (!executing()) return;
            execution.key = entry.key; execution.accepted.add(pair(entry)); captured.prepared = preparedOf(entry, form); captured.locked = true;
            const observation = await palletTransactionWrites.command(scope, entry, 'apply', executing, undefined, ownObserver(execution));
            if (!executing()) return;
            if (execution.other || observation.copyMismatch) { changedNotice(true); return; }
            consume(entry, observation.result);
            if (observation.result?.status === 'applied' && observation.terminal) { captured.open = false; captured.form = {}; captured.locked = false; }
        } catch (error) {
            if (!executing()) return;
            if (!entry) {
                await refresh();
                if (!executing()) return;
                entry = captured.entries.find(row => row.references.some(item => resultKey(item.reference) === resultKey(reference))) ?? null;
                if (entry) captured.prepared = preparedOf(entry, form);
            }
            if (entry) { captured.locked = true; captured.recoveryError = errorText(error); captured.inlineMessage = '처리 결과를 확인해야 합니다. 처리 확인에서 보관 요청을 확인해 주세요.'; }
            else captured.inlineError = errorText(error);
        } finally {
            if (current() && captured.execution === execution) { captured.execution = null; await refresh(); if (current()) repaint(); }
        }
    };
    const recover = async (entry: Entry, action: 'inspect' | 'apply' | 'cancel' | 'discard' | 'upgrade', reference?: PalletTransactionReference) => {
        const execution = begin(entry); if (!execution) return;
        const form = captured.form, prepared = captured.prepared;
        const executing = () => current() && captured.execution === execution;
        try {
            const observation: PalletTransactionObservation = action === 'discard' ? await palletTransactionWrites.discard(scope, entry, executing, ownObserver(execution)) : action === 'upgrade' ? { entry: await palletTransactionWrites.upgrade(scope, entry, executing, ownObserver(execution)), terminal: false } : await palletTransactionWrites.command(scope, entry, action, executing, reference, ownObserver(execution));
            if (!executing()) return;
            if (execution.other || observation.copyMismatch) { changedNotice(prepared?.entry.key === entry.key && prepared.form === form && captured.form === form); return; }
            consume(entry, observation.result);
            if (action === 'inspect' && observation.result?.status === 'applied' && prepared && captured.prepared === prepared
                && captured.form === form && prepared.form === form && prepared.entry.key === entry.key && entry.status === 'valid'
                && prepared.requestHash !== null && entry.requestHash === prepared.requestHash && observation.result.requestHash === prepared.requestHash
                && prepared.referenceKey === resultKey(observation.result.reference) && prepared.referenceKey === (entry.reference ? resultKey(entry.reference) : null)
                && prepared.bodyRaw === entry.bodyRaw && prepared.referenceRaw === entry.referenceRaw
                && observation.entry && pair(observation.entry) === pair(entry)) {
                const after = await palletTransactionWrites.read(scope, executing);
                if (!executing()) return;
                observe(captured, after);
                const same = after.find(row => row.key === entry.key);
                if (execution.other || !same || pair(same) !== pair(entry)) { changedNotice(true); return; }
                if (captured.prepared === prepared && captured.form === form) { captured.open = false; captured.form = {}; captured.locked = false; captured.inlineMessage = ''; }
            }
            if (prepared?.entry.key === entry.key && prepared.form === form && captured.form === form) {
                if (action === 'apply' && observation.result?.status === 'applied' && observation.terminal) { captured.open = false; captured.form = {}; captured.locked = false; }
                if (action === 'discard') { captured.prepared = null; captured.locked = false; captured.reference = newReference(); captured.inlineMessage = ''; }
            }
        } catch (error) { if (executing()) captured.recoveryError = errorText(error); }
        finally { if (executing()) { captured.execution = null; await refresh(); repaint(); } }
    };
    const rows = captured.entries.map(entry => {
        const transaction = entry.transaction;
        const summary = transaction ? { date: transaction.date,
            kind: transaction.status === '교체중' ? '교체 지급' : transaction.isTransfer ? transaction.type === 'in' ? '이동 입고' : '이동 지급' : transaction.type === 'in' ? '입고' : '지급',
            quantity: transaction.quantity, returnQty: transaction.exchangeReturnQty, note: transaction.note ?? '',
            partnerName: latest.current.partners.find(row => row.id === transaction.partnerId)?.name ?? '거래처 정보 없음',
            palletName: latest.current.pallets.find(row => row.id === transaction.palletId)?.name ?? '파렛트 정보 없음' } : null;
        return { entry, summary, ...palletTransactionWrites.projection(entry, [...captured.results.values()]) };
    });
    const failureRows = rows.filter(row => row.isUnresolved && !(captured.execution?.initial && captured.execution.key === row.entry.key));
    return { scopeKey: `${captured.companyId}:${captured.actorUid}`, isCurrent: current, draft: captured.draft, mode: captured.mode, showForm: captured.open && current(), busy: !!captured.execution, locked: captured.locked,
        open, close, change, submit, inlineError: current() ? captured.inlineError : '', inlineMessage: current() ? captured.inlineMessage : '',
        recoveryOpen: current() && captured.recoveryOpen, openRecovery: () => { if (current()) { captured.recoveryOpen = true; repaint(); } }, closeRecovery: () => { if (current() && !captured.execution) { captured.recoveryOpen = false; repaint(); } },
        recoveryRows: current() ? rows : [], failureRows: current() ? failureRows : [], failureCount: current() ? failureRows.length : 0, readLoading: captured.readLoading, readError: current() ? captured.readError : '', recoveryError: current() ? captured.recoveryError : '', refresh,
        inspect: (entry: Entry, reference?: PalletTransactionReference) => recover(entry, 'inspect', reference), retry: (entry: Entry) => recover(entry, 'apply'), cancel: (entry: Entry, reference?: PalletTransactionReference) => recover(entry, 'cancel', reference), discard: (entry: Entry) => recover(entry, 'discard'), upgrade: (entry: Entry) => recover(entry, 'upgrade'),
    };
}
