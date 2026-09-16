import type { IssuedStatement, Item } from '../../../../types';
import type { LineItem, StatementType } from '../../../shared/statementLines';
import { stampFor } from '../../../shared/voucherStamp';

interface Input {
  identity: { id: string; docNo: string };
  tradeDate: string;
  type: StatementType;
  partnerId: string;
  partnerName: string;
  orderIds: string[];
  memo: string;
  totals: { supply: number; tax: number; amount: number };
  partySnapshot: IssuedStatement['partySnapshot'];
  lines: LineItem[];
  allItems: Item[];
}

/** 화면 입력을 저장 가능한 전표 스냅샷으로 만든다. DB 쓰기는 호출자가 맡는다. */
export function buildIssuedStatementDraft(input: Input): IssuedStatement {
  return {
    id: input.identity.id,
    issuedAt: stampFor(input.tradeDate),
    tradeDate: input.tradeDate,
    type: input.type,
    partnerId: input.partnerId,
    partnerName: input.partnerName,
    orderId: input.orderIds.join(','),
    docNo: input.identity.docNo,
    ...(input.memo.trim() ? { memo: input.memo.trim() } : {}),
    totalSupply: input.totals.supply,
    totalTax: input.totals.tax,
    totalAmount: input.totals.amount,
    partySnapshot: input.partySnapshot,
    items: input.lines.map(line => ({
      ...(line.itemId ? { itemId: line.itemId } : {}),
      ...(line.lineKind ? { lineKind: line.lineKind } : {}),
      name: line.name, spec: line.spec, qty: line.qty, price: line.price,
      supply: line.supply, tax: line.tax, total: line.total, isTaxExempt: line.isTaxExempt,
      accountCode: line.accountCode || undefined,
      ...(line.side ? { side: line.side } : {}),
    })),
    ...(input.type === '매입' ? {
      purchaseOrderIds: input.lines
        .map(line => input.allItems.find(item => item.id === line.itemId))
        .filter((item): item is Item => !!item)
        .map(item => item.id),
    } : {}),
  };
}
