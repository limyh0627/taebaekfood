import { httpsCallable } from 'firebase/functions';
import { accountManagementOpening, normalizeAccountManagementReference, normalizeAccountManagementRequest, normalizeAccountManagementOpenResult, normalizeAccountManagementResult, serializeAccountManagementRequest, type AccountManagementReference, type AccountManagementRequest, type AccountManagementCommand, type AccountManagementOpenResult } from '../../../shared/accountManagementCommand';
export type { AccountManagementReference } from '../../../shared/accountManagementCommand';
import { auth, authReady, functions } from '../../../shared/firebase';
import { withClaimCompany } from '../../../shared/companyWriteBoundary';
import type { AccountCode, AccountGroup, CompanyId } from '../../../shared/types';
import type { SaveOutcome } from '../../../shared/saveOutcome';
export interface AccountEditContext {
    companyId: CompanyId;
    actorUid: string;
    isCurrent: () => boolean;
}
export type AccountGroupEditPatch = Partial<Pick<AccountGroup, 'name' | 'type'>> & {
    plLine?: AccountGroup['plLine'] | null;
};
export type AccountCodeEditPatch = Partial<Pick<AccountCode, 'code' | 'name' | 'groupId'>>;
async function authorizeAccountWrite(collection: 'accountGroups' | 'accountCodes', id: string, context: AccountEditContext): Promise<(() => void) | SaveOutcome> {
    const assertCurrent = () => {
        if (!context.isCurrent() || !context.actorUid || auth.currentUser?.uid !== context.actorUid) {
            throw new Error('로그인 또는 회사가 바뀌어 저장하지 않았습니다. 창을 다시 열어 주세요.');
        }
    };
    try {
        if (!id || id.includes('/'))
            throw new Error('대상 계정을 확인할 수 없어 처리하지 않았습니다.');
        assertCurrent();
        await authReady;
        assertCurrent();
        const token = await auth.currentUser!.getIdTokenResult();
        assertCurrent();
        withClaimCompany(collection, { companyId: context.companyId }, { companyId: token.claims.companyId });
    }
    catch (error) {
        return { status: 'rejected', message: error instanceof Error ? error.message : '로그인 정보를 확인해 주세요.' };
    }
    return assertCurrent;
}
export interface AccountOperationContext extends AccountEditContext {
    planId: string;
}
export type AccountEditOutcome = SaveOutcome & {requiresReopen?:boolean;requestFinalized?:boolean};
export interface AccountUpdateContext extends AccountOperationContext {
    opening: AccountManagementOpenResult;
}
export type { AccountManagementOpenResult };
export interface AccountOperationScope {
    companyId: CompanyId;
    actorUid: string;
}
export interface AccountOperationReferenceEntry {
    key: string;
    reference: AccountManagementReference | null;
    status: 'valid' | 'corrupt' | 'missing';
    description: string;
    action?: AccountManagementRequest['action'];
    observedLocalText?: string | null;
}
interface AccountOperationPlan {
    version: 1;
    actorUid: string;
    request: AccountManagementRequest;
    requestHash: string;
    description: string;
}
export type AccountOperationRead = {
    status: 'valid';
    request: AccountManagementRequest;
    requestHash: string;
    description: string;
    observedLocalText: string;
} | {
    status: 'corrupt' | 'missing';
};
export interface AccountOperationPort {
    storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
    assertContext(context: AccountEditContext): Promise<void>;
    command(command: AccountManagementCommand): Promise<unknown>;
    digest(text: string): Promise<string>;
}
const prefix = 'account-operation-v1:';
const scopePrefix = (scope: AccountOperationScope) => `${prefix}${scope.companyId}:${encodeURIComponent(scope.actorUid)}:`;
const operationKey = (scope: AccountOperationScope, ref: AccountManagementReference) => `${scopePrefix(scope)}${ref.kind}:${encodeURIComponent(ref.targetId)}:${encodeURIComponent(ref.planId)}`;
const sameReference = (a: AccountManagementReference, b: AccountManagementReference) => a.companyId === b.companyId && a.kind === b.kind && a.targetId === b.targetId && a.planId === b.planId;
const unknownAccountOperation = (message = '계정 처리 결과를 확인하지 못했습니다.'): SaveOutcome => ({ status: 'unknown', message, nextAction: '같은 요청의 결과 확인 또는 명시 중단을 선택해 주세요. 새로 등록하거나 삭제하지 마세요.' });
export function createAccountOperationWriter(port: AccountOperationPort) {
    const parse = async (scope: AccountOperationScope, input: AccountManagementReference, raw: string | null): Promise<AccountOperationRead> => {
        const ref = normalizeAccountManagementReference(input);
        if (ref.companyId !== scope.companyId)
            return { status: 'corrupt' };
        if (raw === null)
            return { status: 'missing' };
        try {
            const plan = JSON.parse(raw) as AccountOperationPlan;
            const request = normalizeAccountManagementRequest(plan.request);
            if (plan.version !== 1 || plan.actorUid !== scope.actorUid || !sameReference(request.reference, ref)
                || typeof plan.description !== 'string' || !/^[a-f0-9]{64}$/.test(plan.requestHash)
                || await port.digest(serializeAccountManagementRequest(request)) !== plan.requestHash)
                return { status: 'corrupt' };
            return { status: 'valid', request, requestHash: plan.requestHash, description: plan.description, observedLocalText: raw };
        }
        catch {
            return { status: 'corrupt' };
        }
    };
    const read = async (scope: AccountOperationScope, input: AccountManagementReference): Promise<AccountOperationRead> => {
        try { return await parse(scope, input, port.storage.getItem(operationKey(scope, input))); } catch { return {status:'corrupt'}; }
    };
    const references = async (scope: AccountOperationScope): Promise<AccountOperationReferenceEntry[]> => {
        const entries: AccountOperationReferenceEntry[] = [];
        const keys: string[] = [];
        for (let i = 0; i < port.storage.length; i++) {
            const key = port.storage.key(i);
            if (key?.startsWith(scopePrefix(scope)))
                keys.push(key);
        }
        for (const key of keys) {
            let reference: AccountManagementReference | null = null;
            try {
                const parts = key.slice(scopePrefix(scope).length).split(':');
                if (parts.length !== 3)
                    throw Error();
                reference = normalizeAccountManagementReference({ companyId: scope.companyId, kind: parts[0], targetId: decodeURIComponent(parts[1]), planId: decodeURIComponent(parts[2]) });
                if (operationKey(scope, reference) !== key)
                    throw Error();
            }
            catch {
                reference = null;
            }
            const observedLocalText = port.storage.getItem(key);
            const value = reference ? await parse(scope, reference, observedLocalText) : { status: 'corrupt' as const };
            entries.push({ key, reference, status: port.storage.getItem(key) === observedLocalText ? value.status : 'corrupt', action: value.status === 'valid' ? value.request.action : undefined, observedLocalText, description: value.status === 'valid' ? value.description : reference ? `계정 처리 · ${reference.targetId}` : '보관 요청 형식 확인 필요' });
        }
        return entries;
    };
    const active = async (context: AccountEditContext) => {
        if (!context.isCurrent())
            throw Error('계정 화면이 바뀌었습니다.');
        await port.assertContext(context);
        if (!context.isCurrent())
            throw Error('계정 화면이 바뀌었습니다.');
    };
    const run = async (refInput: AccountManagementReference, context: AccountEditContext, mode: 'apply' | 'inspect' | 'cancel'): Promise<AccountEditOutcome> => {
        const ref = normalizeAccountManagementReference(refInput);
        if (ref.companyId !== context.companyId)
            return { status: 'rejected', message: '현재 회사의 요청만 처리할 수 있습니다.' };
        const scope: AccountOperationScope = context;
        const key = operationKey(scope, ref);
        let raw: string | null;
        try {
            await active(context);
            raw = port.storage.getItem(key);
        }
        catch {
            return unknownAccountOperation();
        }
        const stored = await parse(scope, ref, raw);
        if (mode === 'apply' && stored.status !== 'valid')
            return unknownAccountOperation();
        try {
            await active(context);
            if (port.storage.getItem(key) !== raw)
                return unknownAccountOperation();
            const response = await port.command(mode === 'apply' && stored.status === 'valid'
                ? { mode: 'apply', request: stored.request }
                : { mode: mode === 'apply' ? 'inspect' : mode, reference: ref });
            await active(context);
            const result = normalizeAccountManagementResult(response, ref, context.actorUid, mode === 'apply' && stored.status === 'valid' ? stored.requestHash : undefined);
            if (result.status === 'unknown')
                return unknownAccountOperation(result.message);
            if (raw !== null && (stored.status !== 'valid' || result.requestHash !== null && stored.requestHash !== result.requestHash) || raw === null && result.status === 'applied')
                return {
                    status: 'rejected', message: `같은 요청 번호로 다른 내용이 먼저 확정되어 이 기기의 사본은 적용할 수 없습니다. ${result.message}`,
                    nextAction: '현재 계정 목록을 확인해 주세요. 원문이 없거나 다른 사본의 결과를 현재 편집의 완료로 처리하지 않았습니다. 보관 사본이 있으면 해당 사본만 명시적으로 정리할 수 있습니다.'
                };
            const outcome: AccountEditOutcome = result.status === 'applied' ? { status: 'saved' }
                : { status: result.status === 'cancelled' ? 'cancelled' : 'rejected', message: result.message, requiresReopen: result.status === 'rejected', nextAction: '현재 목록을 확인한 뒤 필요한 작업을 선택해 주세요.' };
            try {
                const current = port.storage.getItem(key);
                if (current !== null && current !== raw)
                    throw Error('보관 원문이 바뀌었습니다.');
                if (current !== null)
                    port.storage.removeItem(key);
                if (port.storage.getItem(key) !== null)
                    throw Error('보관 정리를 확인하지 못했습니다.');
            }
            catch {
                if (result.status === 'applied')
                    return { status: 'partial', reason: 'followup-unconfirmed', committedIds: [ref.targetId], unconfirmedIds: [], message: '계정 처리는 완료됐지만 기기의 보관 요청 정리가 완료되지 않았습니다.', nextAction: '업무를 다시 보내지 말고 결과 확인으로 보관 요청을 정리해 주세요.' };
                return { status: result.status === 'cancelled' ? 'cancelled' : 'rejected', message: result.message, nextAction: '보관 요청을 정리하지 못했습니다. 같은 요청의 결과 확인을 다시 선택해 주세요.' };
            }
            return stored.status==='valid'&&stored.request.action==='update'||raw===null&&result.status==='cancelled'?{...outcome,requestFinalized:true}:outcome;
        }
        catch {
            return unknownAccountOperation();
        }
    };
    const submit = async (kind: 'code' | 'group', action: 'create' | 'delete', data: AccountCode | AccountGroup, context: AccountOperationContext): Promise<SaveOutcome> => {
        data = { ...data };
        let reference: AccountManagementReference;
        try {
            reference = normalizeAccountManagementReference({ companyId: context.companyId, planId: context.planId, targetId: data.id, kind });
        }
        catch {
            return { status: 'rejected', message: '고정 요청 번호와 대상 계정을 확인해 주세요.' };
        }
        const scope: AccountOperationScope = context;
        const key = operationKey(scope, reference);
        try {
            await active(context);
            if (port.storage.getItem(key) !== null)
                return unknownAccountOperation();
            let request: AccountManagementRequest;
            if (action === 'delete') {
                const opening = accountManagementOpening({ ...data }, kind);
                const opened = normalizeAccountManagementOpenResult(await port.command({ mode: 'open', reference, opening }), reference, context.actorUid);
                await active(context);
                if (JSON.stringify(opened.opening) !== JSON.stringify(opening))
                    throw Error('선택한 계정이 바뀌었습니다. 다시 열어 주세요.');
                request = normalizeAccountManagementRequest({ version: 1, reference, action, expectedVersion: opened.expectedVersion });
            }
            else {
                const fields = kind === 'code' ? ['id', 'code', 'name', 'groupId'] : ['id', 'name', 'type', 'plLine'];
                const body = Object.fromEntries(fields.filter(field => Object.prototype.hasOwnProperty.call(data, field) && (data as unknown as Record<string, unknown>)[field] !== undefined).map(field => [field, (data as unknown as Record<string, unknown>)[field]]));
                request = normalizeAccountManagementRequest({ version: 1, reference, action, expectedVersion: null, data: body });
            }
            const requestHash = await port.digest(serializeAccountManagementRequest(request));
            await active(context);
            const raw = JSON.stringify({ version: 1, actorUid: context.actorUid, request, requestHash, description: `${action === 'create' ? '등록' : '삭제'} · ${data.name || data.id}` } satisfies AccountOperationPlan);
            if (port.storage.getItem(key) !== null)
                return unknownAccountOperation();
            port.storage.setItem(key, raw);
            if (port.storage.getItem(key) !== raw)
                throw Error('브라우저 보관 원문을 확인하지 못했습니다.');
        }
        catch (error) {
            return { status: 'rejected', message: `업무 요청을 보내기 전에 준비를 완료하지 못했습니다. ${error instanceof Error ? error.message : String(error)}`, nextAction: '입력과 브라우저 저장소를 확인해 주세요. 보관 요청이 남아 있다면 결과 확인 또는 중단을 먼저 선택해 주세요.' };
        }
        return run(reference, context, 'apply');
    };
    const discard = async (input: AccountManagementReference, observedLocalText: string, context: AccountEditContext): Promise<SaveOutcome> => {
        const reference = normalizeAccountManagementReference(input);
        if (reference.companyId !== context.companyId || typeof observedLocalText !== 'string')
            return { status: 'rejected', message: '정리할 보관 사본과 현재 회사를 확인해 주세요.' };
        try {
            await active(context);
            const response = await port.command({ mode: 'inspect', reference });
            await active(context);
            const result = normalizeAccountManagementResult(response, reference, context.actorUid);
            if (result.status === 'unknown')
                return { status: 'rejected', message: result.message, nextAction: '아직 처리 여부가 확인되지 않아 사본을 지우지 않았습니다. 먼저 미처리 요청 중단을 선택해 주세요.' };
            const key = operationKey(context, reference);
            if (port.storage.getItem(key) !== observedLocalText)
                return { status: 'rejected', message: '보관 사본이 바뀌어 정리하지 않았습니다. 요청 목록을 다시 읽어 주세요.' };
            port.storage.removeItem(key);
            if (port.storage.getItem(key) !== null)
                throw Error('보관 사본을 정리하지 못했습니다.');
            return { status: 'saved' };
        }
        catch {
            return { status: 'unknown', message: '이 기기 사본 정리를 확인하지 못했습니다.', nextAction: '요청 목록을 다시 읽고 현재 사본을 확인해 주세요. 업무를 다시 보내지 마세요.' };
        }
    };
    const open = async (kind: 'code'|'group', row: AccountCode|AccountGroup, context: AccountOperationContext): Promise<AccountManagementOpenResult> => {
        const reference=normalizeAccountManagementReference({companyId:context.companyId,planId:context.planId,kind,targetId:row.id});
        const opening=accountManagementOpening({...row},kind);
        await active(context);
        const result=normalizeAccountManagementOpenResult(await port.command({mode:'open',reference,opening}),reference,context.actorUid);
        await active(context);
        if(JSON.stringify(result.opening)!==JSON.stringify(opening))throw Error('열기 중 계정이 바뀌었습니다. 현재 목록을 확인하고 다시 열어 주세요.');
        return result;
    };
    const update = async (kind:'code'|'group', id:string, changes:AccountGroupEditPatch|AccountCodeEditPatch, context:AccountUpdateContext):Promise<AccountEditOutcome> => {
        let request:AccountManagementRequest;
        let raw:string;
        try {
            await active(context);
            const reference=normalizeAccountManagementReference({companyId:context.companyId,planId:context.planId,kind,targetId:id});
            const opening=normalizeAccountManagementOpenResult(context.opening,reference,context.actorUid);
            const fields=kind==='code'?['code','name','groupId']:['name','type','plLine'];
            const patch=Object.fromEntries(fields.filter(key=>Object.prototype.hasOwnProperty.call(changes,key)&&(changes as Record<string,unknown>)[key]!==undefined).map(key=>[key,(changes as Record<string,unknown>)[key]]));
            request=normalizeAccountManagementRequest({version:1,reference,action:'update',expectedVersion:opening.expectedVersion,patch});
            const requestHash=await port.digest(serializeAccountManagementRequest(request));
            await active(context);
            const key=operationKey(context,reference);
            if(port.storage.getItem(key)!==null)return unknownAccountOperation();
            raw=JSON.stringify({version:1,actorUid:context.actorUid,request,requestHash,description:'수정 · '+id} satisfies AccountOperationPlan);
            port.storage.setItem(key,raw);
            if(port.storage.getItem(key)!==raw)throw Error('브라우저 보관 원문을 확인하지 못했습니다.');
        } catch(error) {return {status:'rejected',message:'편집 요청을 보내기 전에 준비를 완료하지 못했습니다. '+(error instanceof Error?error.message:String(error)),nextAction:'보관 요청이 남았다면 결과 확인 또는 중단을 먼저 선택해 주세요.'};}
        return run(request.reference,context,'apply');
    };
    return { read, references, submit, open, update, discard, inspect: (ref: AccountManagementReference, context: AccountEditContext) => run(ref, context, 'inspect'), retry: (ref: AccountManagementReference, context: AccountEditContext) => run(ref, context, 'apply'), cancel: (ref: AccountManagementReference, context: AccountEditContext) => run(ref, context, 'cancel') };
}
const digestAccountOperation = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), value => value.toString(16).padStart(2, '0')).join('');
// 브라우저가 저장소 접근 자체를 거절해도 준비 단계에서 포착하고 업무 송신 전 거절로 구분한다.
const operationWriter = () => createAccountOperationWriter({ storage: {
        get length() { return localStorage.length; }, key: index => localStorage.key(index),
        getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key),
    }, digest: digestAccountOperation,
    assertContext: async (context) => {
        const result = await authorizeAccountWrite('accountCodes', 'operation', context);
        if (typeof result !== 'function')
            throw Error(result.status === 'saved' ? '로그인을 확인해 주세요.' : result.message);
        result();
    },
    command: async (command) => (await httpsCallable<AccountManagementCommand, unknown>(functions, 'accountManagementCommand')(command)).data });
