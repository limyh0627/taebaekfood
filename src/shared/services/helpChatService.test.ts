import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
const state = vi.hoisted(() => ({ user: null as any, call: vi.fn() }));
vi.mock('../firebase', () => ({ authReady: Promise.resolve(), auth: { get currentUser() { return state.user; } }, functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => state.call }));
import { askHelp, validateHelpResponse, helpChatError } from './helpChatService';
const response = { answer: '사용법 안내', knowledgeVersion: 'v1', sources: [{ id: 'statement', title: '전표', navId: 'statement' }] };
const scope = { companyId: 'taebaek', userId: 'u', mode: 'admin' as const };
beforeEach(() => { state.user = { uid: 'u', getIdTokenResult: async () => ({ claims: { companyId: 'taebaek', isAdmin: true } }) }; state.call.mockReset(); state.call.mockResolvedValue({ data: response }); });
describe('도움말 전송 경계', () => {
  it('클라이언트 DTO가 서버의 전송 계약과 같다', () => {
    const contracts = (path: string) => {
      const file = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
      const printer = ts.createPrinter({ removeComments: true });
      return file.statements.filter(ts.isInterfaceDeclaration).filter(node => ['HelpChatRequest', 'HelpChatResponse'].includes(node.name.text))
        .map(node => printer.printNode(ts.EmitHint.Unspecified, node, file).replace(/\s/g, ''));
    };
    expect(contracts('./helpChatService.ts')).toEqual(contracts('../../../functions/src/helpChat.ts'));
  });
  it('허용된 질문 필드만 보내고 회사·직원 객체는 보내지 않는다', async () => {
    await askHelp({ question: '어떻게 하나요?', history: [], mode: 'admin', currentView: 'statement', companyId: 'secret', employee: { name: '직원' } } as any, scope);
    expect(state.call).toHaveBeenCalledWith({ question: '어떻게 하나요?', history: [], mode: 'admin', currentView: 'statement' });
  });
  it('다른 UID 또는 회사면 호출하지 않는다', async () => {
    await expect(askHelp({ question: '질문', history: [], mode: 'admin' }, { ...scope, userId: 'other' })).rejects.toMatchObject({ code: 'unauthenticated' });
    state.user.getIdTokenResult = async () => ({ claims: { companyId: 'taebaek', isAdmin: false } });
    await expect(askHelp({ question: '질문', history: [], mode: 'staff' }, { ...scope, mode: 'staff', companyId: 'other' })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(state.call).not.toHaveBeenCalled();
  });
  it.each(['admin', 'staff'] as const)('실제 관리자는 회사 전환 후 %s 화면 도움말을 사용할 수 있다', async mode => {
    await expect(askHelp({ question: '질문', history: [], mode }, { ...scope, mode, companyId: 'punghoe' })).resolves.toEqual(response);
    expect(state.call).toHaveBeenCalledTimes(1);
  });
  it('서버 응답 중 계정이 바뀌면 응답을 폐기한다', async () => {
    state.call.mockImplementation(async () => { state.user = { ...state.user, uid: 'new' }; return { data: response }; });
    await expect(askHelp({ question: '질문', history: [], mode: 'admin' }, scope)).rejects.toMatchObject({ code: 'unauthenticated' });
  });
  it('질문·대화 길이 초과를 전송 전에 거절한다', async () => {
    await expect(askHelp({ question: '가'.repeat(2001), history: [], mode: 'admin' }, scope)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(askHelp({ question: '질문', history: Array.from({ length: 7 }, () => ({ role: 'user' as const, text: '질문' })), mode: 'admin' }, scope)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(state.call).not.toHaveBeenCalled();
  });
  it.each(['javascript:alert(1)', '/admin', 'https://example.com'])('이동 출처 변조 %s를 거절한다', navId => {
    expect(() => validateHelpResponse({ ...response, sources: [{ id: 's', title: '전표', navId }] })).toThrow('도움말 답변');
  });
  it('출처 과다·빈답변을 거절하고 서버 임의 필드를 버린다', () => {
    expect(() => validateHelpResponse({ ...response, answer: '' })).toThrow();
    expect(() => validateHelpResponse({ ...response, sources: Array(6).fill(response.sources[0]) })).toThrow();
    expect(() => validateHelpResponse({ ...response, sources: Array(2).fill(response.sources[0]) })).toThrow();
    expect(validateHelpResponse({ ...response, url: 'https://example.com' })).not.toHaveProperty('url');
    expect(helpChatError({ code: 'functions/resource-exhausted' })).toContain('오전 9시');
  });
});
