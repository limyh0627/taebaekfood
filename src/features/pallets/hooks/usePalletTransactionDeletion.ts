import { useEffect, useReducer, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../../shared/firebase';
import { appConfirm } from '../../../shared/components/appDialog';
import type { CompanyId, PalletStock, PalletTransaction } from '../../../shared/types';
import { normalizePalletTransactionDeleteSource, normalizePalletTransactionDeleteRequest, normalizePalletTransactionDeleteReference, type PalletTransactionDeleteReference } from '../../../shared/palletTransactionCommand';
import writes, { type PalletTransactionEntry as Entry, type PalletTransactionObservation as Observation, type PalletTransactionScope } from '../../../shared/services/palletTransactionWrites';
import type { PalletStockRecoveryAction } from './usePalletStockEditor';
type Prepared = {
    entry: Entry;
    bodyRaw: string | null;
    referenceRaw: string | null;
    requestHash: string | null;
    reference: string;
    originalSelection: PalletTransaction;
    disconnected: boolean;
};
type Owner = {
    companyId: CompanyId;
    uid: string;
    identity: object;
    execution: object | null;
    prepared: Prepared | null;
    inFlightEntryKey: string | null;
    deletingId: string | null;
    lastId: string | null;
    error: string;
    message: string;
    listError: string;
};
const makeOwner = (companyId: CompanyId, uid: string): Owner => ({ companyId, uid, identity: {}, execution: null, prepared: null, inFlightEntryKey: null, deletingId: null, lastId: null, error: '', message: '', listError: '' });
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const samePair = (prepared: Prepared, entry: Entry) => prepared.entry.key === entry.key && prepared.bodyRaw === entry.bodyRaw && prepared.referenceRaw === entry.referenceRaw;
export interface PalletDeletionListInput {
    transactionId: string;
    optimisticSource: PalletTransaction | null;
    scope: PalletTransactionScope;
}
export function usePalletTransactionDeletion({ companyId, pallets, onRecoveryRequired, onOperationObserved, onApplied }: {
    companyId: CompanyId;
    pallets: readonly PalletStock[];
    onRecoveryRequired?: () => void | Promise<void>;
    onOperationObserved?: (entry: Entry, observation: Observation) => void | Promise<void>;
    onApplied?: (input: PalletDeletionListInput, isCurrent: () => boolean) => void | Promise<void>;
}) {
    const [, repaint] = useReducer(value => value + 1, 0);
    const latest = useRef({ companyId, pallets, onRecoveryRequired, onOperationObserved, onApplied });
    latest.current = { companyId, pallets, onRecoveryRequired, onOperationObserved, onApplied };
    const owner = useRef(makeOwner(companyId, auth.currentUser?.uid ?? ''));
    if (owner.current.companyId !== companyId || owner.current.uid !== (auth.currentUser?.uid ?? ''))
        owner.current = makeOwner(companyId, auth.currentUser?.uid ?? '');
    const captured = owner.current, mount = useRef<object | null>({}), mounted = mount.current;
    const current = () => mounted !== null && mount.current === mounted && owner.current === captured && auth.currentUser?.uid === captured.uid;
    useEffect(() => { const token = {}; mount.current = token; repaint(); return () => { if (mount.current === token)
        mount.current = null; }; }, [captured]);
    useEffect(() => onAuthStateChanged(auth, user => { const uid = user?.uid ?? ''; if (owner.current.uid !== uid) {
        owner.current = makeOwner(latest.current.companyId, uid);
        repaint();
    } }), []);
    const scope = { companyId: captured.companyId, actorUid: captured.uid };
    const acceptRecovery = async (entry: Entry, observation: Observation, action: PalletStockRecoveryAction) => {
        if (!current())
            return;
        let reference: PalletTransactionDeleteReference;
        try {
            reference = normalizePalletTransactionDeleteReference(observation.result?.reference ?? entry.reference);
        }
        catch {
            return;
        }
        if (reference.companyId !== captured.companyId || observation.result && observation.result.actorUid !== captured.uid)
            return;
        const prepared = captured.prepared, execution = captured.execution;
        const observing = () => current() && captured.execution === execution;
        if (action === 'observed') {
            if (!prepared || prepared.entry.key !== entry.key)
                return;
            const next = observation.entry;
            if (prepared.disconnected || !samePair(prepared, entry)) {
                captured.prepared = { ...prepared, disconnected: true };
                return;
            }
            if (next && next.key === entry.key && next.bodyRaw === prepared.bodyRaw && next.requestHash === prepared.requestHash && JSON.stringify(next.reference) === prepared.reference)
                captured.prepared = { ...prepared, entry: next, referenceRaw: next.referenceRaw };
            return;
        }
        if (prepared && samePair(prepared, entry) && !observation.copyMismatch && observation.terminal) {
            if (action === 'discard') {
                captured.prepared = null;
                captured.error = '';
                captured.message = '이 기기에 남은 사본을 정리했습니다.';
                repaint();
                return;
            }
            if (observation.result?.status === 'cancelled') {
                captured.error = '';
                captured.message = '미처리 요청을 중단했습니다. 남은 사본을 정리한 뒤 새 작업을 시작할 수 있습니다.';
                repaint();
                return;
            }
        }
        if ((action !== 'apply' && action !== 'inspect') || observation.copyMismatch || observation.result?.status !== 'applied' || !observation.terminal)
            return;
        captured.lastId = reference.transactionId;
        let optimisticSource: PalletTransaction | null = null;
        if (prepared && !prepared.disconnected && samePair(prepared, entry) && entry.status === 'valid' && entry.request?.version === 4
            && prepared.requestHash && prepared.requestHash === observation.result.requestHash && prepared.reference === JSON.stringify(reference)
            && observation.entry && samePair(prepared, observation.entry)) {
            try {
                const rows = await writes.read(scope, observing);
                if (!observing() || captured.prepared !== prepared)
                    return;
                const same = rows.find(row => row.key === entry.key);
                if (same && samePair(prepared, same))
                    optimisticSource = prepared.originalSelection;
                else
                    captured.prepared = { ...prepared, disconnected: true };
            }
            catch {
                if (!observing())
                    return;
                captured.prepared = { ...prepared, disconnected: true };
            }
        }
        if (!observing())
            return;
        try {
            await latest.current.onApplied?.({ transactionId: reference.transactionId, optimisticSource, scope }, observing);
            if (!observing())
                return;
            captured.listError = '';
            if (prepared?.entry.key === entry.key)
                captured.error = '';
            captured.message = '이 요청의 거래 삭제 처리를 확인했습니다. 현재 자료는 목록에서 확인해 주세요.';
        }
        catch (error) {
            if (observing())
                captured.listError = '이 요청의 삭제 처리는 확인했지만 현재 거래를 다시 읽지 못했습니다. 현재 거래 다시 조회를 눌러 주세요. ' + errorText(error);
        }
        if (observing())
            repaint();
    };
    const remove = async (selection: PalletTransaction) => {
        if (!current() || captured.execution || !captured.uid)
            return;
        const execution = {};
        captured.execution = execution;
        captured.prepared = null;
        captured.deletingId = selection.id;
        captured.error = '';
        captured.message = '';
        captured.listError = '';
        captured.lastId = selection.id;
        repaint();
        const executing = () => current() && captured.execution === execution;
        let entry: Entry | null = null;
        const reference: PalletTransactionDeleteReference = { kind: 'pallet-transaction-delete', companyId: captured.companyId, operationId: `pallet-delete-${crypto.randomUUID()}`, transactionId: selection.id };
        try {
            const original = normalizePalletTransactionDeleteSource(selection);
            const selectedPallet = latest.current.pallets.find(row => row.id === selection.palletId);
            const pallet = original.isTransfer ? selectedPallet ? { exists: true as const, total: selectedPallet.total } : { exists: false as const } : undefined;
            if (!await appConfirm(`이 파렛트 ${original.type === 'in' ? '입고' : '지급'} 거래(${original.quantity}개)를 삭제할까요?\n되돌릴 수 없습니다.`))
                return;
            if (!executing())
                return;
            const rows = await writes.read(scope, executing);
            if (!executing())
                return;
            if (writes.findMatchingDelete(rows, selection.id)) {
                captured.error = '이 거래의 보관 요청이 있습니다. 기존 요청의 처리 결과를 확인해 주세요.';
                await latest.current.onRecoveryRequired?.();
                return;
            }
            const opening = await writes.openDelete(scope, { reference, original, ...(pallet ? { pallet } : {}) }, executing);
            if (!executing())
                return;
            const request = normalizePalletTransactionDeleteRequest({ version: 4, action: 'delete-transaction', reference, original, expectedVersion: opening.expectedVersion, ...(opening.pallet ? { pallet: opening.pallet } : {}) });
            const own = (next: Entry | null, previous?: Entry) => {
                if (!executing() || !next)
                    return;
                const prepared = captured.prepared;
                if (!previous) {
                    captured.inFlightEntryKey = next.key;
                    repaint();
                }
                if (prepared && !prepared.disconnected && previous && samePair(prepared, previous) && next.bodyRaw === prepared.bodyRaw && next.requestHash === prepared.requestHash && JSON.stringify(next.reference) === prepared.reference)
                    captured.prepared = { ...prepared, entry: next, referenceRaw: next.referenceRaw };
            };
            entry = await writes.prepare(scope, request, executing, own);
            if (!executing())
                return;
            captured.prepared = { entry, originalSelection: selection, bodyRaw: entry.bodyRaw, referenceRaw: entry.referenceRaw, requestHash: entry.requestHash, reference: JSON.stringify(entry.reference), disconnected: false };
            const observation = await writes.command(scope, entry, 'apply', executing, undefined, own);
            if (!executing())
                return;
            const retained = captured.prepared.entry;
            if (!observation.copyMismatch)
                await latest.current.onOperationObserved?.(retained, observation);
            if (!executing())
                return;
            await acceptRecovery(retained, observation, 'apply');
            if (executing() && observation.result?.status !== 'applied')
                await latest.current.onRecoveryRequired?.();
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
                }
                catch (readError) {
                    if (executing())
                        captured.error = '삭제 준비 결과와 보관 요청을 확인하지 못했습니다. ' + errorText(error) + ' ' + errorText(readError);
                }
            }
            if (!executing())
                return;
            if (entry)
                captured.error = '삭제 요청의 처리 결과를 확인해야 합니다. 파렛트 작업 처리 확인을 열어 주세요.';
            else if (!captured.error)
                captured.error = '삭제 준비를 마치지 못했습니다. ' + errorText(error);
            try {
                await latest.current.onRecoveryRequired?.();
            }
            catch (readError) {
                if (executing())
                    captured.error += ' 보관 요청을 다시 읽지 못했습니다. ' + errorText(readError);
            }
        }
        finally {
            if (current() && captured.execution === execution) {
                captured.execution = null;
                captured.inFlightEntryKey = null;
                captured.deletingId = null;
                repaint();
            }
        }
    };
    const refreshCurrent = async () => {
        if (!current() || captured.execution || !captured.lastId)
            return;
        const execution = {};
        captured.execution = execution;
        repaint();
        const executing = () => current() && captured.execution === execution;
        try {
            await latest.current.onApplied?.({ transactionId: captured.lastId, optimisticSource: null, scope }, executing);
            if (executing()) {
                captured.listError = '';
                captured.message = '현재 거래를 다시 조회했습니다. 목록의 현재 내용을 확인해 주세요.';
            }
        }
        catch (error) {
            if (executing())
                captured.listError = '현재 거래를 다시 읽지 못했습니다. ' + errorText(error);
        }
        finally {
            if (executing()) {
                captured.execution = null;
                repaint();
            }
        }
    };
    return { scopeToken: captured.identity, busy: current() && !!captured.execution, deletingId: current() ? captured.deletingId : null, getPendingEntryKey: () => current() && captured.execution ? captured.inFlightEntryKey : null, remove, acceptRecovery, refreshCurrent, error: current() ? captured.error : '', message: current() ? captured.message : '', listError: current() ? captured.listError : '', canRefresh: current() && !!captured.lastId };
}