export const readAccountOperationReferences = (scope: AccountOperationScope) => operationWriter().references(scope);
export const readAccountOperation = (scope: AccountOperationScope, ref: AccountManagementReference) => operationWriter().read(scope, ref);
export const inspectAccountOperation = (ref: AccountManagementReference, context: AccountEditContext) => operationWriter().inspect(ref, context);
export const retryAccountOperation = (ref: AccountManagementReference, context: AccountEditContext) => operationWriter().retry(ref, context);
export const discardAccountOperationCopy = (ref: AccountManagementReference, observedLocalText: string, context: AccountEditContext) => operationWriter().discard(ref, observedLocalText, context);
export const cancelAccountOperation = (ref: AccountManagementReference, context: AccountEditContext) => operationWriter().cancel(ref, context);
export const saveAccountCodeCreate = (data: AccountCode, context: AccountOperationContext) => operationWriter().submit('code', 'create', data, context);
export const saveAccountGroupCreate = (data: AccountGroup, context: AccountOperationContext) => operationWriter().submit('group', 'create', data, context);
export const deleteAccountCode = (opening: AccountCode, context: AccountOperationContext) => operationWriter().submit('code', 'delete', opening, context);
export const deleteAccountGroup = (opening: AccountGroup, context: AccountOperationContext) => operationWriter().submit('group', 'delete', opening, context);

export const captureAccountEditOpening=(kind:'code'|'group',row:AccountCode|AccountGroup,context:AccountOperationContext)=>operationWriter().open(kind,row,context);
export const saveAccountGroupEdit=(id:string,patch:AccountGroupEditPatch,context:AccountUpdateContext)=>operationWriter().update('group',id,patch,context);
export const saveAccountCodeEdit=(id:string,patch:AccountCodeEditPatch,context:AccountUpdateContext)=>operationWriter().update('code',id,patch,context);
