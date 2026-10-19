import { useEffect, useReducer, useRef } from 'react';
import type { AccountCode, AccountGroup, CompanyId } from '../../../shared/types';
import { auth } from '../../../shared/firebase';
import { primaryCommitted, saveOutcomeMessage, type SaveOutcome } from '../../../shared/saveOutcome';
import type { AccountEditContext, AccountGroupEditPatch, AccountCodeEditPatch } from '../infrastructure/accountManagementWrites';

type GroupDraft = { name: string; type: AccountGroup['type']; plLine: NonNullable<AccountGroup['plLine']> | '' };
type CodeDraft = { code: string; name: string; groupId: string };
type Session = { kind: 'group'; id: string; original: GroupDraft; draft: GroupDraft; dirty: Set<keyof GroupDraft>; uncertain: Set<keyof GroupDraft> }
  | { kind: 'code'; intent: 'edit' | 'groupMove'; id: string; original: CodeDraft; draft: CodeDraft; dirty: Set<keyof CodeDraft>; uncertain: Set<keyof CodeDraft> };
export interface AccountManagementEditorOptions {
  companyId: CompanyId;
  actorUid?: string;
  isOtherBusy?: () => boolean;
  onUpdateGroup?: (id: string, patch: AccountGroupEditPatch, context: AccountEditContext) => Promise<SaveOutcome>;
  onUpdateCode?: (id: string, patch: AccountCodeEditPatch, context: AccountEditContext) => Promise<SaveOutcome>;
}
export function useAccountManagementEditor(options: AccountManagementEditorOptions) {
  const [, render] = useReducer((n: number) => n + 1, 0);
  const mounted = useRef(true);
  const makeOwner = () => ({ companyId: options.companyId, actorUid: options.actorUid, session: null as Session | null,
    task: null as object | null, error: '', message: '' });
  const owner = useRef(makeOwner());
  if (owner.current.companyId !== options.companyId || owner.current.actorUid !== options.actorUid) owner.current = makeOwner();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = () => { if (mounted.current) render(); };
  const valid = (captured: typeof owner.current, session: Session, task: object) => mounted.current && owner.current === captured
    && captured.session === session && captured.task === task && !!captured.actorUid && auth.currentUser?.uid === captured.actorUid;
  const openGroup = (row: AccountGroup) => {
    const original: GroupDraft = { name: row.name, type: row.type, plLine: row.plLine ?? '' };
    owner.current.session = { kind: 'group', id: row.id, original, draft: { ...original }, dirty: new Set(), uncertain: new Set() };
    owner.current.task = null; owner.current.error = ''; refresh();
  };
  const openCode = (row: AccountCode) => {
    const original: CodeDraft = { code: row.code, name: row.name, groupId: row.groupId ?? '' };
    owner.current.session = { kind: 'code', intent: 'edit', id: row.id, original, draft: { ...original }, dirty: new Set(), uncertain: new Set() };
    owner.current.task = null; owner.current.error = ''; refresh();
  };
  const changeGroup = (patch: Partial<GroupDraft>) => {
    const current = owner.current, session = current.session;
    if (current.task || session?.kind !== 'group') return;
    for (const key of ['name', 'type', 'plLine'] as const) if (patch[key] !== undefined) {
      session.draft = { ...session.draft, [key]: patch[key] };
      if (session.draft[key] !== session.original[key] || session.uncertain.has(key)) session.dirty.add(key); else session.dirty.delete(key);
    }
    current.error = ''; refresh();
  };
  const changeCode = (patch: Partial<CodeDraft>) => {
    const current = owner.current, session = current.session;
    if (current.task || session?.kind !== 'code') return;
    for (const key of ['code', 'name', 'groupId'] as const) if (patch[key] !== undefined && (session.intent !== 'groupMove' || key === 'groupId')) {
      session.draft = { ...session.draft, [key]: patch[key] };
      if (session.draft[key] !== session.original[key] || session.uncertain.has(key)) session.dirty.add(key); else session.dirty.delete(key);
    }
    current.error = ''; refresh();
  };
  const cancel = () => { owner.current.session = null; owner.current.task = null; owner.current.error = ''; refresh(); };
  const save = async () => {
    const captured = owner.current, session = captured.session;
    if (!session || captured.task || options.isOtherBusy?.() || !session.dirty.size || !captured.actorUid || auth.currentUser?.uid !== captured.actorUid) return false;
    if (session.kind === 'group' ? !options.onUpdateGroup : !options.onUpdateCode) return false;
    if ((session.kind === 'group' || session.intent === 'edit') && !session.draft.name.trim()) { captured.error = '이름을 입력해 주세요.'; refresh(); return false; }
    const task = {};
    captured.task = task; captured.error = ''; captured.message = ''; refresh();
    const context: AccountEditContext = { companyId: captured.companyId, actorUid: captured.actorUid, isCurrent: () => valid(captured, session, task) };
    const groupPatch: AccountGroupEditPatch = {}, codePatch: AccountCodeEditPatch = {};
    if (session.kind === 'group') {
      if (session.dirty.has('name')) groupPatch.name = session.draft.name.trim();
      if (session.dirty.has('type')) groupPatch.type = session.draft.type;
      if (session.dirty.has('plLine')) groupPatch.plLine = session.draft.plLine || null;
    } else {
      for (const key of session.dirty) if (session.intent !== 'groupMove' || key === 'groupId') codePatch[key] = key === 'groupId' ? session.draft[key] : session.draft[key].trim();
    }
    const markUncertain = () => {
      if (session.kind === 'group') { for (const key of session.dirty) session.uncertain.add(key); }
      else { for (const key of session.dirty) session.uncertain.add(key); }
    };
    try {
      const outcome = session.kind === 'group'
        ? await options.onUpdateGroup!(session.id, groupPatch, context)
        : await options.onUpdateCode!(session.id, codePatch, context);
      if (!context.isCurrent()) return false;
      if (primaryCommitted(outcome, session.id)) {
        captured.message = saveOutcomeMessage(outcome);
        captured.session = null;
        return true;
      }
      if (outcome.status === 'unknown' || outcome.status === 'partial') markUncertain();
      captured.error = saveOutcomeMessage(outcome);
      return false;
    } catch (error) {
      if (context.isCurrent()) {
        markUncertain();
        captured.error = `저장 결과를 확인하지 못했습니다. ${error instanceof Error ? error.message : String(error)}\n다시 저장하면 수정한 해당 항목이 이 값으로 저장됩니다. 현재 내용을 확인한 뒤 명시적으로 다시 저장해 주세요.`;
      }
      return false;
    } finally {
      if (owner.current === captured && captured.task === task) { captured.task = null; refresh(); }
    }
  };
  const moveCodeGroup = async (row: AccountCode, groupId: string) => {
    if (owner.current.task || options.isOtherBusy?.()) return false;
    const existing = owner.current.session;
    if (existing?.kind !== 'code' || existing.id !== row.id || existing.intent !== 'groupMove') {
      openCode(row);
      const opened = owner.current.session;
      if (opened?.kind === 'code') opened.intent = 'groupMove';
    }
    changeCode({ groupId }); return save();
  };
  const current = owner.current, session = current.session;
  const connected = session?.kind === 'group' ? !!options.onUpdateGroup : !!options.onUpdateCode;
  const blockedReason = !connected ? '이 화면에는 해당 계정 저장 기능이 연결되지 않았습니다.'
    : !current.actorUid || auth.currentUser?.uid !== current.actorUid ? '로그인 계정이 바뀌었습니다. 현재 계정에서 다시 열어 주세요.' : '';
  return { groupSession: session?.kind === 'group' ? { id: session.id, draft: session.draft, busy: !!current.task } : null,
    codeSession: session?.kind === 'code' ? { id: session.id, intent: session.intent, draft: session.draft, busy: !!current.task } : null,
    busy: !!current.task, isBusy: () => !!owner.current.task, error: current.error, message: current.message, blockedReason,
    canSave: !!session && !!session.dirty.size && !current.task && !options.isOtherBusy?.() && !blockedReason,
    openGroup, openCode, changeGroup, changeCode, save, cancel, moveCodeGroup };
}
