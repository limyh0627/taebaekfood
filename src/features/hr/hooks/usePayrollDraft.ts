import { useEffect, useRef, useState } from 'react';
import { companyOf, payrollDocId, payrollGross, type CompanyId, type Employee, type Payroll, type PayrollLine } from '../../../shared/types';
import { savePayrollDraft, issuePayrollVoucher } from '../../../shared/services/payrollCommands';
export interface PayrollDraftOptions {
  companyId: CompanyId;
  actorUid: string;
  yearMonth: string;
  payrolls: (Payroll & {
    revision?: number;
  })[];
  employees: Employee[];
}
interface Draft {
  lines: PayrollLine[];
  payDate: string;
  revision: number;
  dirty: boolean;
  conflict: boolean;
  busy: boolean;
  message: string;
  source: string;
}
const cloneLines = (lines: PayrollLine[]) => lines.map(line => ({
  ...line
}));
export function usePayrollDraft(options: PayrollDraftOptions) {
  const latest = useRef(options);
  latest.current = options;
  const owner = options.companyId + ':' + options.actorUid;
  const ownerRef = useRef(owner),
    keyRef = useRef(''),
    generation = useRef(0);
  const drafts = useRef(new Map<string, Draft>());
  const [, redraw] = useState(0);
  if (ownerRef.current !== owner) {
    ownerRef.current = owner;
    drafts.current.clear();
    generation.current++;
  }
  const key = owner + ':' + options.yearMonth;
  if (keyRef.current !== key) {
    keyRef.current = key;
    generation.current++;
  }
  const findSource = () => latest.current.payrolls.find(row => row.id === payrollDocId(latest.current.companyId, latest.current.yearMonth) && companyOf(row) === latest.current.companyId);
  const fresh = (): Draft => {
    const row = findSource();
    return {
      lines: row ? cloneLines(row.lines ?? []) : latest.current.employees.filter(employee => companyOf(employee) === latest.current.companyId && employee.status === 'working' && employee.id !== 'admin').map(employee => ({
        employeeId: employee.id,
        employeeName: employee.name,
        department: employee.department,
        position: employee.position,
        base: 0
      })),
      payDate: row?.payDate || latest.current.yearMonth + '-25',
      revision: row?.revision ?? 0,
      dirty: false,
      conflict: false,
      busy: false,
      message: '',
      source: JSON.stringify(row ?? null)
    };
  };
  if (!drafts.current.has(key)) drafts.current.set(key, fresh());
  const draft = drafts.current.get(key)!;
  const update = () => redraw(value => value + 1);
  useEffect(() => {
    const row = findSource(),
      source = JSON.stringify(row ?? null);
    const revision = row?.revision ?? 0;
    if (draft.dirty || draft.busy) {
      if (revision !== draft.revision && !draft.conflict) {
        draft.conflict = true;
        draft.message = '같은 월의 저장본이 바뀌었습니다. 작성 내용은 유지했습니다. 최신 불러오기를 선택하기 전에는 최초 버전으로 저장합니다.';
        update();
      }
      return;
    }
    // ACK 직후 아직 도착하지 않은 옛 구독값으로 되돌리지 않는다.
    if (revision < draft.revision) return;
    const next = fresh();
    if (source !== draft.source || JSON.stringify(next.lines) !== JSON.stringify(draft.lines)) {
      Object.assign(draft, next);
      update();
    }
  }, [key, options.payrolls, options.employees]);
  useEffect(() => () => {
    generation.current++;
  }, []);
  const change = (work: () => void) => {
    if (draft.busy || keyRef.current !== key) return;
    draft.message = '';
    work();
    draft.dirty = true;
    update();
  };
  const reload = () => {
    if (draft.busy) return false;
    Object.assign(draft, fresh());
    update();
    return true;
  };
  const run = async (mode?: 'cash' | 'accrual', bank?: string) => {
    if (draft.busy || !options.actorUid) return false;
    const turn = generation.current;
    const input = {
      yearMonth: options.yearMonth,
      payDate: draft.payDate,
      lines: cloneLines(draft.lines.filter(line => payrollGross(line) > 0)),
      expectedRevision: draft.revision
    };
    draft.busy = true;
    draft.message = '';
    update();
    try {
      if (mode) {
        const result = await issuePayrollVoucher(options.companyId, input, mode, mode === 'cash' ? bank : undefined, options.actorUid);
        if (turn !== generation.current) return false;
        draft.message = result.docNo + ' 전표를 확인했습니다';
      } else {
        const result = await savePayrollDraft(options.companyId, input, options.actorUid);
        if (turn !== generation.current) return false;
        draft.revision = result.revision;
        draft.message = '저장했습니다';
      }
      draft.dirty = false;
      draft.conflict = false;
      return true;
    } catch (error) {
      if (turn === generation.current) {
        draft.dirty = true;
        draft.message = (error instanceof Error ? error.message : '급여 저장 결과를 확인하지 못했습니다.') + '\n작성 내용은 유지했습니다. 현재 대장과 전표를 확인해 주세요. 조회 값만으로 이 요청의 저장 여부를 확정하지 않습니다.';
      }
      return false;
    } finally {
      draft.busy = false;
      if (turn === generation.current) update();
    }
  };
  return {
    lines: draft.lines,
    payDate: draft.payDate,
    sourceRevision: draft.revision,
    dirty: draft.dirty,
    conflict: draft.conflict,
    busy: draft.busy,
    message: draft.message,
    setCell: (index: number, field: keyof PayrollLine, value: string) => change(() => {
      const number = Math.round(parseFloat(value.replace(/[^\d.-]/g, '')) || 0);
      draft.lines = draft.lines.map((line, i) => i === index ? {
        ...line,
        [field]: number
      } : line);
    }),
    setPayDate: (value: string) => change(() => {
      draft.payDate = value;
    }),
    copyPreviousMonth: () => change(() => {
      const [year, month] = options.yearMonth.split('-').map(Number);
      const previous = month === 1 ? year - 1 + '-12' : year + '-' + String(month - 1).padStart(2, '0');
      const row = options.payrolls.find(value => value.id === payrollDocId(options.companyId, previous) && companyOf(value) === options.companyId);
      if (!row) {
        draft.message = previous + ' 대장이 없습니다';
        return;
      }
      const byId = new Map(row.lines.map(line => [line.employeeId, line]));
      draft.lines = draft.lines.map(line => {
        const old = byId.get(line.employeeId);
        return old ? {
          ...old,
          employeeId: line.employeeId,
          employeeName: line.employeeName,
          department: line.department,
          position: line.position
        } : line;
      });
    }),
    reload,
    run
  };
}
