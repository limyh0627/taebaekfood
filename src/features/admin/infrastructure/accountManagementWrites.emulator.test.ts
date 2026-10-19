import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { executeAccountManagementCommand, accountManagementReceiptId } from '../../../../functions/src/accountManagementCommand';
import type { AccountManagementCommand } from '../../../shared/accountManagementCommand';
import type { AccountCode, AccountGroup } from '../../../shared/types';
const state = vi.hoisted(() => ({ db: null as unknown, uid: 'account-editor', command: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => async (command: AccountManagementCommand) => ({ data: await state.command(command) }) }));
vi.mock('../../../shared/firebase', () => ({ get db() { return state.db; }, functions: {},
  authReady: Promise.resolve(), auth: { get currentUser() { return { uid: state.uid,
    getIdTokenResult: async () => ({ claims: { companyId: 'taebaek', employeeId: 'account-employee', isAdmin: true } }),
  }; } } }));
import { saveAccountCodeEdit, saveAccountGroupEdit, saveAccountCodeCreate, saveAccountGroupCreate,
  deleteAccountCode, deleteAccountGroup } from './accountManagementWrites';
const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8182';
describe.skipIf(!enabled)('계정 수정 실제 공통 writer와 Rules', () => {
  const projectId = `demo-account-${randomUUID().slice(0, 8)}`;
  const prefix = randomUUID();
  let env: RulesTestEnvironment;
  let serverApp: admin.app.App;
  const touched: { collection: string; id: string }[] = [];
  const context = { companyId: 'taebaek' as const, actorUid: state.uid, isCurrent: () => true };
  const seed = async (collection: string, id: string, data: Record<string, unknown>) => {
    touched.push({ collection, id });
    await env.withSecurityRulesDisabled(async c => setDoc(doc(c.firestore(), collection, id), data));
  };
  const read = async (collection: string, id: string) => {
    let data: Record<string, unknown> | undefined;
    await env.withSecurityRulesDisabled(async c => { data = (await getDoc(doc(c.firestore(), collection, id))).data(); });
    return data;
  };
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8182,
      rules: readFileSync('firestore.rules', 'utf8') } });
    state.db = env.authenticatedContext(state.uid, { companyId: 'taebaek', employeeId: 'account-employee', isAdmin: true }).firestore();
    serverApp = admin.initializeApp({ projectId }, `${projectId}-server`);
    const serverDb = admin.firestore(serverApp);
    await seed('employees', 'account-employee', { companyId: 'taebaek', name: '합성 관리자' });
    const map = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      get length() { return map.size; }, key: (index: number) => Array.from(map.keys())[index] ?? null,
      getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); },
    } });
    state.command.mockImplementation(async (command: AccountManagementCommand) => {
      const reference = command.mode === 'apply' ? command.request.reference : command.reference;
      if (command.mode !== 'open') touched.push({ collection: 'accountManagementOperations', id: accountManagementReceiptId(reference.companyId, state.uid, reference.planId) });
      return executeAccountManagementCommand(serverDb, { uid: state.uid, token: { companyId: 'taebaek', employeeId: 'account-employee', isAdmin: true } }, command);
    });
  });
  afterAll(async () => {
    if (!env) return;
    await env.withSecurityRulesDisabled(async c => {
      for (const row of touched) await deleteDoc(doc(c.firestore(), row.collection, row.id));
    });
    await env.cleanup();
    await serverApp?.delete();
  });
  it('기존 sgna는 명시 null로 실제 제거하고 현금흐름·메모·미지 필드는 유지한다', async () => {
    const id = `${prefix}-clear`;
    await seed('accountGroups', id, { companyId: 'taebaek', name: '판관비', type: '비용', plLine: 'sgna',
      cfSection: 'operating', note: '보존', legacy: { value: 7 } });
    expect(await saveAccountGroupEdit(id, { plLine: null }, context)).toEqual({ status: 'saved' });
    expect(await read('accountGroups', id)).toEqual({ companyId: 'taebaek', name: '판관비', type: '비용',
      cfSection: 'operating', note: '보존', legacy: { value: 7 } });
  });
  it('생략과 undefined는 기존 손익 위치를 유지하고 코드 수정도 다른 필드를 보존한다', async () => {
    const group = `${prefix}-omit`, code = `${prefix}-code`;
    await seed('accountGroups', group, { companyId: 'taebaek', name: '이전', type: '비용', plLine: 'sgna', note: '보존' });
    expect((await saveAccountGroupEdit(group, { name: '변경', plLine: undefined }, context)).status).toBe('saved');
    expect(await read('accountGroups', group)).toMatchObject({ name: '변경', plLine: 'sgna', note: '보존' });
    await seed('accountCodes', code, { companyId: 'taebaek', code: '500', name: '기존', groupId: group, normalBalance: 'debit', note: '원문' });
    expect((await saveAccountCodeEdit(code, { name: '수정' }, context)).status).toBe('saved');
    expect(await read('accountCodes', code)).toMatchObject({ name: '수정', code: '500', groupId: group, normalBalance: 'debit', note: '원문' });
  });
  it('타회사 기존 문서 Rules 거절은 원문 불변이며 저장 성공으로 표시하지 않는다', async () => {
    const id = `${prefix}-foreign`, before = { companyId: 'punghoe', name: '다른 회사', type: '비용', plLine: 'sgna' };
    await seed('accountGroups', id, before);
    expect((await saveAccountGroupEdit(id, { plLine: null }, context)).status).toBe('unknown');
    expect(await read('accountGroups', id)).toEqual(before);
  });
  it('등록의 고정 ID를 그대로 쓰고 그룹·코드 삭제 ACK 뒤 실제 문서가 없다', async () => {
    const group = `${prefix}-new-group`, code = `${prefix}-new-code`;
    touched.push({ collection: 'accountGroups', id: group }, { collection: 'accountCodes', id: code });
    expect(await saveAccountGroupCreate({ id: group, name: '등록 그룹', type: '비용', plLine: 'sgna' }, { ...context, planId: randomUUID() })).toEqual({ status: 'saved' });
    expect(await saveAccountCodeCreate({ id: code, code: '0', name: '등록 코드', groupId: group }, { ...context, planId: randomUUID() })).toEqual({ status: 'saved' });
    expect(await read('accountGroups', group)).toEqual({ companyId: 'taebaek', name: '등록 그룹', type: '비용', plLine: 'sgna' });
    expect(await read('accountCodes', code)).toEqual({ companyId: 'taebaek', code: '0', name: '등록 코드', groupId: group });
    expect(await deleteAccountCode({ id: code, ...(await read('accountCodes', code)) } as AccountCode, { ...context, planId: randomUUID() })).toEqual({ status: 'saved' });
    expect(await deleteAccountGroup({ id: group, ...(await read('accountGroups', group)) } as AccountGroup, { ...context, planId: randomUUID() })).toEqual({ status: 'saved' });
    expect(await read('accountCodes', code)).toBeUndefined(); expect(await read('accountGroups', group)).toBeUndefined();
  });
  it('타회사 고정 ID 등록과 삭제 모두 Rules가 막으며 원래 문서를 보존한다', async () => {
    const group = `${prefix}-foreign-create`, code = `${prefix}-foreign-delete`;
    const original = { companyId: 'punghoe', name: '원래 그룹', type: '비용', note: '보존' };
    await seed('accountGroups', group, original);
    await seed('accountCodes', code, { companyId: 'punghoe', code: '7', name: '원래 코드' });
    expect((await saveAccountGroupCreate({ id: group, name: '잘못된 덮기', type: '자산' }, { ...context, planId: randomUUID() })).status).toBe('rejected');
    expect((await deleteAccountCode({ id: code, ...(await read('accountCodes', code)) } as AccountCode, { ...context, planId: randomUUID() })).status).toBe('rejected');
    expect(await read('accountGroups', group)).toEqual(original);
    expect(await read('accountCodes', code)).toMatchObject({ name: '원래 코드' });
  });
});
