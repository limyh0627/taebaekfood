import type { CompanyId, IssuedStatement } from '../../../shared/types';
import type { StatementWrite } from '../../statements/domain/statementWrites';

export type TaxIssueScope = 'all' | 'taxable' | 'exempt';

export interface TaxIssuePlan {
  writes: StatementWrite[];
  statementPatches: { id: string; data: Partial<IssuedStatement> }[];
}

/** 여러 전표의 서류 발행 기록과 목록 표시용 시각을 한 transaction용 목록으로 만든다. */
export function planTaxIssue(input: {
  operationId: string;
  companyId: CompanyId;
  statements: readonly IssuedStatement[];
  scope: TaxIssueScope;
  issuedAt: string;
  actorId?: string;
}): TaxIssuePlan {
  const writes: StatementWrite[] = [];
  const patches = new Map<string, Partial<IssuedStatement>>();
  const kinds = input.scope === 'all' ? ['taxable', 'exempt'] as const : [input.scope] as const;

  for (const kind of kinds) {
    const relevant = input.statements
      .map(statement => ({ statement, lines: statement.items.filter(line => kind === 'exempt' ? line.isTaxExempt : !line.isTaxExempt) }))
      .filter(x => x.lines.length > 0);
    if (!relevant.length) continue;
    const supply = relevant.reduce((sum, x) => sum + x.lines.reduce((s, line) => s + line.supply, 0), 0);
    const tax = relevant.reduce((sum, x) => sum + x.lines.reduce((s, line) => s + line.tax, 0), 0);
    writes.push({
      collection: 'taxIssueRecords', id: `${input.operationId}_${kind}`, merge: false,
      data: {
        operationId: input.operationId, companyId: input.companyId, kind,
        statementIds: relevant.map(x => x.statement.id), supply, tax, amount: supply + tax,
        issuedAt: input.issuedAt, actorId: input.actorId ?? '', status: 'issued',
      },
    });
    for (const { statement } of relevant) {
      const prev = patches.get(statement.id) ?? {};
      if (kind === 'taxable') prev.taxIssuedAt = input.issuedAt;
      else {
        prev.exemptIssuedAt = input.issuedAt;
        if (!statement.items.some(line => !line.isTaxExempt)) prev.taxIssuedAt = input.issuedAt;
      }
      patches.set(statement.id, prev);
    }
  }

  const statementPatches = [...patches].map(([id, data]) => ({ id, data }));
  for (const patch of statementPatches) {
    writes.push({ collection: 'issuedStatements', id: patch.id, data: patch.data as Record<string, unknown>, merge: true });
  }
  return { writes, statementPatches };
}
