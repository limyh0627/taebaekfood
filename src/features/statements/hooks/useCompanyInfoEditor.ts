import { useEffect, useReducer, useRef } from 'react';
import type { CompanyId, CompanyInfo } from '../../../shared/types';
import { auth } from '../../../shared/firebase';
import { bankAccountOf } from '../../../shared/companyInfo';

export const COMPANY_INFO_FIELDS = ['name', 'ceoName', 'bizNo', 'bizType', 'bizItem', 'address', 'phone', 'fax', 'email', 'bankAccount'] as const;
export type CompanyInfoField = typeof COMPANY_INFO_FIELDS[number];
type Form = Record<CompanyInfoField, string>;
export interface CompanyInfoEditorOptions {
  initial?: CompanyInfo | null;
  companyId: CompanyId;
  actorUid?: string;
  onSave?: (patch: Partial<CompanyInfo>) => unknown | Promise<unknown>;
  onClose?: () => void;
}
function display(initial?: CompanyInfo | null): Form {
  const form = Object.fromEntries(COMPANY_INFO_FIELDS.map(key => [key, String(initial?.[key] ?? '')])) as Form;
  form.bankAccount = bankAccountOf(initial);
  return form;
}
export function useCompanyInfoEditor(options: CompanyInfoEditorOptions) {
  const [, render] = useReducer((n: number) => n + 1, 0);
  const mounted = useRef(true);
  const create = () => {
    const original = display(options.initial);
    return { companyId: options.companyId, actorUid: options.actorUid, original, form: { ...original },
      dirty: new Set<CompanyInfoField>(), uncertain: new Set<CompanyInfoField>(), operation: null as object | null, error: '' };
  };
  const session = useRef<ReturnType<typeof create> | null>(null);
  if (!session.current || session.current.companyId !== options.companyId || session.current.actorUid !== options.actorUid) session.current = create();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = () => { if (mounted.current) render(); };
  const valid = (captured: NonNullable<typeof session.current>) => mounted.current && session.current === captured
    && !!captured.actorUid && auth.currentUser?.uid === captured.actorUid;
  const changeField = (key: CompanyInfoField, value: string) => {
    const current = session.current!;
    if (current.operation || !COMPANY_INFO_FIELDS.includes(key)) return;
    current.form = { ...current.form, [key]: value };
    if (value === current.original[key] && !current.uncertain.has(key)) current.dirty.delete(key); else current.dirty.add(key);
    current.error = '';
    refresh();
  };
  const close = () => {
    // 닫힌 창의 응답을 새 창의 ACK로 쓰지 않는다.
    session.current = null;
    options.onClose?.();
    return true;
  };
  const save = async () => {
    const current = session.current!;
    if (!current || current.operation || !options.onSave || !current.dirty.size || !valid(current)) return false;
    const task = {};
    const patch: Partial<CompanyInfo> = {};
    for (const key of current.dirty) patch[key] = current.form[key];
    current.operation = task;
    current.error = '';
    refresh();
    try {
      await options.onSave(patch);
      if (!valid(current)) return false;
      current.operation = null;
      session.current = null;
      options.onClose?.();
      refresh();
      return true;
    } catch (error) {
      if (valid(current)) {
        for (const key of Object.keys(patch) as CompanyInfoField[]) current.uncertain.add(key);
        const reason = error instanceof Error ? error.message : String(error);
        current.error = `저장 결과를 확인하지 못했습니다. ${reason}\n다시 저장하면 수정한 해당 항목이 이 값으로 저장됩니다. 현재 정보를 확인한 뒤 명시적으로 다시 저장해 주세요.`;
      }
      return false;
    } finally {
      if (session.current === current && current.operation === task) { current.operation = null; refresh(); }
    }
  };
  const current = session.current;
  const blockedReason = !options.onSave ? '이 화면에는 회사정보 저장 기능이 연결되지 않았습니다.'
    : !current.actorUid || auth.currentUser?.uid !== current.actorUid ? '로그인 계정이 바뀌어 저장할 수 없습니다. 창을 닫고 현재 계정에서 다시 열어 주세요.' : '';
  return { blockedReason, form: current.form, changeField, dirtyFields: Array.from(current.dirty), dirty: !!current.dirty.size,
    busy: !!current.operation, error: current.error, canSave: !!options.onSave && !!current.dirty.size && !current.operation
      && !!current.actorUid && auth.currentUser?.uid === current.actorUid, save, close };
}
