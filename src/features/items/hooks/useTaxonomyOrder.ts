import { useEffect, useReducer, useRef } from 'react';
import type { CompanyId } from '../../../shared/types';
import type { TaxonomyRow } from '../../../shared/taxonomy';
import { auth } from '../../../shared/firebase';
import { prepareTaxonomyTypeOrder, prepareTaxonomyRowOrder, commitTaxonomyOrder, isTaxonomyOrderNotStarted } from '../infrastructure/taxonomyOrderWrites';

type Plan = NonNullable<ReturnType<typeof prepareTaxonomyTypeOrder>>;
export interface TaxonomyActionContext { isCurrent: () => boolean }
export interface TaxonomyOrderOptions {
  companyId: CompanyId;
  actorUid?: string;
  rows: TaxonomyRow[];
  onOrderAck: (rows: TaxonomyRow[]) => void;
  ports?: {
    prepareType: typeof prepareTaxonomyTypeOrder;
    prepareRow: typeof prepareTaxonomyRowOrder;
    commit: typeof commitTaxonomyOrder;
  };
}
export function useTaxonomyOrder(options: TaxonomyOrderOptions) {
  const [, render] = useReducer((n: number) => n + 1, 0);
  const mounted = useRef(true);
  const makeOwner = () => ({ companyId: options.companyId, actorUid: options.actorUid, operation: null as object | null,
    error: '', needsReload: false, plan: null as Plan | null });
  const owner = useRef(makeOwner());
  if (owner.current.companyId !== options.companyId || owner.current.actorUid !== options.actorUid) owner.current = makeOwner();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = () => { if (mounted.current) render(); };
  const current = (captured: typeof owner.current, task: object) => mounted.current && owner.current === captured
    && captured.operation === task && !!captured.actorUid && auth.currentUser?.uid === captured.actorUid;
  const ports = options.ports ?? { prepareType: prepareTaxonomyTypeOrder, prepareRow: prepareTaxonomyRowOrder, commit: commitTaxonomyOrder };
  const runAction = async (action: (context: TaxonomyActionContext) => Promise<unknown> | unknown) => {
    const captured = owner.current;
    if (captured.operation || captured.needsReload || !captured.actorUid || auth.currentUser?.uid !== captured.actorUid) return false;
    const task = {};
    captured.operation = task;
    captured.error = '';
    refresh();
    try {
      await action({ isCurrent: () => current(captured, task) });
      return current(captured, task);
    } catch (error) {
      if (current(captured, task)) captured.error = `작업 결과를 확인하지 못했습니다. ${error instanceof Error ? error.message : String(error)} 현재 목록을 확인해 주세요.`;
      return false;
    } finally {
      if (owner.current === captured && captured.operation === task) { captured.operation = null; refresh(); }
    }
  };
  const move = async (prepare: () => Plan | null) => {
    const captured = owner.current;
    return runAction(async context => {
      let plan: Plan | null;
      try { plan = prepare(); }
      catch (error) {
        if (context.isCurrent()) captured.error = error instanceof Error ? error.message : String(error);
        return;
      }
      if (!plan || !context.isCurrent()) return;
      captured.plan = plan;
      try {
        const acknowledged = await ports.commit(plan, { companyId: captured.companyId, actorUid: captured.actorUid!, isCurrent: context.isCurrent });
        if (context.isCurrent()) {
          options.onOrderAck(acknowledged);
          captured.plan = null;
          captured.error = '';
        }
      } catch (error) {
        if (!context.isCurrent()) return;
        if (isTaxonomyOrderNotStarted(error)) {
          captured.plan = null;
          captured.error = error.message;
        } else {
          captured.needsReload = true;
          captured.error = '순서 저장 여부를 확인하지 못했습니다. 최신 목록을 다시 읽고 현재 순서를 확인해 주세요. 이전 저장이 뒤늦게 반영될 수 있으니, 확인 후 필요한 항목만 다시 이동해 주세요.';
        }
      }
    });
  };
  const moveType = (key: string, direction: -1 | 1) => move(() => ports.prepareType(options.rows, key, direction, options.companyId));
  const moveRow = (row: TaxonomyRow, direction: -1 | 1, kind: 'subtype' | 'category', parent: string) => move(() => ports.prepareRow(options.rows, row.id, direction, kind, parent, options.companyId));
  const markReloaded = (_rows: TaxonomyRow[]) => {
    const captured = owner.current;
    if (captured.operation || !captured.actorUid || auth.currentUser?.uid !== captured.actorUid) return false;
    captured.needsReload = false;
    captured.plan = null;
    captured.error = '';
    refresh();
    return true;
  };
  return { busy: !!owner.current.operation, error: owner.current.error, needsReload: owner.current.needsReload,
    moveType, moveRow, runAction, markReloaded };
}
