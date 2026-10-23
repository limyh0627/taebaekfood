// 운영 원문은 비공개 계획에만 보관하고, 종류 14개와 정확한 풍회 화재보험 면세 1개 외에는 쓰지 않는다.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export const PROJECT = 'taebaek-3abe4';
export const FIRE = Object.freeze({ id: 'fct-1790492102540', companyId: 'punghoe', name: '보험료 (화재)', amount: '240600', partnerId: 'c-1786079039448-punghoe' });
export const ROOT = `projects/${PROJECT}/databases/(default)/documents`;
export const TARGET_IDS = Object.freeze(['fct-1787222602711', 'fct-1787223265793', 'fct-1787283396231', 'fct-1788329835682', 'fct-1790488733561', 'fct-1790492102540', 'fct-builtin-elec', 'fct-builtin-ins', 'fct-builtin-lease', 'fct-builtin-rent', 'fct-cesco-mine', 'fct-taebaek-kt-communications', 'fct-taebaek-tax-accountant-fees-transfer', 'fct-taebaek-tax-adjustment-fee-transfer'].sort());
export type Fields = Record<string, unknown>;
export interface TypedDocument {
    name: string;
    fields: Fields;
    updateTime: string;
    createTime?: string;
}
export interface Observation {
    templates: TypedDocument[];
    accounts: TypedDocument[];
    partners: TypedDocument[];
}
export interface Plan {
    version: 2;
    projectId: string;
    createdAt: string;
    operationId: string;
    observation: Observation;
    targets: {
        id: string;
        before: TypedDocument;
        afterFields: Fields;
    }[];
    hash: string;
}
export interface Receipt {
    version: 2;
    planHash: string;
    mode: 'apply' | 'undo';
    state: 'before' | 'after' | 'conflict';
    responseConfirmed: boolean;
    documents: TypedDocument[];
    writeVersions?: string[];
    hash?: string;
}
export interface RestWrite {
    update: {
        name: string;
        fields: Fields;
    };
    updateMask: {
        fieldPaths: string[];
    };
    currentDocument: {
        updateTime: string;
    };
}
export interface Port {
    get(name: string): Promise<TypedDocument | null>;
    commit(writes: RestWrite[]): Promise<unknown>;
}
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function check(value: unknown, message = '승인한 원문 또는 조건이 다릅니다.'): asserts value {
    if (!value)
        throw new Error(message);
}
function field(doc: TypedDocument, key: string, kind = 'stringValue'): unknown { return (doc.fields[key] as Record<string, unknown> | undefined)?.[kind]; }
function id(doc: TypedDocument) { return doc.name.slice(doc.name.lastIndexOf('/') + 1); }
export function nativeVersion(value: string) { check(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value), '나노초 원문 버전이 없습니다.'); const [seconds, fraction = ''] = value.replace('Z', '').split('.'); check(Number.isFinite(Date.parse(seconds + 'Z'))); return { seconds: Date.parse(seconds + 'Z') / 1000, nanoseconds: Number(fraction.padEnd(9, '0')) }; }
function document(doc: TypedDocument, collection: string) { check(doc && doc.name === `${ROOT}/${collection}/${id(doc)}` && !!id(doc) && !id(doc).includes('/')); check(doc.fields && typeof doc.fields === 'object' && !Array.isArray(doc.fields)); nativeVersion(doc.updateTime); }
export function isCandidate(doc: TypedDocument) {
    return field(doc, 'dir') === '대체' && !own(doc.fields, 'statementType') && typeof field(doc, 'partnerId') === 'string' && !!field(doc, 'partnerId') && (!own(doc.fields, 'transferLines') || ((doc.fields.transferLines as {
        arrayValue?: {
            values?: unknown[];
        };
    }).arrayValue !== undefined && ((doc.fields.transferLines as {
        arrayValue: {
            values?: unknown[];
        };
    }).arrayValue.values ?? []).length === 0));
}
function validateReferences(observation: Observation, targets: TypedDocument[]) {
    const partners = new Map(observation.partners.map(p => { document(p, 'partners'); return [id(p), p]; }));
    const needed = new Set(targets.map(t => String(field(t, 'partnerId'))));
    check(partners.size === needed.size && needed.size === 9, '연결 거래처 9개 집합이 다릅니다.');
    for (const target of targets) {
        const company = field(target, 'companyId');
        check(company === 'taebaek' || company === 'punghoe');
        check(field(target, 'kind') === 'voucher' && field(target, 'mode') === '일반' && field(target, 'active', 'booleanValue') === false && field(target, 'autoIssue', 'booleanValue') === false, '비활성 일반전표 조건이 다릅니다.');
        const partner = partners.get(String(field(target, 'partnerId')));
        check(partner && field(partner, 'companyId') === company && typeof field(partner, 'name') === 'string', '같은 회사 거래처를 확인할 수 없습니다.');
        for (const code of [field(target, 'accountCode'), '253']) {
            const matches = observation.accounts.filter(a => field(a, 'companyId') === company && field(a, 'code') === code);
            check(matches.length === 1, '원계정 또는 미지급금 계정이 없거나 중복입니다.');
            document(matches[0], 'accountCodes');
            if (code === '253')
                check(field(matches[0], 'normalBalance') === 'credit', '미지급금 대변 계정이 아닙니다.');
        }
    }
}
function plannedFields(before: TypedDocument): Fields {
    if (id(before) === FIRE.id)
        check(field(before, 'companyId') === FIRE.companyId && field(before, 'name') === FIRE.name && field(before, 'amount', 'integerValue') === FIRE.amount && field(before, 'partnerId') === FIRE.partnerId && field(before, 'taxExempt', 'booleanValue') === false, '풍회 화재보험 면세 원문 조건이 다릅니다.');
    return { ...clone(before.fields), statementType: { stringValue: '매입' }, ...(id(before) === FIRE.id ? { taxExempt: { booleanValue: true } } : {}) };
}
export function buildPlan(observation: Observation): Plan {
    check(observation.templates.length === 102, '최초 전체 템플릿 102개와 다릅니다.');
    const seen = new Set<string>();
    for (const doc of observation.templates) {
        document(doc, 'fixedCostTemplates');
        check(!seen.has(doc.name), '중복 템플릿입니다.');
        seen.add(doc.name);
    }
    const targets = observation.templates.filter(isCandidate).sort((a, b) => id(a).localeCompare(id(b)));
    check(hash(targets.map(id).sort()) === hash(TARGET_IDS), '조건 집합과 고정 14개 대상이 다릅니다.');
    validateReferences(observation, targets);
    const base = { version: 2 as const, projectId: PROJECT, createdAt: new Date().toISOString(), operationId: randomUUID(), observation: clone(observation), targets: targets.map(before => ({ id: id(before), before: clone(before), afterFields: plannedFields(before) })) };
    return { ...base, hash: hash(base) };
}
export function validatePlan(plan: Plan) {
    const { hash: expected, ...body } = plan;
    check(expected === hash(body) && plan.version === 2 && plan.projectId === PROJECT, '계획 해시가 다릅니다.');
    check(hash(plan.targets.map(t => t.id).sort()) === hash(TARGET_IDS));
    check(plan.observation.templates.length === 102);
    const selected = plan.observation.templates.filter(isCandidate);
    check(hash(selected.map(id).sort()) === hash(TARGET_IDS));
    validateReferences(plan.observation, selected);
    for (const t of plan.targets) {
        document(t.before, 'fixedCostTemplates');
        check(id(t.before) === t.id && isCandidate(t.before));
        check(hash(selected.find(d => id(d) === t.id)) === hash(t.before));
        check(hash(t.afterFields) === hash(plannedFields(t.before)));
    }
}
export function writesFor(plan: Plan, mode: 'apply' | 'undo', after?: Receipt): RestWrite[] {
    validatePlan(plan);
    if (mode === 'undo') {
        check(after?.mode === 'apply' && after.planHash === plan.hash && after.state === 'after' && after.responseConfirmed === true, '정상 ACK 영수증이 있어야 되돌릴 수 있습니다.');
        const { hash: receiptHash, ...receiptBody } = after;
        check(receiptHash === hash(receiptBody), '영수증 원문 해시가 다릅니다.');
        check(after.documents.length === 14 && after.writeVersions?.length === 14);
        check(after.documents.every((d, i) => d.updateTime === after.writeVersions![i]));
    }
    return plan.targets.map(t => {
        const current = mode === 'apply' ? t.before : after!.documents.find(d => d.name === t.before.name);
        check(current);
        nativeVersion(current.updateTime);
        if (mode === 'undo')
            check(hash(current.fields) === hash(t.afterFields));
        return { update: { name: t.before.name, fields: mode === 'apply' ? { statementType: { stringValue: '매입' }, ...(t.id === FIRE.id ? { taxExempt: { booleanValue: true } } : {}) } : (t.id === FIRE.id ? { taxExempt: clone(t.before.fields.taxExempt) } : {}) }, updateMask: { fieldPaths: t.id === FIRE.id ? ['statementType', 'taxExempt'] : ['statementType'] }, currentDocument: { updateTime: current.updateTime } };
    });
}
export async function observePlan(plan: Plan, port: Port, mode: 'apply' | 'undo', responseConfirmed = false): Promise<Receipt> {
    validatePlan(plan);
    const docs = await Promise.all(plan.targets.map(t => port.get(t.before.name)));
    let before = true, after = true;
    for (let i = 0; i < docs.length; i++) {
        const doc = docs[i], t = plan.targets[i];
        if (!doc) {
            before = false;
            after = false;
            continue;
        }
        document(doc, 'fixedCostTemplates');
        before &&= hash(doc.fields) === hash(t.before.fields);
        after &&= hash(doc.fields) === hash(t.afterFields);
    }
    return { version: 2, planHash: plan.hash, mode, state: before ? 'before' : after ? 'after' : 'conflict', responseConfirmed, documents: docs.filter((d): d is TypedDocument => !!d) };
}
/** intent는 네트워크보다 먼저 불변 저장한다. 재실행은 관측만 하며 같은 commit을 다시 보내지 않는다. */
export async function execute(plan: Plan, port: Port, mode: 'apply' | 'undo', recordIntent: () => void, after?: Receipt): Promise<Receipt> {
    validatePlan(plan);
    const expected = mode === 'apply' ? plan.targets.map(t => t.before) : after?.documents;
    check(expected?.length === 14);
    if (mode === 'undo')
        writesFor(plan, mode, after);
    const fresh = await Promise.all(expected.map(d => port.get(d.name)));
    for (let i = 0; i < fresh.length; i++)
        check(fresh[i] && hash(fresh[i]) === hash(expected[i]), '원문 또는 나노초 버전이 바뀌어 쓰지 않았습니다.');
    recordIntent();
    let writeVersions: string[] | undefined;
    try {
        const response = await port.commit(writesFor(plan, mode, after)) as {
            writeResults?: {
                updateTime?: string;
            }[];
        };
        if (response?.writeResults?.length === 14) {
            const versions = response.writeResults.map(r => r.updateTime);
            if (versions.every((t): t is string => typeof t === 'string')) {
                versions.forEach(nativeVersion);
                writeVersions = versions;
            }
        }
    }
    catch { /* 응답 유실은 현재 관측만 남기고 ACK 영수증으로 승격하지 않는다. */ }
    const observed = await observePlan(plan, port, mode);
    const desired = mode === 'apply' ? 'after' : 'before';
    const responseConfirmed = !!writeVersions && observed.state === desired && observed.documents.length === 14 && observed.documents.every((d, i) => d.updateTime === writeVersions![i]);
    const body = { ...observed, responseConfirmed, ...(writeVersions ? { writeVersions } : {}) };
    return { ...body, hash: hash(body) };
}
export async function runRepair(plan: Plan, port: Port, mode: 'apply' | 'undo', options: {
    existingIntent?: {
        planHash: string;
        mode: string;
    };
    validateReferences: () => Promise<void>;
    recordIntent: () => void;
}, after?: Receipt) {
    validatePlan(plan);
    if (options.existingIntent) {
        check(options.existingIntent.planHash === plan.hash && options.existingIntent.mode === mode);
        return { observationOnly: true, receipt: await observePlan(plan, port, mode) };
    }
    await options.validateReferences();
    return { observationOnly: false, receipt: await execute(plan, port, mode, options.recordIntent, after) };
}
export function parseArgs(args: string[]) { check(args.every(x => ['--dry', '--apply', '--undo'].includes(x)) && args.length <= 1, '--dry, --apply, --undo 중 하나만 지정합니다.'); return (args[0] ?? '--dry') as '--dry' | '--apply' | '--undo'; }
async function main() {
    const mode = parseArgs(process.argv.slice(2));
    check(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST, '운영 CLI에서 에뮬레이터 혼용을 허용하지 않습니다.');
    const { cliToken } = await import('./diag-zero-item-price-20261015.mts');
    const token = await cliToken();
    const request = async (url: string, init: RequestInit = {}) => {
        const response = await fetch(url, { ...init, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
        if (!response.ok)
            throw new Error('Firestore 요청 실패 HTTP ' + response.status);
        return response.json();
    };
    const list = async (collection: string) => {
        let page = '', docs: TypedDocument[] = [];
        do {
            const result = await request(`https://firestore.googleapis.com/v1/${ROOT}/${collection}?pageSize=300${page ? '&pageToken=' + encodeURIComponent(page) : ''}`) as {
                documents?: TypedDocument[];
                nextPageToken?: string;
            };
            docs.push(...(result.documents ?? []));
            page = result.nextPageToken ?? '';
        } while (page);
        return docs;
    };
    const port: Port = { get: async (name) => {
            const response = await fetch('https://firestore.googleapis.com/v1/' + name, { headers: { Authorization: 'Bearer ' + token } });
            if (response.status === 404)
                return null;
            if (!response.ok)
                throw Error('문서 조회 실패 HTTP ' + response.status);
            return response.json();
        }, commit: writes => request(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:commit`, { method: 'POST', body: JSON.stringify({ writes }) }) };
    const base = resolve('work/template-balance-repair-20261023-v2'), planPath = base + '-plan.json', receiptPath = base + '-receipt.json';
    const preserve = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2), { flag: 'wx' });
    if (mode === '--dry') {
        check(!existsSync(planPath), '최초 백업 계획을 덮어쓰지 않습니다.');
        const templates = await list('fixedCostTemplates'), accounts = await list('accountCodes');
        const approvedSnapshot = JSON.parse(readFileSync(resolve('work/template-balance-readonly-20261023-snapshot.json'), 'utf8').replace(/^\uFEFF/, '')) as {
            collections: {
                fixedCostTemplates: TypedDocument[];
            };
        };
        const selected = templates.filter(isCandidate);
        check(hash(selected.map(id).sort()) === hash(TARGET_IDS), '조건 집합이 고정14와 다릅니다.');
        for (const target of selected)
            check(hash(approvedSnapshot.collections.fixedCostTemplates.find(d => d.name === target.name)) === hash(target), '검토한 최초 원문과 현재 원문이 다릅니다.');
        const partnerIds = [...new Set(templates.filter(isCandidate).map(t => String(field(t, 'partnerId'))))];
        const partners = await Promise.all(partnerIds.map(x => port.get(`${ROOT}/partners/${x}`)));
        check(partners.every(Boolean));
        const plan = buildPlan({ templates, accounts, partners: partners as TypedDocument[] });
        const approved = JSON.parse(readFileSync(resolve('work/template-balance-readonly-20261023-snapshot.json'), 'utf8').replace(/^\uFEFF/, '')) as {
            collections: {
                fixedCostTemplates: TypedDocument[];
            };
        };
        for (const t of plan.targets)
            check(hash(approved.collections.fixedCostTemplates.find(d => d.name === t.before.name)) === hash(t.before), '검토한 최초 원문과 현재 원문이 다릅니다.');
        preserve(planPath, plan);
        console.log(JSON.stringify({ mode: 'dry', targets: 14, partners: 9, planHash: plan.hash, planPath, operatingWrites: 0 }));
        return;
    }
    check(existsSync(planPath), '최초 백업 계획이 없습니다.');
    const plan = JSON.parse(readFileSync(planPath, 'utf8')) as Plan;
    validatePlan(plan);
    const direction = mode === '--apply' ? 'apply' : 'undo', intentPath = base + '-' + direction + '-intent.json', resultPath = direction === 'apply' ? receiptPath : base + '-undo-receipt.json';
    const existingIntent = existsSync(intentPath) ? JSON.parse(readFileSync(intentPath, 'utf8')) as {
        planHash: string;
        mode: string;
    } : undefined;
    const after = direction === 'undo' && !existingIntent ? JSON.parse(readFileSync(receiptPath, 'utf8')) as Receipt : undefined;
    const result = await runRepair(plan, port, direction, { existingIntent, recordIntent: () => preserve(intentPath, { version: 2, planHash: plan.hash, mode: direction, at: new Date().toISOString() }), validateReferences: async () => {
            const currentPartners = await Promise.all(plan.observation.partners.map(p => port.get(p.name)));
            check(currentPartners.every(Boolean));
            validateReferences({ templates: plan.observation.templates, accounts: await list('accountCodes'), partners: currentPartners as TypedDocument[] }, plan.targets.map(t => t.before));
        } }, after);
    const receipt = result.receipt;
    if (result.observationOnly) {
        const path = base + '-' + direction + '-observation-' + Date.now() + '.json';
        preserve(path, receipt);
        console.log(JSON.stringify({ mode: direction, resent: false, state: receipt.state, observation: path }));
        return;
    }
    preserve(base + '-' + direction + '-outcome.json', receipt);
    if (receipt.responseConfirmed)
        preserve(resultPath, receipt);
    console.log(JSON.stringify({ mode: direction, resent: false, state: receipt.state, responseConfirmed: receipt.responseConfirmed, receiptPath: receipt.responseConfirmed ? resultPath : null }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
    main().catch(() => { console.error('전표 템플릿 정정을 완료하지 못했습니다. 비공개 계획·intent와 현재 상태를 확인하세요. 토큰과 원문은 출력하지 않습니다.'); process.exitCode = 1; });
