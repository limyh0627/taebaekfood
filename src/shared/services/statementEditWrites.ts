import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../firebase';
import type { CompanyId, IssuedStatement, PartnerItem } from '../types';
import { statementEditPatch } from '../statementEdit';
import { activeReleaseId, stripUndefined } from './firebaseService';
import { PARTNER_ITEM_TERMS_FIELDS, partnerItemTermsOpening } from '../partnerItemTermsCommand';
import { normalizeStatementEditRecoveryReference, normalizeStatementEditRecoveryResult, normalizeStatementEditRecoveryHistoryResult, type StatementEditRecoveryReference, type StatementEditRecoveryResult } from '../statementEditRecovery';
export interface StatementEditScope {
    companyId: CompanyId;
    actorUid: string;
}
export interface StatementEditFollowupPlan {
    upserts: PartnerItem[];
    openings: (PartnerItem | null)[];
    costUpdates: {
        itemId: string;
        price: number;
        sourceLineIndices?: number[];
    }[];
    skipIds: string[];
    isLatest: boolean;
}
export interface StatementEditProgress {
    stage: 'terms' | 'cost';
    index: number;
    status: 'running' | 'acknowledged';
}
export interface StatementEditWire {
    statementId: string;
    patch: Partial<IssuedStatement>;
    expectedRevision: number;
    operationId: string;
    releaseId: string;
}
export interface StatementEditRetained {
    version: 1;
    reference: StatementEditRecoveryReference;
    wire: StatementEditWire;
    inputPatch: Partial<IssuedStatement>;
    requestHash: string;
    followupPlan: StatementEditFollowupPlan | null;
    progress: StatementEditProgress[];
    bodyAcknowledged: boolean;
    createdAt: string;
    description: string;
    lastError?: string;
    lastAttempt?: {
        mode: 'apply' | 'inspect' | 'cancel';
        phase: 'sending' | 'response' | 'error';
        at: string;
    };
}
export interface StatementEditEntry {
    key: string;
    reference: StatementEditRecoveryReference | null;
    retained: StatementEditRetained | null;
    observedLocalText: string | null;
    observedReferenceText: string | null;
    referenceHash?: string | null;
    description: string;
}
export interface StatementEditObservation {
    result: StatementEditRecoveryResult;
    terminal: boolean;
    copyMismatch: boolean;
    message: string;
    nextAction: string;
    entry: StatementEditEntry;
}
type Current = () => boolean;
export interface StatementEditPort {
    storage: Storage;
    check(scope: StatementEditScope, current: Current): Promise<void>;
    exclusive<T>(scope: StatementEditScope, work: () => Promise<T>): Promise<T>;
    call(input: unknown): Promise<unknown>;
    release(): Promise<string>;
    id(): string;
    now(): string;
}
const prefix = (scope: StatementEditScope) => `statement-edit-v1:${scope.companyId}:${encodeURIComponent(scope.actorUid)}:`;
export const statementEditKey = (scope: StatementEditScope, ref: StatementEditRecoveryReference) => prefix(scope) + encodeURIComponent(JSON.stringify([ref.operationId, ref.statementId]));
const sha = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), value => value.toString(16).padStart(2, '0')).join('');
function reference(value: unknown, scope: StatementEditScope): StatementEditRecoveryReference {
    const ref = normalizeStatementEditRecoveryReference(value);
    if (ref.companyId !== scope.companyId)
        throw Error('전표 요청 번호를 확인하지 못했습니다.');
    return ref;
}
function hashText(wire: StatementEditWire) {
    return JSON.stringify({ statementId: wire.statementId, expectedRevision: wire.expectedRevision, patch: wire.patch });
}
export function createStatementEditWrites(port: StatementEditPort) {
    function same(scope: StatementEditScope, entry: StatementEditEntry) {
        if (!entry.key.startsWith(prefix(scope)) || entry.reference && statementEditKey(scope, entry.reference) !== entry.key)
            throw Error('다른 회사 또는 계정의 요청 정보입니다.');
        if (port.storage.getItem(entry.key) !== entry.observedLocalText || port.storage.getItem(entry.key + ':reference') !== entry.observedReferenceText)
            throw Error('기기에 남은 요청 정보가 바뀌었습니다. 다시 확인해 주세요.');
    }
    async function entryAt(scope: StatementEditScope, key: string): Promise<StatementEditEntry> {
        const observedLocalText = port.storage.getItem(key), observedReferenceText = port.storage.getItem(key + ':reference');
        let ref: StatementEditRecoveryReference | null = null, retained: StatementEditRetained | null = null, referenceHash: string | null = null;
        try {
            const sidecar = JSON.parse(observedReferenceText!);
            ref = reference(sidecar.reference, scope);
            if (!/^[a-f0-9]{64}$/.test(sidecar.requestHash))
                throw Error();
            referenceHash = sidecar.requestHash;
        }
        catch { /* 손상 본문과 독립 참조는 따로 확인한다. */ }
        try {
            const body = JSON.parse(observedLocalText!) as StatementEditRetained;
            const bodyRef = reference(body.reference, scope);
            if (body.version !== 1 || bodyRef.operationId !== body.wire.operationId || bodyRef.statementId !== body.wire.statementId || !Number.isSafeInteger(body.wire.expectedRevision) || body.wire.expectedRevision < 0 || body.requestHash !== await sha(hashText(body.wire)))
                throw Error();
            if (ref && JSON.stringify(ref) !== JSON.stringify(bodyRef))
                throw Error();
            ref = bodyRef;
            if (referenceHash !== body.requestHash)
                throw Error();
            retained = body;
        }
        catch { /* 원문이 손상돼도 참조만으로 실제 결과를 확인할 수 있다. */ }
        if (ref && statementEditKey(scope, ref) !== key) {
            ref = null;
            retained = null;
        }
        return { key, reference: ref, retained, referenceHash, observedLocalText, observedReferenceText, description: retained?.description || '전표 수정 요청' };
    }
    async function writtenEntry(scope: StatementEditScope, key: string, bodyText: string, referenceText: string | null) {
        const entry = await entryAt(scope, key);
        // 협력 잠금을 쓰지 않는 사본 교체도 새 원문으로 받아들이지 않는다.
        if (entry.observedLocalText !== bodyText || entry.observedReferenceText !== referenceText)
            throw Error('메타 기록 뒤 기기에 남은 요청 정보가 바뀌었습니다. 새 사본은 전송하지 않았습니다.');
        return entry;
    }
    async function readPending(scope: StatementEditScope, current: Current = () => true) {
        await port.check(scope, current);
        const keys = new Set<string>();
        for (let i = 0; i < port.storage.length; i++) {
            const key = port.storage.key(i);
            if (key?.startsWith(prefix(scope)))
                keys.add(key.endsWith(':reference') ? key.slice(0, -10) : key);
        }
        const entries = await Promise.all([...keys].map(key => entryAt(scope, key)));
        await port.check(scope, current);
        return entries;
    }
    async function prepare(scope: StatementEditScope, original: IssuedStatement, patch: Partial<IssuedStatement>, followupPlan: StatementEditFollowupPlan | null = null, current: Current = () => true): Promise<StatementEditEntry> {
        if (!original?.id || (original.companyId ?? 'taebaek') !== scope.companyId || !Number.isSafeInteger(original.mutationRevision ?? 0) || (original.mutationRevision ?? 0) < 0)
            throw Error('처음 선택한 전표 원문을 확인해 주세요.');
        original = { ...original };
        const inputPatch = stripUndefined(patch) as Partial<IssuedStatement>;
        const fixedPatch = stripUndefined(statementEditPatch(inputPatch, original)) as Partial<IssuedStatement>;
        await port.check(scope, current);
        const wire: StatementEditWire = { statementId: original.id, patch: fixedPatch, expectedRevision: original.mutationRevision ?? 0, operationId: port.id(), releaseId: await port.release() };
        await port.check(scope, current);
        const ref = reference({ companyId: scope.companyId, operationId: wire.operationId, statementId: original.id }, scope);
        const requestHash = await sha(hashText(wire));
        await port.check(scope, current);
        const publicTerms = (row: PartnerItem): PartnerItem => {
            partnerItemTermsOpening(row as unknown as Record<string, unknown>);
            return Object.fromEntries(['id', 'companyId', ...PARTNER_ITEM_TERMS_FIELDS].filter(field => Object.prototype.hasOwnProperty.call(row, field)).map(field => [field, row[field as keyof PartnerItem]])) as unknown as PartnerItem;
        };
        const plan = followupPlan ? { ...followupPlan, upserts: followupPlan.upserts.map(publicTerms), openings: followupPlan.openings.map(row => row ? publicTerms(row) : null) } : null;
        const body: StatementEditRetained = { version: 1, reference: ref, wire, inputPatch, requestHash, followupPlan: plan, progress: [], bodyAcknowledged: false, createdAt: port.now(), description: `전표 수정 · ${original.docNo || original.partnerName || '선택한 전표'}` };
        const text = JSON.stringify(body), refText = JSON.stringify({ version: 1, reference: ref, requestHash });
        return port.exclusive(scope, async () => {
            await port.check(scope, current);
            const existing = await readPending(scope, current);
            if (existing.some(entry => entry.retained?.wire.statementId === wire.statementId && entry.retained.wire.expectedRevision === wire.expectedRevision && JSON.stringify(entry.retained.inputPatch) === JSON.stringify(inputPatch)))
                throw Error('같은 내용의 보관 요청이 있습니다. 먼저 해당 요청의 결과를 확인해 주세요.');
            const key = statementEditKey(scope, ref);
            if (port.storage.getItem(key) !== null || port.storage.getItem(key + ':reference') !== null)
                throw Error('같은 번호의 요청이 이미 보관돼 있습니다.');
            port.storage.setItem(key, text);
            port.storage.setItem(key + ':reference', refText);
            if (port.storage.getItem(key) !== text || port.storage.getItem(key + ':reference') !== refText)
                throw Error('최초 요청을 기기에 보관하지 못해 전송하지 않았습니다.');
            return writtenEntry(scope, key, text, refText);
        });
    }
    async function markFollowup(scope: StatementEditScope, entry: StatementEditEntry, progress: StatementEditProgress | 'body-ack' | {
        error: string;
    }, current: Current = () => true) {
        return port.exclusive(scope, async () => {
            await port.check(scope, current);
            same(scope, entry);
            if (!entry.retained)
                throw Error('최초 요청 원문을 읽지 못했습니다.');
            if (JSON.stringify(entry.retained) !== entry.observedLocalText)
                throw Error('선택한 최초 요청 내용이 바뀌었습니다.');
            const body: StatementEditRetained = structuredClone(entry.retained);
            if (progress === 'body-ack')
                body.bodyAcknowledged = true;
            else if ('error' in progress)
                body.lastError = progress.error;
            else {
                if (!body.bodyAcknowledged)
                    throw Error('전표 수정 결과를 먼저 확인해 주세요.');
                const count = progress.stage === 'terms' ? body.followupPlan?.upserts.length : body.followupPlan?.costUpdates.length;
                if (!Number.isInteger(progress.index) || progress.index < 0 || progress.index >= (count ?? 0))
                    throw Error('최초 후속 처리 계획과 진행 항목이 다릅니다.');
                if (progress.status === 'acknowledged' && !body.progress.some(row => row.stage === progress.stage && row.index === progress.index && row.status === 'running'))
                    throw Error('시작한 후속 처리만 완료로 기록할 수 있습니다.');
                body.progress.push(progress);
            }
            const text = JSON.stringify(body);
            port.storage.setItem(entry.key, text);
            if (port.storage.getItem(entry.key) !== text)
                throw Error('후속 진행 내용을 보관하지 못했습니다. 다음 작업은 실행하지 않았습니다.');
            return writtenEntry(scope, entry.key, text, entry.observedReferenceText);
        });
    }
    async function attempt(scope: StatementEditScope, entry: StatementEditEntry, mode: 'apply' | 'inspect' | 'cancel', phase: 'sending' | 'response' | 'error', current: Current, error?: string) {
        if (!entry.retained)
            return entry;
        return port.exclusive(scope, async () => {
            await port.check(scope, current);
            same(scope, entry);
            const body = JSON.parse(entry.observedLocalText!) as StatementEditRetained;
            body.lastAttempt = { mode, phase, at: port.now() };
            if (error)
                body.lastError = error;
            const text = JSON.stringify(body);
            port.storage.setItem(entry.key, text);
            if (port.storage.getItem(entry.key) !== text)
                throw Error('요청 확인 단계를 보관하지 못했습니다.');
            return writtenEntry(scope, entry.key, text, entry.observedReferenceText);
        });
    }
    async function run(scope: StatementEditScope, entry: StatementEditEntry, mode: 'apply' | 'inspect' | 'cancel', current: Current = () => true): Promise<StatementEditObservation> {
        await port.check(scope, current);
        same(scope, entry);
        if (!entry.reference)
            throw Error('요청 번호를 읽지 못했습니다. 처리 기록을 확인해 주세요.');
        if (mode === 'apply' && !entry.retained)
            throw Error('최초 원문이 없어 같은 요청을 다시 보낼 수 없습니다.');
        if (mode === 'apply') {
            const sidecar = JSON.parse(entry.observedReferenceText ?? 'null');
            if (!sidecar || JSON.stringify(reference(sidecar.reference, scope)) !== JSON.stringify(entry.reference) || sidecar.requestHash !== entry.retained!.requestHash)
                throw Error('본문과 독립 참조의 최초 원문 해시가 다릅니다. 결과 확인 또는 요청 중단을 이용해 주세요.');
        }
        if (entry.retained && (JSON.stringify(entry.retained) !== entry.observedLocalText || entry.retained.requestHash !== await sha(hashText(entry.retained.wire))))
            throw Error('최초 원문이 바뀌었습니다.');
        await port.check(scope, current);
        same(scope, entry);
        entry = await attempt(scope, entry, mode, 'sending', current);
        await port.check(scope, current);
        same(scope, entry);
        const input = mode === 'apply' ? entry.retained!.wire : { mode, reference: entry.reference };
        let raw: unknown;
        try {
            raw = await port.call(input);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : '전표 수정 처리 결과를 확인하지 못했습니다.';
            try {
                await attempt(scope, entry, mode, 'error', current, message);
            }
            catch { /* 이전 원문과 송신 단계는 그대로 보존한다. */ }
            throw error;
        }
        await port.check(scope, current);
        const result = normalizeStatementEditRecoveryResult(raw, entry.reference!, scope.actorUid);
        if (result.status === 'unknown' && entry.retained) {
            try {
                entry = await attempt(scope, entry, mode, 'response', current, result.message);
            }
            catch { /* 직전의 송신 정보는 보존한다. */ }
        }
        let copyMismatch = false, observedCopyChanged = false;
        try {
            same(scope, entry);
        }
        catch {
            copyMismatch = true;
            observedCopyChanged = true;
        }
        if (entry.retained && result.requestHash && result.requestHash !== entry.retained.requestHash)
            copyMismatch = true;
        if (entry.referenceHash && result.requestHash && result.requestHash !== entry.referenceHash)
            copyMismatch = true;
        const terminal = result.status !== 'unknown' && !observedCopyChanged && !!(entry.observedLocalText || entry.observedReferenceText);
        return { result, terminal, copyMismatch, entry, message: result.message,
            nextAction: copyMismatch ? '기기에 남은 요청 내용이 바뀌었습니다. 다시 확인해 주세요.' : result.status === 'applied' ? '이전 전표 수정은 반영됐습니다. 현재 전표와 후속 처리를 확인해 주세요.' : result.status === 'cancelled' ? '기기에 남은 요청 정보를 정리한 뒤 새 수정 작업을 진행해 주세요.' : '처리 결과를 확인하거나 미처리 요청을 중단해 주세요.' };
    }
    async function discardObserved(scope: StatementEditScope, entry: StatementEditEntry, current: Current = () => true) {
        if (!entry.reference) {
            await port.exclusive(scope, async () => {
                await port.check(scope, current);
                same(scope, entry);
                port.storage.removeItem(entry.key);
                port.storage.removeItem(entry.key + ':reference');
                if (port.storage.getItem(entry.key) !== null || port.storage.getItem(entry.key + ':reference') !== null)
                    throw Error('기기에 남은 요청 정리를 확인하지 못했습니다.');
            });
            return { localOnly: true as const, terminal: false, copyMismatch: false, entry, message: '식별할 수 없는 이 기기의 요청 정보만 정리했습니다. 서버 처리 여부는 확인하지 못했으며 서버 요청을 중단한 것은 아닙니다.', nextAction: '처리 기록과 현재 전표를 확인한 뒤 필요한 업무를 진행해 주세요.' };
        }
        const observed = await run(scope, entry, 'inspect', current);
        if (!observed.terminal)
            throw Error('처리 결과가 확정되지 않았거나 기기 사본이 바뀌었습니다.');
        await port.exclusive(scope, async () => {
            entry = observed.entry;
            await port.check(scope, current);
            same(scope, entry);
            port.storage.removeItem(entry.key);
            port.storage.removeItem(entry.key + ':reference');
            if (port.storage.getItem(entry.key) !== null || port.storage.getItem(entry.key + ':reference') !== null)
                throw Error('기기에 남은 요청 정리를 확인하지 못했습니다.');
        });
        return observed;
    }
    async function listHistory(scope: StatementEditScope, cursor?: string, current: Current = () => true) {
        await port.check(scope, current);
        const result = normalizeStatementEditRecoveryHistoryResult(await port.call({ mode: 'listHistory', companyId: scope.companyId, cursor }), scope.companyId, scope.actorUid);
        await port.check(scope, current);
        return result;
    }
    return { prepare, readPending, readReferences: readPending, apply: (scope: StatementEditScope, entry: StatementEditEntry, current?: Current) => run(scope, entry, 'apply', current), inspect: (scope: StatementEditScope, entry: StatementEditEntry, current?: Current) => run(scope, entry, 'inspect', current), cancel: (scope: StatementEditScope, entry: StatementEditEntry, current?: Current) => run(scope, entry, 'cancel', current), markFollowup, discardObserved, listHistory };
}
export type StatementEditBindings = ReturnType<typeof createStatementEditWrites>;
async function check(scope: StatementEditScope, current: Current) {
    await authReady;
    if (!current() || !scope.actorUid || auth.currentUser?.uid !== scope.actorUid)
        throw Error('회사 또는 로그인 계정이 바뀌었습니다.');
    const token = await auth.currentUser.getIdTokenResult();
    if (!current() || auth.currentUser?.uid !== scope.actorUid || token.claims.companyId !== scope.companyId || typeof token.claims.employeeId !== 'string' || token.claims.isAdmin !== true)
        throw Error('현재 회사의 전표 수정 권한을 확인해 주세요.');
}
export const statementEditWrites: StatementEditBindings = createStatementEditWrites({
    get storage() { return localStorage; }, check,
    exclusive: async (scope, work) => { if (!navigator.locks?.request)
        throw Error('이 브라우저에서 요청 보호 잠금을 사용할 수 없습니다.'); return navigator.locks.request(prefix(scope), { mode: 'exclusive' }, work); },
    call: async (input) => (await httpsCallable(functions, 'editIssuedStatementCommand')(input)).data,
    release: activeReleaseId, id: () => crypto.randomUUID(), now: () => new Date().toISOString(),
});
