import { useEffect, useReducer, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../../shared/firebase';
import type { CompanyId, PalletStock } from '../../../shared/types';
import { normalizePalletStockEditFields, normalizePalletStockEditRequest, type PalletStockEditFields, type PalletEditReference } from '../../../shared/palletTransactionCommand';
import writes, { type PalletTransactionEntry as Entry, type PalletTransactionObservation as Observation } from '../../../shared/services/palletTransactionWrites';
export type PalletStockRecoveryAction = 'observed' | 'inspect' | 'apply' | 'cancel' | 'discard' | 'upgrade';
type Prepared = {
    disconnected: boolean;
    entry: Entry;
    bodyRaw: string | null;
    referenceRaw: string | null;
    requestHash: string | null;
    reference: string;
    form: object;
};
type Owner = {
    companyId: CompanyId;
    uid: string;
    form: object;
    execution: object | null;
    inFlightEntryKey: string | null;
    editingId: string | null;
    original: PalletStockEditFields | null;
    draft: PalletStockEditFields;
    reference: PalletEditReference | null;
    prepared: Prepared | null;
    locked: boolean;
    error: string;
    message: string;
};
const blank = (): PalletStockEditFields => ({ name: '', total: 0, damaged: 0 });
const makeOwner = (companyId: CompanyId, uid: string): Owner => ({ companyId, uid, form: {}, execution: null, inFlightEntryKey: null, editingId: null, original: null, draft: blank(), reference: null, prepared: null, locked: false, error: '', message: '' });
const text = (error: unknown) => error instanceof Error ? error.message : String(error);
const pairMatches = (prepared: Prepared, entry: Entry) => prepared.entry.key === entry.key && prepared.bodyRaw === entry.bodyRaw && prepared.referenceRaw === entry.referenceRaw;
export function usePalletStockEditor({ companyId, onRecoveryRequired, onOperationObserved }: {
    companyId: CompanyId;
    onRecoveryRequired?: () => void | Promise<void>;
    onOperationObserved?: (entry: Entry, observation: Observation) => void | Promise<void>;
}) {
    const [, repaint] = useReducer(value => value + 1, 0);
    const latest = useRef({ companyId, onRecoveryRequired, onOperationObserved });
    latest.current = { companyId, onRecoveryRequired, onOperationObserved };
    const owner = useRef(makeOwner(companyId, auth.currentUser?.uid ?? ''));
    if (owner.current.companyId !== companyId || owner.current.uid !== (auth.currentUser?.uid ?? ''))
        owner.current = makeOwner(companyId, auth.currentUser?.uid ?? '');
    const captured = owner.current;
    const mount = useRef<object | null>({});
    const mounted = mount.current;
    const current = () => mounted !== null && mount.current === mounted && owner.current === captured && auth.currentUser?.uid === captured.uid;
    useEffect(() => {
        const token = {};
        mount.current = token;
        repaint();
        return () => {
            if (mount.current === token)
                mount.current = null;
        };
    }, [captured]);
    useEffect(() => onAuthStateChanged(auth, user => {
        const uid = user?.uid ?? '';
        if (owner.current.uid !== uid) {
            owner.current = makeOwner(latest.current.companyId, uid);
            repaint();
        }
    }), []);
    const scope = { companyId: captured.companyId, actorUid: captured.uid };
    const dirty: Partial<PalletStockEditFields> = {};
    if (captured.original)
        for (const field of ['name', 'total', 'damaged'] as const)
            if (captured.original[field] !== captured.draft[field])
                Object.assign(dirty, { [field]: captured.draft[field] });
    const begin = (row: PalletStock) => {
        if (!current() || captured.execution)
            return;
        let original: PalletStockEditFields;
        try {
            original = normalizePalletStockEditFields(row);
        }
        catch (error) {
            captured.error = '선택한 파렛트 정보를 확인해 주세요. ' + text(error);
            repaint();
            return;
        }
        captured.form = {};
        captured.editingId = row.id;
        captured.original = original;
        captured.draft = { ...original };
        captured.reference = { kind: 'pallet-edit', companyId: captured.companyId, operationId: `pallet-edit-${crypto.randomUUID()}`, palletId: row.id };
        captured.prepared = null;
        captured.locked = false;
        captured.error = '';
        captured.message = '';
        repaint();
    };
    const change = <Key extends keyof PalletStockEditFields>(field: Key, value: PalletStockEditFields[Key]) => {
        if (!current() || captured.execution || captured.locked || !captured.editingId || captured.draft[field] === value)
            return;
        captured.draft = { ...captured.draft, [field]: value };
        captured.form = {};
        captured.error = '';
        repaint();
    };
    const close = () => {
        if (!current() || captured.execution)
            return;
        captured.editingId = null;
        captured.form = {};
        captured.error = '';
        repaint();
    };
    const prepareEntry = (entry: Entry, form: object): Prepared => ({ disconnected: false, entry, form, bodyRaw: entry.bodyRaw, referenceRaw: entry.referenceRaw, requestHash: entry.requestHash, reference: JSON.stringify(entry.reference) });
    const acceptRecovery = async (entry: Entry, observation: Observation, action: PalletStockRecoveryAction) => {
        const prepared = captured.prepared, form = captured.form;
        if (!current() || !prepared || prepared.form !== form)
            return;
        if (prepared.disconnected || !pairMatches(prepared, entry)) {
            if (prepared.entry.key === entry.key) {
                captured.prepared = { ...prepared, disconnected: true };
                if (action !== 'observed') {
                    captured.error = '보관 요청과 현재 편집 연결을 확인할 수 없습니다. 편집을 닫고 현재 자료를 다시 선택해 주세요.';
                    repaint();
                }
            }
            return;
        }
        if (action === 'observed') {
            const next = observation.entry;
            if (next && next.key === entry.key && next.bodyRaw === prepared.bodyRaw && next.requestHash === prepared.requestHash && JSON.stringify(next.reference) === prepared.reference)
                captured.prepared = { ...prepared, entry: next, referenceRaw: next.referenceRaw };
            return;
        }
        if (observation.copyMismatch) {
            captured.error = '보관된 편집 요청이 바뀌었습니다. 처리 확인에서 다시 읽어 주세요.';
            repaint();
            return;
        }
        if (action === 'discard' && observation.terminal) {
            captured.editingId = null;
            captured.form = {};
            captured.prepared = null;
            captured.locked = false;
            captured.error = '';
            captured.message = '목록에서 파렛트를 다시 선택해 현재 값을 확인한 뒤 수정해 주세요.';
            repaint();
            return;
        }
        if ((action !== 'inspect' && action !== 'apply') || !observation.terminal || observation.result?.status !== 'applied'
            || entry.status !== 'valid' || entry.request?.version !== 3 || !prepared.requestHash || observation.result.requestHash !== prepared.requestHash
            || JSON.stringify(observation.result.reference) !== prepared.reference || !observation.entry || !pairMatches(prepared, observation.entry))
            return;
        const after = await writes.read(scope, current);
        if (!current() || captured.prepared !== prepared || captured.form !== form)
            return;
        const same = after.find(row => row.key === entry.key);
        if (!same || !pairMatches(prepared, same)) {
            captured.prepared = { ...prepared, disconnected: true };
            captured.error = '보관된 편집 요청이 바뀌었습니다. 처리 확인에서 다시 읽어 주세요.';
            repaint();
            return;
        }
        captured.editingId = null;
        captured.form = {};
        captured.locked = false;
        captured.error = '';
        captured.message = '';
        repaint();
    };
    const save = async () => {
        if (!current() || captured.execution || captured.locked || !captured.editingId || !captured.original || !captured.reference || !captured.uid)
            return;
        if (Object.keys(dirty).length === 0) {
            close();
            captured.message = '변경한 내용이 없습니다.';
            repaint();
            return;
        }
        const execution = {}, form = captured.form, reference = { ...captured.reference }, original = { ...captured.original }, patch = { ...dirty };
        captured.execution = execution;
        captured.error = '';
        repaint();
        const executing = () => current() && captured.execution === execution && captured.form === form;
        let entry: Entry | null = null;
        const own = (next: Entry | null, previous?: Entry) => {
            if (!executing() || !next)
                return;
            const prepared = captured.prepared;
            if (!prepared && !previous) {
                captured.inFlightEntryKey = next.key;
                repaint();
            }
            if (prepared && previous && pairMatches(prepared, previous) && next.key === prepared.entry.key && next.bodyRaw === prepared.bodyRaw && next.requestHash === prepared.requestHash && JSON.stringify(next.reference) === prepared.reference)
                captured.prepared = { ...prepared, entry: next, referenceRaw: next.referenceRaw };
        };
        try {
            const entries = await writes.read(scope, executing);
            if (!executing())
                return;
            const existing = writes.findMatchingEdit(entries, { palletId: reference.palletId, patch });
            if (existing) {
                captured.locked = true;
                captured.error = '같은 내용의 보관 요청이 있습니다. 기존 결과를 확인하고 사본을 정리한 뒤 편집을 닫고 현재 자료를 다시 선택해 주세요.';
                await latest.current.onRecoveryRequired?.();
                return;
            }
            const opening = await writes.openEdit(scope, { reference, original }, executing);
            if (!executing())
                return;
            const request = normalizePalletStockEditRequest({ version: 3, action: 'edit-pallet', reference, original, expectedVersion: opening.expectedVersion, patch });
            entry = await writes.prepare(scope, request, executing, own);
            if (!executing())
                return;
            captured.prepared = prepareEntry(entry, form);
            captured.locked = true;
            const observation = await writes.command(scope, entry, 'apply', executing, undefined, own);
            if (!executing())
                return;
            const currentEntry = captured.prepared?.entry ?? entry;
            if (!observation.copyMismatch)
                await latest.current.onOperationObserved?.(currentEntry, observation);
            if (!executing())
                return;
            await acceptRecovery(currentEntry, observation, 'apply');
            if (executing() && captured.editingId) {
                captured.error = '처리 결과를 확인해야 합니다. 처리 확인에서 보관 요청을 확인해 주세요.';
                await latest.current.onRecoveryRequired?.();
            }
        }
        catch (error) {
            if (!executing())
                return;
            if (!entry) {
                try {
                    const rows = await writes.read(scope, executing);
                    if (!executing())
                        return;
                    entry = rows.find(row => row.references.some(item => JSON.stringify(item.reference) === JSON.stringify(reference))) ?? null;
                    if (entry)
                        captured.prepared = prepareEntry(entry, form);
                }
                catch (readError) {
                    if (executing())
                        captured.error = text(error) + ' 보관 요청을 다시 읽지 못했습니다. ' + text(readError);
                    return;
                }
            }
            if (!executing())
                return;
            captured.locked = !!entry;
            captured.error = entry ? '처리 결과를 확인해야 합니다. 처리 확인에서 보관 요청을 확인해 주세요.' : text(error);
            if (entry)
                await latest.current.onRecoveryRequired?.();
        }
        finally {
            if (current() && captured.execution === execution) {
                captured.inFlightEntryKey = null;
                captured.execution = null;
                repaint();
            }
        }
    };
    return { getPendingEntryKey: () => current() && captured.execution ? captured.inFlightEntryKey : null, editingId: current() ? captured.editingId : null, draft: captured.draft, dirty, busy: current() && !!captured.execution, locked: current() && captured.locked, error: current() ? captured.error : '', message: current() ? captured.message : '', begin, change, close, save, acceptRecovery };
}
