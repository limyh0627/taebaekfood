import { useEffect, useRef, useState } from 'react';
import { auth } from '../../../shared/firebase';
import { primaryCommitted, saveOutcomeMessage } from '../../../shared/saveOutcome';
import { today, addDays } from '../../../shared/day';
import { quoteTotals } from '../../../shared/quoteTotals';
import { quoteRecipient } from '../../../shared/quoteRecipient';
import { boxDerivedUnitPrice, type OrderUnitInputs } from '../../../shared/orderUnits';
import { saleTaxTypeOf } from '../../../shared/partnerPrice';
import type { Item, PartnerItem, CompanyId } from '../../../shared/types';
import type { Quotation, QuotationLine } from '../domain/quotation';
import type { QuotationReference } from '../../../shared/quotationCommand';
import { captureQuotation, prepareQuotation, applyQuotation, inspectQuotation, cancelQuotation, pendingQuotations, quotationReferences, quotationFromOpening, cloneQuotation, type QuotationScope, type QuotationOpening, type QuotationPrepared, type QuotationWriteInput, type QuotationOutcome, type PendingQuotation, type QuotationStoredReference } from '../infrastructure/quotationWrites';
export interface QuotationForm {
  date: string;
  validUntil?: string;
  partnerId: string;
  partnerName: string;
  recipientPhone?: string;
  attention?: string;
  deliveryTerms?: string;
  paymentTerms?: string;
  lines: QuotationLine[];
  note?: string;
}
export interface QuotationEditorSession {
  targetId: string;
  mode: 'create' | 'update';
  opening?: QuotationOpening;
  reference?: QuotationReference;
  quoteNo?: string;
  createdAt: string;
  base?: Quotation;
  submitted?: Quotation;
  requiresReopen?: boolean;
}
export interface QuotationDeleteSession {
  quotation: Quotation;
  opening?: QuotationOpening;
  reference?: QuotationReference;
  ready: boolean;
}
export interface QuotationEditorPorts {
  capture(selected: Quotation, isCurrent: () => boolean): Promise<QuotationOpening>;
  prepare(input: QuotationWriteInput, isCurrent: () => boolean): Promise<QuotationPrepared>;
  apply(reference: QuotationReference, isCurrent: () => boolean): Promise<QuotationOutcome>;
  inspect(reference: QuotationReference, isCurrent: () => boolean): Promise<QuotationOutcome>;
  cancel(reference: QuotationReference, isCurrent: () => boolean): Promise<QuotationOutcome>;
  pending(): PendingQuotation[];
  references(): QuotationStoredReference[];
}
export interface UseQuotationEditorOptions {
  companyId: CompanyId;
  actorUid?: string;
  currentUser?: {
    id: string;
    name: string;
  };
  quotes: Quotation[];
  items: Item[];
  partnerItems?: PartnerItem[];
  orderUnitInputs?: OrderUnitInputs;
  costOf?: (item: Item) => number;
  onSaved?: (quotation: Quotation) => void;
  onDeleted?: (id: string) => void;
  ports?: QuotationEditorPorts;
  id?: () => string;
}
const emptyLine = (): QuotationLine => ({
  name: '',
  spec: '',
  qty: 1,
  price: 0
});
/** 번호는 기존 일자별 목록 규칙이다. 서버 전역 번호 할당으로 바꾸지 않는다. */
function nextQuoteNo(date: string, existing: {
  quoteNo?: string;
}[]): string {
  const head = `Q${date.slice(2).replace(/-/g, '')}-`;
  let max = 0;
  for (const q of existing) {
    const no = q.quoteNo ?? '';
    if (!no.startsWith(head)) continue;
    const tail = no.slice(head.length);
    if (/^[0-9]+$/.test(tail)) max = Math.max(max, Number(tail));
  }
  return `${head}${String(max + 1).padStart(2, '0')}`;
}
const newForm = (name = ''): QuotationForm => ({
  date: today(),
  validUntil: addDays(today(), 30),
  partnerId: '',
  partnerName: '',
  recipientPhone: '',
  attention: name,
  deliveryTerms: '',
  paymentTerms: '',
  lines: [emptyLine()],
  note: ''
});
const formOf = (base: Quotation | undefined, name: string, keepDates = false): QuotationForm => ({
  date: keepDates && base ? base.date : today(),
  validUntil: keepDates && base ? base.validUntil : addDays(today(), 30),
  partnerId: base?.partnerId ?? '',
  partnerName: base?.partnerName ?? '',
  recipientPhone: base?.recipientPhone ?? '',
  attention: base?.attention ?? name,
  deliveryTerms: base?.deliveryTerms ?? '',
  paymentTerms: base?.paymentTerms ?? '',
  lines: base ? base.lines.map(line => ({
    ...line
  })) : [emptyLine()],
  note: base?.note ?? ''
});
const same = (a: QuotationReference | undefined, b: QuotationReference | undefined) => !!a && !!b && a.companyId === b.companyId && a.targetId === b.targetId && a.planId === b.planId;
const uncertain = (): QuotationOutcome => ({
  status: 'unknown',
  message: '견적 응답을 확인하지 못했습니다.',
  nextAction: '같은 보관 요청의 결과를 확인하거나 중단해 주세요.'
});
const notSent = (error: unknown): QuotationOutcome => ({
  status: 'rejected',
  message: error instanceof Error ? error.message : '견적 준비를 완료하지 못했습니다.',
  nextAction: '업무 저장은 전송하지 않았습니다. 작성 내용을 확인해 주세요.'
});
function snapshotWithoutUndefined(value: Quotation): Quotation {
  // 옛 addItem도 undefined를 저장하지 않았다. 알려진 선택 필드만 제거하고 줄의 미지 값은 보존한다.
  const result = {
    ...value,
    lines: value.lines.map(line => {
      const row = {
        ...line
      };
      for (const key of ['itemId', 'unit', 'cost', 'isTaxExempt', 'note'] as const) if (row[key] === undefined) delete row[key];
      return row;
    })
  };
  for (const key of ['validUntil', 'recipientPhone', 'attention', 'deliveryTerms', 'paymentTerms', 'totalCost', 'note', 'createdBy'] as const) if (result[key] === undefined) delete result[key];
  return result;
}
export function useQuotationEditor(options: UseQuotationEditorOptions) {
  const current = useRef(options);
  current.current = options;
  const uid = options.actorUid ?? auth.currentUser?.uid ?? '',
    key = `${options.companyId}:${uid}`,
    owner = useRef(key),
    generation = useRef(0),
    busyRef = useRef(false),
    sessionRef = useRef<QuotationEditorSession | null>(null),
    deleteRef = useRef<QuotationDeleteSession | null>(null),
    formRef = useRef<QuotationForm>(newForm(options.currentUser?.name));
  const [state, setState] = useState({
    owner: key,
    form: formRef.current,
    session: null as QuotationEditorSession | null,
    deleteSession: null as QuotationDeleteSession | null,
    open: false,
    busy: false,
    preparing: false,
    message: '',
    messageReference: null as QuotationReference | null,
    messageTargetId: null as string | null,
    lastOutcome: null as QuotationOutcome | null,
    pending: [] as PendingQuotation[],
    references: [] as QuotationStoredReference[]
  });
  if (owner.current !== key) {
    owner.current = key;
    generation.current++;
    busyRef.current = false;
    sessionRef.current = null;
    deleteRef.current = null;
    formRef.current = newForm(options.currentUser?.name);
  }
  const patch = (values: Partial<typeof state>) => setState(old => ({
    ...old,
    owner: owner.current,
    ...values
  }));
  const valid = (scope: string, token: number) => owner.current === scope && generation.current === token;
  const scope = (): QuotationScope => ({
    companyId: current.current.companyId,
    actorUid: current.current.actorUid ?? auth.currentUser?.uid ?? ''
  });
  const ports = (): QuotationEditorPorts => {
    if (current.current.ports) return current.current.ports;
    const captured = scope();
    return {
      capture: (q, ok) => captureQuotation(captured, q, ok),
      prepare: (input, ok) => prepareQuotation(captured, input, ok),
      apply: (r, ok) => applyQuotation(captured, r, ok),
      inspect: (r, ok) => inspectQuotation(captured, r, ok),
      cancel: (r, ok) => cancelQuotation(captured, r, ok),
      pending: () => pendingQuotations(captured),
      references: () => quotationReferences(captured)
    };
  };
  const refresh = () => {
    try {
      const p = ports();
      patch({
        pending: p.pending(),
        references: p.references()
      });
    } catch {
      patch({
        message: '보관된 견적 요청을 읽지 못했습니다. 기기 저장소를 확인한 뒤 다시 열어 주세요.',
        messageReference: null,
        messageTargetId: null
      });
    }
  };
  useEffect(() => {
    patch({
      form: formRef.current,
      session: null,
      deleteSession: null,
      open: false,
      busy: false,
      preparing: false,
      message: '',
      messageReference: null,
      messageTargetId: null,
      lastOutcome: null,
      pending: [],
      references: []
    });
    refresh();
  }, [key]);
  useEffect(() => () => {
    generation.current++;
  }, []);
  const updateForm = (value: QuotationForm) => {
    formRef.current = value;
    patch({
      form: value
    });
  };
  const isLocked = () => busyRef.current || !!sessionRef.current?.reference || !!sessionRef.current?.requiresReopen;
  const patchForm = (value: Partial<QuotationForm> | ((form: QuotationForm) => QuotationForm)) => {
    if (isLocked() || !sessionRef.current) return;
    updateForm(typeof value === 'function' ? value(formRef.current) : {
      ...formRef.current,
      ...value
    });
  };
  const patchLine = (index: number, value: Partial<QuotationLine>) => patchForm(form => ({
    ...form,
    lines: form.lines.map((line, i) => i === index ? {
      ...line,
      ...value
    } : line)
  }));
  const priceFor = (itemId: string) => {
    const rows = current.current.partnerItems ?? [],
      partnerId = formRef.current.partnerId;
    const direct = rows.find(row => row.itemId === itemId && row.partnerId === partnerId && row.Direction !== 'in')?.price;
    if (typeof direct === 'number' && direct > 0) return direct;
    const item = current.current.items.find(row => row.id === itemId);
    return partnerId ? boxDerivedUnitPrice(item, partnerId, rows as never, current.current.orderUnitInputs) : undefined;
  };
  const costFor = (item: Item) => Math.round(current.current.costOf?.(item) ?? Number(item.cost ?? 0));
  const selectItem = (index: number, item: Item) => {
    const tax = saleTaxTypeOf(current.current.partnerItems ?? [], item.id);
    patchLine(index, {
      itemId: item.id,
      name: item.name,
      spec: String(item.spec ?? ''),
      unit: String(item.unit ?? ''),
      cost: costFor(item),
      price: priceFor(item.id) ?? 0,
      isTaxExempt: tax === undefined ? undefined : tax === '면세'
    });
  };
  const start = async (mode: 'create' | 'update', base?: Quotation, keepDates = false): Promise<boolean> => {
    if (busyRef.current) return false;
    const captured = owner.current,
      token = ++generation.current;
    let frozen: Quotation | undefined;
    try {
      frozen = base ? cloneQuotation({
        ...base,
        companyId: current.current.companyId
      }) : undefined;
    } catch (error) {
      patch({
        message: saveOutcomeMessage(notSent(error)),
        messageTargetId: base?.id ?? null,
        messageReference: null
      });
      return false;
    }
    const session: QuotationEditorSession = {
      targetId: mode === 'update' ? base!.id : current.current.id?.() ?? `quo-${crypto.randomUUID()}`,
      mode,
      createdAt: mode === 'update' ? frozen!.createdAt ?? new Date().toISOString() : new Date().toISOString(),
      ...(mode === 'update' ? {
        base: frozen,
        quoteNo: frozen!.quoteNo
      } : {})
    };
    sessionRef.current = session;
    deleteRef.current = null;
    updateForm(formOf(frozen, current.current.currentUser?.name ?? '', keepDates));
    patch({
      session,
      deleteSession: null,
      open: true,
      message: '',
      messageTargetId: session.targetId,
      messageReference: null,
      lastOutcome: null
    });
    if (mode === 'create') return true;
    busyRef.current = true;
    patch({
      busy: true,
      preparing: true,
      message: '열 때의 견적 원문을 확인하고 있습니다. 아직 저장하지 않았습니다.'
    });
    try {
      const p = ports(),
        stored = p.references().find(row => row.reference?.targetId === session.targetId);
      if (stored?.reference) {
        session.reference = stored.reference;
        patch({
          session: {
            ...session
          },
          message: '이 견적의 보관된 요청을 먼저 확인하거나 중단해 주세요.',
          messageReference: stored.reference
        });
        return false;
      }
      const opening = await p.capture(base!, () => valid(captured, token));
      if (!valid(captured, token)) return false;
      if (opening.reference.targetId !== session.targetId || opening.reference.companyId !== current.current.companyId) throw Error('다른 견적의 열림 응답입니다.');
      const verified = quotationFromOpening(opening);
      session.opening = opening;
      session.base = verified;
      session.createdAt = verified.createdAt ?? new Date().toISOString();
      session.quoteNo = verified.quoteNo;
      updateForm(formOf(verified, current.current.currentUser?.name ?? '', true));
      patch({
        session: {
          ...session
        },
        message: ''
      });
      return true;
    } catch (error) {
      if (valid(captured, token)) {
        session.requiresReopen = true;
        patch({
          session: {
            ...session
          },
          message: saveOutcomeMessage(notSent(error)),
          lastOutcome: notSent(error)
        });
      }
      return false;
    } finally {
      if (valid(captured, token)) {
        busyRef.current = false;
        patch({
          busy: false,
          preparing: false
        });
        refresh();
      }
    }
  };
  const notify = (action: 'save' | 'delete', targetId: string, quotation?: Quotation) => {
    try {
      if (action === 'save' && quotation) current.current.onSaved?.(quotation);else if (action === 'delete') current.current.onDeleted?.(targetId);
    } catch {
      patch({
        message: '견적 처리는 확인됐지만 목록 표시를 갱신하지 못했습니다. 목록을 다시 불러와 주세요.'
      });
    }
  };
  const applyOutcome = (outcome: QuotationOutcome | void, reference: QuotationReference) => {
    const value = outcome && ['saved', 'partial', 'unknown', 'rejected', 'cancelled'].includes(outcome.status) ? outcome : uncertain();
    patch({
      lastOutcome: value,
      message: saveOutcomeMessage(value),
      messageReference: reference,
      messageTargetId: reference.targetId
    });
    return value;
  };
  const save = async (): Promise<boolean> => {
    const session = sessionRef.current;
    if (!session || isLocked()) return false;
    const form = formRef.current,
      recipient = quoteRecipient(form.partnerId, form.partnerName),
      lines = form.lines.filter(line => line.name.trim() && Number(line.qty) > 0);
    let validation = '';
    if (!recipient) validation = '견적 받을 업체명을 입력하세요.';else if (!lines.length) validation = '품목을 한 줄 이상 넣으세요.';else {
      const undecided = quoteTotals(lines).undecided;
      if (undecided > 0) validation = `과세·면세를 안 고른 줄이 ${undecided}개 있습니다.\n'—' 칸을 눌러 골라 주세요.`;
    }
    if (validation) {
      patch({
        message: validation,
        messageTargetId: session.targetId,
        messageReference: null,
        lastOutcome: {
          status: 'rejected',
          message: validation
        }
      });
      return false;
    }
    const totals = quoteTotals(lines),
      quoteNo = session.quoteNo ?? nextQuoteNo(form.date, current.current.quotes);
    const quotation = snapshotWithoutUndefined({
      id: session.targetId,
      companyId: current.current.companyId,
      quoteNo,
      date: form.date,
      validUntil: form.validUntil || undefined,
      partnerId: recipient!.partnerId,
      partnerName: recipient!.partnerName,
      recipientPhone: form.recipientPhone?.trim() || undefined,
      attention: form.attention || undefined,
      deliveryTerms: form.deliveryTerms?.trim() || undefined,
      paymentTerms: form.paymentTerms?.trim() || undefined,
      lines,
      totalSupply: totals.supply,
      totalTax: totals.tax,
      totalAmount: totals.total,
      totalCost: totals.cost,
      note: form.note || undefined,
      createdAt: session.createdAt,
      createdBy: current.current.currentUser?.name
    });
    const captured = owner.current,
      token = generation.current,
      p = ports();
    busyRef.current = true;
    patch({
      busy: true,
      message: '',
      lastOutcome: null
    });
    try {
      const prepared = await p.prepare({
        targetId: session.targetId,
        action: session.mode,
        opening: session.opening,
        snapshot: quotation
      }, () => valid(captured, token));
      if (!valid(captured, token)) return false;
      if (prepared.status !== 'ready') {
        patch({
          lastOutcome: prepared.outcome,
          message: saveOutcomeMessage(prepared.outcome),
          messageTargetId: session.targetId,
          messageReference: null
        });
        return false;
      }
      session.reference = prepared.reference;
      session.quoteNo = quoteNo;
      session.submitted = quotation;
      patch({
        session: {
          ...session
        }
      });
      const rawOutcome = await p.apply(prepared.reference, () => valid(captured, token));
      if (!valid(captured, token)) return false;
      const outcome = applyOutcome(rawOutcome, prepared.reference);
      if (primaryCommitted(outcome, session.targetId)) {
        notify('save', session.targetId, quotation);
        patch({
          open: false
        });
        return true;
      }
      if (outcome.status !== 'unknown' && outcome.status !== 'partial') {
        session.requiresReopen = true;
        patch({
          session: {
            ...session
          }
        });
      }
      return false;
    } catch (error) {
      if (valid(captured, token)) {
        if (session.reference) applyOutcome(uncertain(), session.reference);else patch({
          lastOutcome: notSent(error),
          message: saveOutcomeMessage(notSent(error)),
          messageTargetId: session.targetId,
          messageReference: null
        });
      }
      return false;
    } finally {
      if (valid(captured, token)) {
        busyRef.current = false;
        patch({
          busy: false
        });
        refresh();
      }
    }
  };
  const requestDelete = async (quotation: Quotation): Promise<boolean> => {
    if (busyRef.current) return false;
    const captured = owner.current,
      token = ++generation.current,
      p = ports();
    let selected: Quotation;
    try {
      selected = cloneQuotation({
        ...quotation,
        companyId: current.current.companyId
      });
    } catch (error) {
      patch({
        message: saveOutcomeMessage(notSent(error)),
        messageTargetId: quotation.id,
        messageReference: null
      });
      return false;
    }
    const deletion: QuotationDeleteSession = {
      quotation: selected,
      ready: false
    };
    deleteRef.current = deletion;
    busyRef.current = true;
    patch({
      deleteSession: deletion,
      busy: true,
      preparing: true,
      message: '삭제할 견적 원문을 확인하고 있습니다.',
      messageTargetId: quotation.id,
      messageReference: null,
      lastOutcome: null
    });
    try {
      const prior = p.references().find(row => row.reference?.targetId === quotation.id);
      if (prior?.reference) {
        deletion.reference = prior.reference;
        patch({
          deleteSession: {
            ...deletion
          },
          message: '보관된 견적 요청을 확인하거나 중단해 주세요.',
          messageReference: prior.reference
        });
        return false;
      }
      const opening = await p.capture(quotation, () => valid(captured, token));
      if (!valid(captured, token)) return false;
      const prepared = await p.prepare({
        targetId: quotation.id,
        action: 'delete',
        opening
      }, () => valid(captured, token));
      if (!valid(captured, token)) return false;
      if (prepared.status !== 'ready') {
        patch({
          message: saveOutcomeMessage(prepared.outcome),
          lastOutcome: prepared.outcome
        });
        return false;
      }
      deletion.opening = opening;
      deletion.reference = prepared.reference;
      deletion.ready = true;
      patch({
        deleteSession: {
          ...deletion
        },
        message: '',
        messageReference: prepared.reference
      });
      return true;
    } catch (error) {
      if (valid(captured, token)) patch({
        message: saveOutcomeMessage(notSent(error)),
        lastOutcome: notSent(error)
      });
      return false;
    } finally {
      if (valid(captured, token)) {
        busyRef.current = false;
        patch({
          busy: false,
          preparing: false
        });
        refresh();
      }
    }
  };
  const recover = async (reference: QuotationReference, mode: 'inspect' | 'cancel' | 'apply'): Promise<QuotationOutcome | null> => {
    if (busyRef.current) return null;
    const captured = owner.current,
      token = generation.current,
      p = ports();
    busyRef.current = true;
    patch({
      busy: true,
      message: '',
      messageReference: reference,
      messageTargetId: reference.targetId
    });
    try {
      const raw = await p[mode](reference, () => valid(captured, token));
      if (!valid(captured, token)) return null;
      const outcome = applyOutcome(raw, reference);
      if (same(sessionRef.current?.reference, reference) && outcome.status !== 'unknown') {
        sessionRef.current = {
          ...sessionRef.current!,
          requiresReopen: true
        };
        patch({
          session: sessionRef.current
        });
      }
      if (same(deleteRef.current?.reference, reference) && outcome.status !== 'unknown') {
        deleteRef.current = {
          ...deleteRef.current!,
          ready: false
        };
        patch({
          deleteSession: deleteRef.current
        });
      }
      if (primaryCommitted(outcome, reference.targetId)) patch({
        message: outcome.status === 'saved' ? '견적 처리가 확인됐습니다.' : saveOutcomeMessage(outcome)
      });
      return outcome;
    } catch {
      if (valid(captured, token)) return applyOutcome(uncertain(), reference);
      return null;
    } finally {
      if (valid(captured, token)) {
        busyRef.current = false;
        patch({
          busy: false
        });
        refresh();
      }
    }
  };
  const confirmDelete = async () => {
    const deletion = deleteRef.current;
    if (!deletion?.ready || !deletion.reference || busyRef.current) return false;
    deletion.ready = false;
    patch({
      deleteSession: {
        ...deletion
      }
    });
    const outcome = await recover(deletion.reference, 'apply');
    if (outcome && primaryCommitted(outcome, deletion.quotation.id) && same(deleteRef.current?.reference, deletion.reference)) {
      notify('delete', deletion.quotation.id);
      deleteRef.current = null;
      patch({
        deleteSession: null
      });
      return true;
    }
    return !!outcome && primaryCommitted(outcome, deletion.quotation.id);
  };
  const closeDelete = async () => {
    if (busyRef.current) {
      patch({
        message: '처리 결과를 기다린 뒤 닫아 주세요.'
      });
      return false;
    }
    const deletion = deleteRef.current,
      captured = owner.current,
      token = generation.current;
    if (deletion?.ready && deletion.reference) {
      const outcome = await recover(deletion.reference, 'cancel');
      if (!valid(captured, token) || !outcome || outcome.status !== 'cancelled' && !primaryCommitted(outcome, deletion.quotation.id)) return false;
      if (primaryCommitted(outcome, deletion.quotation.id)) notify('delete', deletion.quotation.id);
    }
    deleteRef.current = null;
    patch({
      deleteSession: null
    });
    return true;
  };
  const close = () => {
    if (busyRef.current) {
      patch({
        message: '처리 결과를 기다리고 있습니다. 완료 뒤 닫거나 새로고침 후 같은 보관 요청을 확인해 주세요.'
      });
      return false;
    }
    generation.current++;
    patch({
      open: false
    });
    return true;
  };
  const newFromDraft = async () => {
    if (busyRef.current || sessionRef.current?.reference && !sessionRef.current.requiresReopen) return false;
    const draft = formRef.current;
    const opened = await start('create');
    if (opened) updateForm({
      ...draft,
      lines: draft.lines.map(line => ({
        ...line
      }))
    });
    return opened;
  };
  const reopen = () => {
    const session = sessionRef.current;
    if (!session || busyRef.current) return Promise.resolve(false);
    const latest = current.current.quotes.find(q => q.id === session.targetId);
    return latest ? start('update', latest, true) : newFromDraft();
  };
  const visible = state.owner === key,
    session = state.session,
    deletion = state.deleteSession;
  const messageMatches = (targetId: string, reference?: QuotationReference) => visible && state.messageTargetId === targetId && (reference ? same(reference, state.messageReference ?? undefined) : state.messageReference === null);
  return {
    form: visible ? state.form : newForm(options.currentUser?.name),
    session: visible ? session : null,
    open: visible && state.open,
    editingId: visible && session?.mode === 'update' ? session.targetId : null,
    busy: visible && state.busy,
    saving: visible && state.busy,
    preparing: visible && state.preparing,
    locked: visible && (state.busy || !!session?.reference || !!session?.requiresReopen),
    message: visible ? state.message : '',
    sessionMessage: session && messageMatches(session.targetId, session.reference) ? state.message : '',
    sessionOutcome: session && messageMatches(session.targetId, session.reference) ? state.lastOutcome : null,
    deleteMessage: deletion && messageMatches(deletion.quotation.id, deletion.reference) ? state.message : '',
    deleteOutcome: deletion && messageMatches(deletion.quotation.id, deletion.reference) ? state.lastOutcome : null,
    deleteSession: visible ? deletion : null,
    pending: visible ? state.pending : [],
    references: visible ? state.references : [],
    lastOutcome: visible ? state.lastOutcome : null,
    openNew: () => start('create'),
    openCopy: (q: Quotation) => start('create', q),
    openEdit: (q: Quotation) => start('update', q, true),
    patchForm,
    patchLine,
    setLine: patchLine,
    addLine: () => patchForm(form => ({
      ...form,
      lines: [...form.lines, emptyLine()]
    })),
    removeLine: (index: number) => patchForm(form => ({
      ...form,
      lines: form.lines.filter((_, i) => i !== index)
    })),
    selectItem,
    priceFor,
    costFor,
    save,
    requestDelete,
    confirmDelete,
    closeDelete,
    close,
    inspect: (r: QuotationReference) => recover(r, 'inspect'),
    cancel: (r: QuotationReference) => recover(r, 'cancel'),
    refresh,
    reopen,
    newFromDraft
  };
}
