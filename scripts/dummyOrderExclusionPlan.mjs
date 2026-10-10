// Pure classification only: no database, clock, generated reason, writer, or deletion.
const companyOf = row => row.companyId ?? 'taebaek';
export const dummyOrderLinks = row => typeof row.orderId === 'string' ? row.orderId.split(/[,\s]+/).map(s => s.trim()).filter(Boolean) : [];
const links = dummyOrderLinks;
const text = value => typeof value === 'string' && value.trim().length > 0;
export function planDummyOrderExclusions({ companyId, dummy, orders, statements, reasons, readsComplete }) {
  if (!['taebaek', 'punghoe'].includes(companyId)) throw new Error('Invalid company');
  if (!dummy || dummy.id !== 'stmt-hide-20260828' || companyOf(dummy) !== companyId
    || !Array.isArray(dummy.items) || dummy.items.length !== 0 || dummy.totalAmount !== 0
    || dummy.totalSupply !== 0 || dummy.totalTax !== 0 || dummy.type !== '매출') throw new Error('Invalid dummy evidence');
  const ids = links(dummy);
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('Missing or duplicate dummy links');
  return { mode: 'dry', dummyPreserved: true, linkedCount: ids.length, rows: ids.map(id => {
    const matches = orders.filter(o => o.id === id);
    const result = (status, code, extra = {}) => ({ orderId: id, status, code, ...extra });
    if (!readsComplete) return result('unresolved', 'INCOMPLETE_READ_SET');
    if (matches.length !== 1) return result('unresolved', matches.length ? 'AMBIGUOUS_ORDER' : 'MISSING_ORDER');
    const order = matches[0];
    if (companyOf(order) !== companyId) return result('conflict', 'FOREIGN_ORDER');
    const real = statements.filter(s => s.id !== dummy.id && companyOf(s) === companyId && links(s).includes(id));
    if (real.length) return result('conflict', 'OTHER_STATEMENT', { statementIds: real.map(s => s.id) });
    const evidence = reasons.filter(r => r.orderId === id && r.companyId === companyId && r.dummyStatementId === dummy.id);
    if (evidence.length !== 1 || !text(evidence[0]?.reason) || !text(evidence[0]?.reference) || !text(evidence[0]?.confirmedBy)) return result('unresolved', 'REASON_EVIDENCE_REQUIRED');
    const reason = evidence[0].reason.trim();
    if (order.accountingExcluded === true) return result(order.accountingExclusionReason === reason ? 'already' : 'conflict', order.accountingExclusionReason === reason ? 'SAME_REASON_PRESERVED' : 'EXISTING_REASON_CONFLICT');
    if ((order.accountingExcluded !== undefined && order.accountingExcluded !== false)
      || text(order.accountingExclusionReason) || text(order.accountingExcludedAt) || text(order.accountingExcludedBy)) return result('conflict', 'EXISTING_EXCLUSION_VALUES');
    if (!text(order.readVersion)) return result('unresolved', 'VERSION_REQUIRED');
    return result('reviewable', 'REASON_CONFIRMED', {
      before: structuredClone(order), expectedVersion: order.readVersion, evidence: structuredClone(evidence[0]),
      proposed: { accountingExcluded: true, accountingExclusionReason: reason },
      requiredAtApply: ['fresh order/version', 'fresh same-company real-statement membership', 'explicit execution timestamp and actual actor'],
    });
  }) };
}
