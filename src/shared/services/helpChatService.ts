import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../firebase';
// 서버 실행 모듈을 앱의 타입 그래프로 끌어오지 않으며 전송 계약은 집중시험에서 대조한다.
export interface HelpChatRequest { question: string; history: { role: 'user' | 'assistant'; text: string }[]; mode: 'admin' | 'staff'; currentView?: string }
export interface HelpChatResponse { answer: string; sources: { id: string; title: string; navId?: string }[]; knowledgeVersion: string }
export interface HelpChatScope { companyId: string; userId: string; mode: 'admin' | 'staff' }
const bounded = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
export function validateHelpResponse(value: unknown): HelpChatResponse {
  const response = value as HelpChatResponse;
  if (!response || !bounded(response.answer, 4000) || !bounded(response.knowledgeVersion, 100)
    || !Array.isArray(response.sources) || response.sources.length > 5 || new Set(response.sources.map(source => source?.id)).size !== response.sources.length
    || response.sources.some(source => !source || !bounded(source.id, 100) || !bounded(source.title, 120)
      || (source.navId !== undefined && (typeof source.navId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(source.navId))))) {
    throw new Error('도움말 답변을 확인하지 못했습니다. 질문은 남아 있으니 다시 시도해 주세요.');
  }
  return { answer: response.answer, knowledgeVersion: response.knowledgeVersion,
    sources: response.sources.map(({ id, title, navId }) => ({ id, title, ...(navId ? { navId } : {}) })) };
}
export function helpChatError(error: unknown): string {
  const code = (error as { code?: string })?.code?.replace(/^functions\//, '');
  if (code === 'unauthenticated') return '로그인이 만료되었습니다. 다시 로그인한 뒤 질문해 주세요.';
  if (code === 'permission-denied') return '현재 계정에서 도움말을 사용할 수 없습니다. 로그인 계정과 회사를 확인해 주세요.';
  if (code === 'resource-exhausted') return '도움말 이용 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요. 일일 한도는 한국시간 오전 9시에 초기화됩니다.';
  if (code === 'invalid-argument') return '질문과 대화가 너무 길거나 형식이 맞지 않습니다. 대화를 비우거나 질문을 줄여 다시 보내 주세요.';
  if (code === 'unavailable' || code === 'deadline-exceeded') return '답변 서버에 연결하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.';
  if (error instanceof Error && !code && error.message.startsWith('도움말 답변')) return error.message;
  return '도움말 답변을 받지 못했습니다. 질문은 남아 있으니 다시 시도해 주세요.';
}
export async function askHelp(request: HelpChatRequest, scope: HelpChatScope): Promise<HelpChatResponse> {
  await authReady;
  const actor = auth.currentUser;
  const assertActor = () => {
    if (!actor || !scope.userId || actor.uid !== scope.userId || auth.currentUser !== actor) {
      throw Object.assign(new Error('계정이 변경되었습니다.'), { code: 'unauthenticated' });
    }
  };
  assertActor();
  const { claims } = await actor!.getIdTokenResult();
  assertActor();
  if ((claims.companyId !== scope.companyId && claims.isAdmin !== true) || (scope.mode === 'admin' && claims.isAdmin !== true) || request.mode !== scope.mode) {
    throw Object.assign(new Error('회사 또는 권한이 변경되었습니다.'), { code: 'permission-denied' });
  }
  if (!bounded(request.question, 2000) || !Array.isArray(request.history) || request.history.length > 6
    || request.history.some(message => !['user', 'assistant'].includes(message.role) || !bounded(message.text, 2000))
    || request.question.length + request.history.reduce((sum, message) => sum + message.text.length, 0) > 8000) {
    throw Object.assign(new Error('질문 길이 제한'), { code: 'invalid-argument' });
  }
  // 회사 자료나 직원 객체가 호출 인수에 섞이지 않도록 허용된 필드만 다시 만든다.
  const payload: HelpChatRequest = { question: request.question, history: request.history.map(({ role, text }) => ({ role, text })), mode: request.mode,
    ...(request.currentView ? { currentView: request.currentView } : {}) };
  const result = await httpsCallable<HelpChatRequest, HelpChatResponse>(functions, 'askHelp')(payload);
  assertActor();
  return validateHelpResponse(result.data);
}
