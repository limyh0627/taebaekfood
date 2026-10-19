import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, authReady } from '../../../shared/firebase';
import type { CashAccount, CompanyId } from '../../../shared/types';
import { companyOf } from '../../../shared/types';
import { today } from '../../../shared/day';
import { defaultCashAccountId } from '../../../shared/defaultCashAccount';
import { formatMoneyInput, parseMoneyInput } from '../../../shared/moneyInput';
import { appConfirm } from '../../../shared/components/appDialog';
import { primaryCommitted, saveOutcomeMessage } from '../../../shared/saveOutcome';
import type { PartnerPaymentRecoveryResult } from '../../../shared/partnerPaymentRecovery';
import { recordPartnerPayment } from '../infrastructure/issueTradeStatementCommand';
import { PartnerPaymentTerminalError, readPartnerPaymentRecoveries, resolvePartnerPaymentRecovery, retryPartnerPaymentRecovery, discardPartnerPaymentCopy, listPartnerPaymentHistory, type PartnerPaymentRecoveryEntry, type PartnerPaymentRecoveryScope } from '../infrastructure/partnerPaymentRecovery';
export type { PartnerPaymentRecoveryEntry } from '../infrastructure/partnerPaymentRecovery';
export interface PartnerPaymentRecoveryOptions {
    companyId: CompanyId;
    actorUid?: string;
    enabled?: boolean;
    recoveryOnly?: boolean;
    partnerId: string;
    partnerName: string;
    type: '매입' | '매출';
    balance: number;
    cashAccounts: CashAccount[];
    initialAmount?: number;
    initialDate?: string;
    onClose?: () => void;
    confirm?: (message: string) => Promise<boolean>;
}
const ports = {
    save: recordPartnerPayment, read: readPartnerPaymentRecoveries, resolve: resolvePartnerPaymentRecovery, retry: retryPartnerPaymentRecovery, discard: discardPartnerPaymentCopy, list: listPartnerPaymentHistory
};
export function usePartnerPaymentRecovery(options: PartnerPaymentRecoveryOptions, services = ports) {
    const latest = useRef(options);
    latest.current = options;
    const [uid, setUid] = useState(auth.currentUser?.uid ?? ''), [authReadyState, setAuthReady] = useState(false);
    const enabled = options.enabled !== false && !!options.partnerId;
    const owner = options.companyId + ':' + uid + ':' + options.partnerId + ':' + enabled + ':' + !!options.recoveryOnly;
    const readState = useRef({ owner: '', failed: false, entries: [] as PartnerPaymentRecoveryEntry[] });
    const confirmedRequests=useRef(new Set<string>());
    const generation = useRef(0), ownerRef = useRef(owner), lockedRef = useRef(false), alive = useRef(true);
    if (ownerRef.current !== owner) {
        ownerRef.current = owner;
        generation.current++;
        lockedRef.current = false;
        readState.current = { owner: '', failed: false, entries: [] };
    }
    const initial = () => options.recoveryOnly ? { amount: '', date: '', note: '', accountId: '' } : ({
        amount: formatMoneyInput(Math.round(Number.isFinite(options.initialAmount) ? options.initialAmount! : options.balance)), date: options.initialDate || today(), note: '', accountId: defaultCashAccountId(options.cashAccounts.filter(a => a.active && companyOf(a) === options.companyId), options.companyId)
    });
    const [form, setForm] = useState(initial), [stateOwner, setStateOwner] = useState(owner), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
    const [pending, setPending] = useState<PartnerPaymentRecoveryEntry[]>([]), [selected, setSelected] = useState<PartnerPaymentRecoveryEntry | null>(null), [readFailed, setReadFailed] = useState(false), [readOwner, setReadOwner] = useState('');
    const selectedRef = useRef<PartnerPaymentRecoveryEntry | null>(null);
    const [history, setHistory] = useState<PartnerPaymentRecoveryResult[]>([]), [cursor, setCursor] = useState<string | null>(null);
    const scope = (): PartnerPaymentRecoveryScope => ({
        companyId: latest.current.companyId, actorUid: uid, partnerId: latest.current.partnerId
    });
    const capture = () => {
        const key = owner, turn = generation.current, s = {
            companyId: options.companyId, actorUid: uid, partnerId: options.partnerId
        };
        return { scope: s, current: () => latest.current.enabled !== false && !!latest.current.partnerId && alive.current && ownerRef.current === key && generation.current === turn && auth.currentUser?.uid === s.actorUid && (!latest.current.actorUid || latest.current.actorUid === s.actorUid) };
    };
    useEffect(() => {
        alive.current = true;
        let active = true;
        const stop = onAuthStateChanged(auth, user => {
            if (active)
                setUid(user?.uid ?? '');
        });
        void Promise.resolve(authReady).then(() => {
            if (active)
                setAuthReady(true);
        });
        return () => {
            active = false;
            alive.current = false;
            generation.current++;
            stop();
        };
    }, []);
    const showEntry = (entry: PartnerPaymentRecoveryEntry) => {
        selectedRef.current = entry;
        setSelected(entry);
        if (entry.request) {
            const r = entry.request;
            setForm({
                amount: formatMoneyInput(r.amount), date: r.tradeDate, note: r.note ?? '', accountId: r.cashAccountId
            });
        }
    };
    const refresh = async (c: ReturnType<typeof capture>) => {
        let rows: PartnerPaymentRecoveryEntry[];
        try {
            rows = await services.read(c.scope, c.current);
        }
        catch (error) {
            if (c.current()) {
                readState.current = { owner: '', failed: true, entries: readState.current.entries };
                setReadFailed(true);
                setReadOwner('');
            }
            throw error;
        }
        if (c.current()) {
            readState.current = { owner: ownerRef.current, failed: false, entries: rows };
            setPending(rows);
            setReadFailed(false);
            setReadOwner(ownerRef.current);
            const previous = selectedRef.current, chosen = rows.find(e => e.reference?.operationId === previous?.reference?.operationId && e.key === previous?.key) ?? rows[0] ?? null;
            selectedRef.current = chosen;
            setSelected(chosen);
            if (chosen?.request) {
                const r = chosen.request;
                setForm({
                    amount: formatMoneyInput(r.amount), date: r.tradeDate, note: r.note ?? '', accountId: r.cashAccountId
                });
            }
        }
        return rows;
    };
    useEffect(() => {
        readState.current = { owner: '', failed: false, entries: [] };
        setStateOwner(owner);
        setForm(initial());
        setBusy(false);
        setError('');
        setMessage('');
        setPending([]);
        selectedRef.current = null;
        setSelected(null);
        setReadOwner('');
        setHistory([]);
        setCursor(null);
        setReadFailed(false);
        if (!enabled || !authReadyState || !uid)
            return;
        const c = capture();
        void refresh(c).catch(e => {
            if (c.current()) {
                setReadFailed(true);
                setError(e instanceof Error ? e.message : '보관 결제를 읽지 못했습니다.');
            }
        });
    }, [owner, authReadyState]);
    const visible = stateOwner === owner && (!options.actorUid || options.actorUid === uid), entries = visible ? pending : [], selectedEntry = visible ? selected : null;
    const authScopeReady = enabled && authReadyState && !!uid && (!options.actorUid || options.actorUid === uid) && visible;
    const ready = authScopeReady && readOwner === owner;
    const blockedReason = !enabled ? '거래처를 선택한 일반 입출금 화면에서 확인할 수 있습니다.' : !uid ? '관리자 로그인을 확인해 주세요.' : options.actorUid && options.actorUid !== uid ? '로그인 계정이 변경됐습니다. 창을 닫고 다시 여세요.' : !ready ? '보관된 수금·지불 요청을 먼저 읽고 있습니다.' : '';
    const locked = !!options.recoveryOnly || !ready || busy || entries.length > 0 || readFailed;
    const change = (field: keyof typeof form, value: string) => {
        if (!latest.current.recoveryOnly && ownerRef.current === owner && !locked && !lockedRef.current)
            setForm(previous => ({ ...previous, [field]: value }));
    };
    const perform = async (work: (c: ReturnType<typeof capture>) => Promise<void>) => {
        if (ownerRef.current !== owner || lockedRef.current)
            return;
        if (!authScopeReady) {
            setError(blockedReason);
            return;
        }
        const c = capture();
        if (!c.current()) {
            setError('로그인 계정이나 결제 화면이 변경됐습니다. 창을 닫고 다시 여세요.');
            return;
        }
        lockedRef.current = true;
        setBusy(true);
        setError('');
        setMessage('');
        try {
            await work(c);
        }
        catch (e) {
            if (c.current())
                setError(e instanceof Error ? e.message : '처리 결과를 확인하지 못했습니다.');
        }
        finally {
            if (c.current()) {
                lockedRef.current = false;
                setBusy(false);
            }
        }
    };
    const save = () => {
        if (options.recoveryOnly || latest.current.recoveryOnly || ownerRef.current !== owner) return Promise.resolve();
        return perform(async (c) => {
        if (!ready || entries.length || readFailed)
            return;
        const o = latest.current, value = parseMoneyInput(form.amount), accounts = o.cashAccounts.filter(a => a.active && companyOf(a) === o.companyId);
        if (!Number.isFinite(value) || value <= 0)
            throw Error('실제로 입출금할 금액을 양수로 입력하세요.');
        if (!accounts.some(a => a.id === form.accountId))
            throw Error('입출금 계좌를 선택해 주세요.');
        const input = {
            tradeDate: form.date, partnerId: o.partnerId, direction: o.type === '매출' ? '입금' as const : '출금' as const, amount: value, cashAccountId: form.accountId, pin: false, allocations: [], note: [o.partnerName + ' ' + (o.type === '매출' ? '수금' : '지불'), form.note].filter(Boolean).join(' · ')
        };
        try {
            await services.save(o.companyId, input, { isCurrent: c.current });
            if (c.current() && !latest.current.recoveryOnly)
                o.onClose?.();
        }
        catch (e) {
            if (c.current()) {
                await refresh(c);
                if (e instanceof PartnerPaymentTerminalError) {
                    setMessage(saveOutcomeMessage(e.outcome));
                }
                else {
                    setError(e instanceof Error ? e.message : '현금 저장 결과를 확인하지 못했습니다.');
                }
            }
        }
    });
    };
    const resolve = (mode: 'inspect' | 'cancel', entry = selectedEntry) => perform(async (c) => {
        if (!entry)
            return;
        const result = await services.resolve(c.scope, entry, mode, c.current);
        if (!c.current())
            return;
        if(entry.reference&&result.serverResult&&result.serverResult.status!=='unknown')confirmedRequests.current.add(owner+':'+entry.reference.operationId);
        setMessage((result.serverResult?.message ?? '') + (result.outcome.status === 'saved' ? '' : ('\n' + saveOutcomeMessage(result.outcome))));
        await refresh(c);
        if (!c.current())
            return;
        // 과거 서버 이력 조회는 현재 새 작성창의 완료가 아니다. 원문이 있는 정확 요청만 종료한다.
        if (!latest.current.recoveryOnly && entry.request && result.terminal && result.outcome.status==='saved' && primaryCommitted(result.outcome, entry.reference!.operationId))
            latest.current.onClose?.();
    });
    const retry = (entry = selectedEntry) => perform(async (c) => {
        if (!entry)
            return;
        const result = entry.reference&&confirmedRequests.current.has(owner+':'+entry.reference.operationId)?await services.resolve(c.scope,entry,'inspect',c.current):await services.retry(c.scope, entry, c.current);
        if(c.current()&&entry.reference&&result.serverResult&&result.serverResult.status!=='unknown')confirmedRequests.current.add(owner+':'+entry.reference.operationId);
        if (!c.current())
            return;
        setMessage(result.outcome.status === 'saved' ? '최초 수금·지불 요청의 처리가 확인됐습니다.' : saveOutcomeMessage(result.outcome));
        await refresh(c);
        if (!latest.current.recoveryOnly && c.current() && entry.request && result.terminal && result.outcome.status === 'saved' && primaryCommitted(result.outcome, entry.reference!.operationId))
            latest.current.onClose?.();
    });
    const discardCopy = (entry = selectedEntry) => perform(async (c) => {
        if (!entry)
            return;
        const confirmed = await (latest.current.confirm ?? appConfirm)(entry.reference ? '이 기기 사본만 정리할까요? 이미 처리된 결제를 취소하지 않습니다.' : '요청 번호를 모르는 이 기기 사본만 정리할까요? 서버 중단이나 미처리를 확인한 것이 아니며 새 결제가 안전하다는 뜻이 아닙니다.');
        if (!confirmed || !c.current())
            return;
        const result = await services.discard(c.scope, entry, c.current);
        if (c.current()) {
            setMessage(result.message);
            await refresh(c);
        }
    });
    const load = (next = false) => perform(async (c) => {
        const page = await services.list(c.scope, next ? cursor ?? undefined : undefined, c.current);
        if (c.current()) {
            setHistory(previous => next ? [...previous, ...page.entries] : page.entries);
            setCursor(page.nextCursor);
            setMessage(`이번 서버 조회 ${page.entries.length}건을 확인했습니다. 목록이 없다는 사실은 결제 미처리의 증거가 아닙니다. 서버 이력과 보관 사본을 자동으로 같은 요청이라고 판단하지 않습니다. 날짜·금액과 요청 번호를 직접 확인해 주세요.`);
        }
    });
    const historyEntry = (result: PartnerPaymentRecoveryResult): PartnerPaymentRecoveryEntry => ({
        key: 'partner-payment-pending:' + result.reference.companyId + ':' + result.reference.partnerId + ':' + uid, bodyText: null, sidecarKey: null, sidecarText: null, reference: result.reference, request: null, requestHash: null, sidecarHash: null, status: 'missing', description: result.message
    });
    const getBlocker = () => {
        if (ownerRef.current !== owner || !capture().current()) return '로그인 계정이나 거래처가 변경됐습니다. 다시 확인해 주세요.';
        if (!authScopeReady) return blockedReason;
        if (readState.current.failed) return '이전 수금·지불 요청을 읽지 못했습니다. 목록을 다시 읽어 주세요.';
        if (readState.current.owner !== owner) return '이전 수금·지불 요청을 먼저 읽고 있습니다.';
        if (lockedRef.current) return '이전 요청을 확인하고 있습니다. 완료 응답을 기다려 주세요.';
        if (readState.current.entries.length) return '이전 수금·지불 요청의 결과를 확인하거나 미처리 요청을 중단한 뒤 새로 저장해 주세요.';
        return '';
    };
    return {
        readLoading: enabled && !ready && !readFailed, isBusy: () => ownerRef.current === owner && lockedRef.current, canStartNew: () => getBlocker() === '', getBlocker,
        ...(visible ? form : initial()), ready, blockedReason, readFailed: visible && readFailed, busy: visible && busy, error: visible ? error : '', message: visible ? message : '', locked, pending: entries, selectedEntry, history: visible ? history : [], historyMore: visible && cursor !== null,
        setAmount: (v: string) => change('amount', v), setDate: (v: string) => change('date', v), setNote: (v: string) => change('note', v), setAccountId: (v: string) => change('accountId', v),
        selectEntry: (entry: PartnerPaymentRecoveryEntry) => {
            if (ownerRef.current === owner && !lockedRef.current && entries.includes(entry))
                showEntry(entry);
        }, canRetryEntry: (entry: PartnerPaymentRecoveryEntry) => entry.status === 'valid' && !!entry.request && (!entry.reference||!confirmedRequests.current.has(owner+':'+entry.reference.operationId)), canDiscardEntry: (entry: PartnerPaymentRecoveryEntry) => entry.bodyText !== null || entry.sidecarText !== null,
        save, inspect: (entry = selectedEntry) => resolve('inspect', entry), cancel: (entry = selectedEntry) => resolve('cancel', entry), retry, discardCopy, loadHistory: () => load(), nextHistory: () => load(true), inspectHistory: (result: PartnerPaymentRecoveryResult) => resolve('inspect', historyEntry(result)), cancelHistory: (result: PartnerPaymentRecoveryResult) => resolve('cancel', historyEntry(result)),
        refresh: () => perform(async (c) => {
            await refresh(c);
        }), close: () => {
            if (ownerRef.current !== owner || lockedRef.current)
                return false;
            generation.current++;
            if (!latest.current.recoveryOnly) latest.current.onClose?.();
            return true;
        }
    };
}
