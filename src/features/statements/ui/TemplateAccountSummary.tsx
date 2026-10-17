import React from 'react';
import type { AccountCode, FixedCostTemplate } from '../../../shared/types';
import { templateJournalLines, type CashTemplate } from '../../../shared/cashTemplates';

/** 금액이 비어 있어도 정본이 반환한 계정은 확인할 수 있어야 한다. */
export default function TemplateAccountSummary({ template, accountCodes }: { template: FixedCostTemplate; accountCodes: AccountCode[] }) {
  const projection: CashTemplate = { ...template, label: template.name, dir: template.dir ?? '출금', mode: (template.mode ?? '일반') as CashTemplate['mode'] };
  const lines = templateJournalLines(projection);
  return <span className="block space-y-1 text-xs text-slate-600">
    {(['차변', '대변'] as const).map(side => {
      const accounts = lines.filter(line => line.side === side);
      return <span key={side} className="flex items-start gap-2">
        <span className="shrink-0 text-slate-400">{side}</span>
        <span className="min-w-0 break-words">{accounts.length ? accounts.map((line, index) => <React.Fragment key={index}>
          {index > 0 && ' · '}{line.code ? `${line.code} ${accountCodes.find(account => account.code === line.code)?.name || line.label}` : '계정 직접 선택'}
        </React.Fragment>) : '작성 시 결정'}</span>
      </span>;
    })}
  </span>;
}
