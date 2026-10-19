import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../../../shared/firebase';
import { COMPANY_INFO_FIELDS, companyInfoOpening, normalizeCompanyInfoReference, normalizeCompanyInfoRequest, normalizeCompanyInfoOpenResult, normalizeCompanyInfoResult, normalizeCompanyInfoHistoryResult, serializeCompanyInfoRequest, type CompanyInfoReference, type CompanyInfoRequest, type CompanyInfoOpenResult, type CompanyInfoCommand } from '../../../shared/companyInfoCommand';
import type { CompanyInfo, CompanyId } from '../../../shared/types';
import type { SaveOutcome } from '../../../shared/saveOutcome';
export type { CompanyInfoReference, CompanyInfoOpenResult } from '../../../shared/companyInfoCommand';
export interface CompanyInfoScope {
    companyId: CompanyId;
    actorUid: string;
}
export interface CompanyInfoContext extends CompanyInfoScope {
    isCurrent: () => boolean;
}
export interface CompanyInfoOperationContext extends CompanyInfoContext {
    planId: string;
}
export interface CompanyInfoSaveContext extends CompanyInfoOperationContext {
    opening: CompanyInfoOpenResult;
}
export type CompanyInfoOutcome = SaveOutcome & {
    requestFinalized?: boolean;
    requiresReopen?: boolean;
};
export interface CompanyInfoOperationEntry {
    key: string;
    reference: CompanyInfoReference | null;
    status: 'valid' | 'corrupt' | 'missing';
    description: string;
    observedLocalText: string | null;
    observedReferenceText: string | null;
}
export interface CompanyInfoPort {
    storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
    assertContext: (context: CompanyInfoContext) => Promise<void>;
    digest: (text: string) => Promise<string>;
    command: (command: CompanyInfoCommand) => Promise<unknown>;
}
const exclusive = async <T>(key: string, action: () => Promise<T>): Promise<T> => typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('company-info:' + key, action) : action();
const bodyPrefix = 'company-info-operation-v1:', refPrefix = 'company-info-reference-v1:';
const suffix = (scope: CompanyInfoScope, ref: CompanyInfoReference) => `${scope.companyId}:${encodeURIComponent(scope.actorUid)}:${encodeURIComponent(ref.planId)}`;
const keys = (scope: CompanyInfoScope, ref: CompanyInfoReference) => ({ body: bodyPrefix + suffix(scope, ref), sidecar: refPrefix + suffix(scope, ref) });
const sameRef = (a: CompanyInfoReference, b: CompanyInfoReference) => a.companyId === b.companyId && a.planId === b.planId;
const unknown = (message = '회사정보 저장 결과를 확인하지 못했습니다.'): CompanyInfoOutcome => ({ status: 'unknown', message, nextAction: '같은 요청의 결과 확인 또는 미처리 요청 중단을 선택해 주세요. 현재 입력으로 새 요청을 보내지 마세요.' });
export function createCompanyInfoWriter(port: CompanyInfoPort) {
    const active = async (context: CompanyInfoContext) => {
        if (!context.isCurrent())
            throw Error('회사 또는 화면이 바뀌었습니다.');
        await port.assertContext(context);
        if (!context.isCurrent())
            throw Error('회사 또는 화면이 바뀌었습니다.');
    };
    const parse = async (scope: CompanyInfoScope, ref: CompanyInfoReference, raw: string | null) => {
        if (raw === null)
            return null;
        try {
            const data = JSON.parse(raw), request = normalizeCompanyInfoRequest(data.request);
            if (data.version !== 1 || data.actorUid !== scope.actorUid || !sameRef(ref, request.reference) || ref.companyId !== scope.companyId || typeof data.requestHash !== 'string' || await port.digest(serializeCompanyInfoRequest(request)) !== data.requestHash)
                throw Error();
            return { request, requestHash: data.requestHash as string };
        }
        catch {
            return null;
        }
    };
    const snapshot = async (scope: CompanyInfoScope, input: CompanyInfoReference) => {
        const ref = normalizeCompanyInfoReference(input);
        if (ref.companyId !== scope.companyId)
            throw Error('다른 회사 요청입니다.');
        const key = keys(scope, ref), raw = port.storage.getItem(key.body), sidecar = port.storage.getItem(key.sidecar);
        let plan = await parse(scope, ref, raw);
        if (plan) {
            try {
                const value = JSON.parse(sidecar!);
                if (value.version !== 1 || value.actorUid !== scope.actorUid || !sameRef(normalizeCompanyInfoReference(value.reference), ref) || value.requestHash !== plan.requestHash)
                    throw Error();
            }
            catch {
                plan = null;
            }
        }
        return {
            ref, key, raw, sidecar, plan
        };
    };
    const references = async (scope: CompanyInfoScope): Promise<CompanyInfoOperationEntry[]> => {
        const ids = new Set<string>();
        const starts = (prefix: string) => `${prefix}${scope.companyId}:${encodeURIComponent(scope.actorUid)}:`;
        for (let i = 0; i < port.storage.length; i++) {
            const key = port.storage.key(i);
            if (key)
                for (const prefix of [bodyPrefix, refPrefix])
                    if (key.startsWith(starts(prefix)))
                        ids.add(key.slice(starts(prefix).length));
        }
        const entries: CompanyInfoOperationEntry[] = [];
        for (const id of ids) {
            let ref: CompanyInfoReference | null = null;
            try {
                ref = normalizeCompanyInfoReference({ companyId: scope.companyId, planId: decodeURIComponent(id) });
            }
            catch {
            }
            if (!ref) {
                entries.push({
                    key: bodyPrefix + starts('') + id, reference: null, status: 'corrupt', description: '회사정보 요청 번호 확인 필요', observedLocalText: null, observedReferenceText: null
                });
                continue;
            }
            const s = await snapshot(scope, ref);
            const unchanged = port.storage.getItem(s.key.body) === s.raw && port.storage.getItem(s.key.sidecar) === s.sidecar;
            const fields = s.plan ? Object.keys(s.plan.request.patch).join(', ') : '';
            entries.push({
                key: s.key.body, reference: ref, status: unchanged && s.plan ? 'valid' : s.raw === null ? 'missing' : 'corrupt', description: fields ? `회사정보 수정 · ${fields}` : '회사정보 저장 요청', observedLocalText: s.raw, observedReferenceText: s.sidecar
            });
        }
        return entries;
    };
    const exact = (s: Awaited<ReturnType<typeof snapshot>>) => port.storage.getItem(s.key.body) === s.raw && port.storage.getItem(s.key.sidecar) === s.sidecar;
    const clear = (s: Awaited<ReturnType<typeof snapshot>>) => {
        if (!exact(s))
            throw Error('보관 사본이 바뀌었습니다.');
        if (s.raw !== null)
            port.storage.removeItem(s.key.body);
        if (s.sidecar !== null)
            port.storage.removeItem(s.key.sidecar);
        if (port.storage.getItem(s.key.body) !== null || port.storage.getItem(s.key.sidecar) !== null)
            throw Error('보관 정리를 확인하지 못했습니다.');
    };
    const command = async (input: CompanyInfoReference, context: CompanyInfoContext, mode: 'inspect' | 'cancel' | 'apply'): Promise<CompanyInfoOutcome> => {
        try {
            const s = await snapshot(context, input);
            if (mode === 'apply' && !s.plan)
                return unknown('보관 원문을 읽지 못해 다시 보내지 않았습니다.');
            await active(context);
            if (!exact(s))
                return unknown('보관 사본이 바뀌어 요청을 보내지 않았습니다.');
            const value = await port.command(mode === 'apply' && s.plan ? { mode: 'apply', request: s.plan.request } : { mode: mode === 'apply' ? 'inspect' : mode, reference: s.ref });
            await active(context);
            const result = normalizeCompanyInfoResult(value, s.ref, context.actorUid, mode === 'apply' ? s.plan!.requestHash : undefined);
            if (result.status === 'unknown')
                return unknown(result.message);
            if (s.raw !== null && (!s.plan || result.requestHash !== null && result.requestHash !== s.plan.requestHash) || s.raw === null && result.status === 'applied')
                return {
                    status: 'rejected', requiresReopen: true, message: `이 기기 사본의 완료로 처리하지 않았습니다. ${result.message}`, nextAction: '현재 회사정보를 확인해 주세요. 보관 사본이 있으면 이 기기 사본 정리를 명시적으로 선택할 수 있습니다.'
                };
            try {
                await exclusive(s.key.body, async () => {
                    await active(context);
                    clear(s);
                });
            }
            catch {
                return result.status === 'applied' ? {
                    status: 'partial', reason: 'followup-unconfirmed', committedIds: [s.ref.companyId], unconfirmedIds: [], message: '회사정보는 저장됐지만 기기 사본을 정리하지 못했습니다.', nextAction: '다시 저장하지 말고 같은 요청의 결과 확인으로 정리를 마쳐 주세요.'
                } : { status: result.status === 'cancelled' ? 'cancelled' : 'rejected', message: result.message, nextAction: '기기 사본을 정리하지 못했습니다. 같은 요청의 결과를 다시 확인해 주세요.' };
            }
            return result.status === 'applied' ? { status: 'saved', requestFinalized: true } : {
                status: result.status === 'cancelled' ? 'cancelled' : 'rejected', message: result.message, nextAction: '현재 회사정보를 다시 열어 필요한 항목만 수정해 주세요.', requestFinalized: true, requiresReopen: result.status === 'rejected'
            };
        }
        catch {
            return unknown();
        }
    };
    const open = async (initial: CompanyInfo | null | undefined, context: CompanyInfoOperationContext) => {
        const reference = normalizeCompanyInfoReference({ companyId: context.companyId, planId: context.planId }), opening = companyInfoOpening(initial);
        await active(context);
        const result = normalizeCompanyInfoOpenResult(await port.command({ mode: 'open', reference, opening }), reference, context.actorUid);
        await active(context);
        if (JSON.stringify(result.opening) !== JSON.stringify(opening))
            throw Error('선택한 회사정보가 바뀌었습니다. 현재 자료를 다시 열어 주세요.');
        return result;
    };
    const save = async (patch: Partial<CompanyInfo>, context: CompanyInfoSaveContext): Promise<CompanyInfoOutcome> => {
        try {
            await active(context);
            const reference = normalizeCompanyInfoReference({ companyId: context.companyId, planId: context.planId });
            const opening = normalizeCompanyInfoOpenResult(context.opening, reference, context.actorUid);
            const own = Object.fromEntries(COMPANY_INFO_FIELDS.filter(key => Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined).map(key => [key, patch[key]]));
            const request = normalizeCompanyInfoRequest({
                version: 1, reference, expectedVersion: opening.expectedVersion, patch: own
            });
            const requestHash = await port.digest(serializeCompanyInfoRequest(request));
            await active(context);
            const key = keys(context, reference);
            await exclusive(key.body, async () => {
                await active(context);
                if (port.storage.getItem(key.body) !== null || port.storage.getItem(key.sidecar) !== null)
                    throw Error('이 요청 번호의 보관 사본이 이미 있습니다. 먼저 같은 요청의 결과를 확인해 주세요.');
                const raw = JSON.stringify({
                    version: 1, actorUid: context.actorUid, request, requestHash
                }), sidecar = JSON.stringify({
                    version: 1, actorUid: context.actorUid, reference, requestHash
                });
                port.storage.setItem(key.sidecar, sidecar);
                if (port.storage.getItem(key.sidecar) !== sidecar)
                    throw Error('요청 참조 보관을 확인하지 못했습니다.');
                port.storage.setItem(key.body, raw);
                if (port.storage.getItem(key.body) !== raw || port.storage.getItem(key.sidecar) !== sidecar)
                    throw Error('요청 원문 보관을 확인하지 못했습니다.');
            });
        }
        catch (error) {
            return { status: 'rejected', message: error instanceof Error ? error.message : String(error), nextAction: '요청 목록을 다시 읽어 보관 상태를 확인해 주세요. 서버에는 새 요청을 보내지 않았습니다.' };
        }
        return command({ companyId: context.companyId, planId: context.planId }, context, 'apply');
    };
    const discard = async (input: CompanyInfoReference, observedLocalText: string | null, observedReferenceText: string | null, context: CompanyInfoContext): Promise<CompanyInfoOutcome> => {
        try {
            const s = await snapshot(context, input);
            if (s.raw !== observedLocalText || s.sidecar !== observedReferenceText)
                return { status: 'rejected', message: '관측한 기기 사본이 바뀌어 정리하지 않았습니다.' };
            await active(context);
            const result = normalizeCompanyInfoResult(await port.command({ mode: 'inspect', reference: s.ref }), s.ref, context.actorUid);
            await active(context);
            if (result.status === 'unknown')
                return { status: 'rejected', message: result.message, nextAction: '먼저 미처리 요청 중단으로 요청을 종결해 주세요.' };
            await exclusive(s.key.body, async () => {
                await active(context);
                clear(s);
            });
            return { status: 'saved' };
        }
        catch {
            return unknown('이 기기 사본 정리를 확인하지 못했습니다.');
        }
    };
    const history = async (context: CompanyInfoContext, cursor?: string) => {
        await active(context);
        const result = normalizeCompanyInfoHistoryResult(await port.command({ mode: 'listHistory', companyId: context.companyId, ...(cursor ? { cursor } : {}) }), context.companyId, context.actorUid);
        await active(context);
        return result;
    };
    return {
        references, open, save, inspect: (ref: CompanyInfoReference, context: CompanyInfoContext) => command(ref, context, 'inspect'), retry: (ref: CompanyInfoReference, context: CompanyInfoContext) => command(ref, context, 'apply'), cancel: (ref: CompanyInfoReference, context: CompanyInfoContext) => command(ref, context, 'cancel'), discard, history
    };
}
const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(v => v.toString(16).padStart(2, '0')).join('');
const writer = () => createCompanyInfoWriter({
    storage: localStorage, digest, command: async (command) => (await httpsCallable(functions, 'companyInfoCommand')(command)).data, assertContext: async (context) => {
        const check = () => {
            if (!context.isCurrent() || auth.currentUser?.uid !== context.actorUid)
                throw Error('로그인 계정 또는 회사가 바뀌었습니다.');
        };
        check();
        await authReady;
        check();
        const token = await auth.currentUser!.getIdTokenResult();
        check();
        if (token.claims.companyId !== context.companyId)
            throw Error('현재 회사의 로그인 정보를 확인해 주세요.');
    }
});
export const openCompanyInfo = (initial: CompanyInfo | null | undefined, context: CompanyInfoOperationContext) => writer().open(initial, context);
export const saveCompanyInfo = (patch: Partial<CompanyInfo>, context: CompanyInfoSaveContext) => writer().save(patch, context);
export const readCompanyInfoOperations = (scope: CompanyInfoScope) => writer().references(scope);
export const inspectCompanyInfoOperation = (ref: CompanyInfoReference, context: CompanyInfoContext) => writer().inspect(ref, context);
export const retryCompanyInfoOperation = (ref: CompanyInfoReference, context: CompanyInfoContext) => writer().retry(ref, context);
export const cancelCompanyInfoOperation = (ref: CompanyInfoReference, context: CompanyInfoContext) => writer().cancel(ref, context);
export const discardCompanyInfoCopy = (ref: CompanyInfoReference, text: string | null, referenceText: string | null, context: CompanyInfoContext) => writer().discard(ref, text, referenceText, context);
export const listCompanyInfoHistory = (context: CompanyInfoContext, cursor?: string) => writer().history(context, cursor);
