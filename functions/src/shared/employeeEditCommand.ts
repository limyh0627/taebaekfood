import { encodeCatalogValue, type CatalogValue, type CatalogValueAdapter } from './catalogOrderReferenceProof';
import { cleanupValidId } from './partnerItemCleanup';
import {documentId} from './documentId';
export type { CatalogValue, CatalogValueAdapter } from './catalogOrderReferenceProof';
export const EMPLOYEE_EDIT_OPERATIONS = 'employeeEditOperations';
export const EMPLOYEE_PROFILE_FIELDS = ['name', 'position', 'department', 'joinDate', 'birthDate', 'phone', 'status', 'healthCertDate'] as const;
export const EMPLOYEE_BALANCE_FIELDS = ['carryOverLeave', 'bonusLeave'] as const;
export interface EmployeeBalanceDraft {
    carryOverLeave: number;
    bonusLeave: number;
}
export type EmployeeProfileDraft = Record<typeof EMPLOYEE_PROFILE_FIELDS[number], string> & {
    annualLeave: EmployeeBalanceDraft;
};
export interface EmployeeEditReference {
    companyId: 'taebaek' | 'punghoe';
    planId: string;
    targetId: string;
}
type Base = EmployeeEditReference & {
    version: 1;
};
export type EmployeeEditRequest = Base & ({
    kind: 'create';
    expected: null;
    profile: EmployeeProfileDraft;
} | {
    kind: 'profile';
    expected: CatalogValue;
    profile: EmployeeProfileDraft;
} | {
    kind: 'balance';
    expected: CatalogValue;
    balance: EmployeeBalanceDraft;
});
export type EmployeeEditCommand = {
    mode: 'apply';
    request: EmployeeEditRequest;
} | {
    mode: 'inspect' | 'cancel';
    reference: EmployeeEditReference;
    requestHash?: string;
};
export interface EmployeeEditResult extends EmployeeEditReference {
    actorUid: string;
    requestHash: string | null;
    status: 'applied' | 'duplicate' | 'rejected' | 'cancelled' | 'unknown';
    message: string;
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function exact(value: unknown, fields: readonly string[]): asserts value is Record<string, unknown> { if (!record(value) || Object.keys(value).some(key => !fields.includes(key)))
    throw Error('직원 저장 요청 형식을 확인해 주세요.'); }
const own = (value: Record<string, unknown>, fields: readonly string[]) => Object.fromEntries(fields.filter(field => Object.prototype.hasOwnProperty.call(value, field)).map(field => [field, value[field]]));
/** 폼 기본값을 섞지 않고 열림 원문의 필드 존재성과 연차 두 값만 비교한다. */
export function employeeEditExpected(row: Record<string, unknown>, kind: 'profile' | 'balance', codec?: Pick<CatalogValueAdapter, 'special'>): CatalogValue {
    const result = own(row, kind === 'profile' ? EMPLOYEE_PROFILE_FIELDS : []);
    if (Object.prototype.hasOwnProperty.call(row, 'annualLeave'))
        result.annualLeave = record(row.annualLeave) ? own(row.annualLeave, EMPLOYEE_BALANCE_FIELDS) : row.annualLeave;
    return encodeCatalogValue(result, codec);
}
export function normalizeEmployeeEditReference(value: unknown): EmployeeEditReference {
    exact(value, ['companyId', 'planId', 'targetId']);
    if (!['taebaek', 'punghoe'].includes(String(value.companyId)) || !cleanupValidId(value.planId) || !documentId(value.targetId))
        throw Error('직원 저장의 회사·계획·대상을 확인해 주세요.');
    return { companyId: value.companyId as EmployeeEditReference['companyId'], planId: value.planId, targetId: value.targetId };
}
function balance(value: unknown): EmployeeBalanceDraft {
    exact(value, EMPLOYEE_BALANCE_FIELDS);
    if (EMPLOYEE_BALANCE_FIELDS.some(field => typeof value[field] !== 'number' || !Number.isFinite(value[field])))
        throw Error('이월·추가 연차 값을 확인해 주세요.');
    return { carryOverLeave: value.carryOverLeave as number, bonusLeave: value.bonusLeave as number };
}
const hashOk = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function normalizeEmployeeEditRequest(value: unknown): EmployeeEditRequest {
    exact(value, ['version', 'companyId', 'planId', 'targetId', 'kind', 'expected', 'profile', 'balance']);
    const reference = normalizeEmployeeEditReference({ companyId: value.companyId, planId: value.planId, targetId: value.targetId });
    if (value.version !== 1 || !['create', 'profile', 'balance'].includes(String(value.kind)))
        throw Error('직원 저장 계약 버전·종류를 확인해 주세요.');
    if (value.kind === 'create' ? value.expected !== null : !Array.isArray(value.expected) || value.expected[0] !== 'map')
        throw Error('직원을 열 때 확인한 원문을 보존해 주세요.');
    let result: EmployeeEditRequest;
    if (value.kind === 'balance') {
        if (Object.prototype.hasOwnProperty.call(value, 'profile'))
            throw Error('연차 조정에 직원 정보를 함께 보낼 수 없습니다.');
        result = { version: 1, ...reference, kind: 'balance', expected: value.expected as CatalogValue, balance: balance(value.balance) };
    }
    else {
        if (Object.prototype.hasOwnProperty.call(value, 'balance'))
            throw Error('직원 저장 입력 종류가 다릅니다.');
        exact(value.profile, [...EMPLOYEE_PROFILE_FIELDS, 'annualLeave']);
        const rawProfile = value.profile;
        if (EMPLOYEE_PROFILE_FIELDS.some(field => typeof rawProfile[field] !== 'string'))
            throw Error('직원 정보의 문자 입력을 확인해 주세요.');
        const profile = { ...own(value.profile, EMPLOYEE_PROFILE_FIELDS), annualLeave: balance(value.profile.annualLeave) } as EmployeeProfileDraft;
        result = value.kind === 'create' ? { version: 1, ...reference, kind: 'create', expected: null, profile } : { version: 1, ...reference, kind: 'profile', expected: value.expected as CatalogValue, profile };
    }
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 256 * 1024)
        throw Error('직원 편집 원문이 너무 큽니다.');
    return result;
}
export const serializeEmployeeEditRequest = (value: unknown): string => JSON.stringify(normalizeEmployeeEditRequest(value));
export function normalizeEmployeeEditResult(value: unknown, reference: EmployeeEditReference, actorUid: string, expectedHash?: string): EmployeeEditResult {
    exact(value, ['companyId', 'planId', 'targetId', 'actorUid', 'requestHash', 'status', 'message']);
    if (value.companyId !== reference.companyId || value.planId !== reference.planId || value.targetId !== reference.targetId || value.actorUid !== actorUid || !['applied', 'duplicate', 'rejected', 'cancelled', 'unknown'].includes(String(value.status)) || typeof value.message !== 'string')
        throw Error('직원 저장 결과의 회사·계정·대상을 확인해 주세요.');
    if (!(hashOk(value.requestHash) || value.requestHash === null) || value.requestHash === null && !['cancelled', 'unknown'].includes(String(value.status)) || value.status === 'unknown' && value.requestHash !== null || expectedHash !== undefined && value.requestHash !== null && value.requestHash !== expectedHash)
        throw Error('직원 저장 최초 원문 해시를 확인해 주세요.');
    return { ...reference, actorUid, requestHash: value.requestHash as string | null, status: value.status as EmployeeEditResult['status'], message: value.message };
}
