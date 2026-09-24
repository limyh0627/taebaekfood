import type { Item, PartnerItem } from './types';

/** 용역도 전표의 품목 줄이다. 다만 단가·세금·계정은 거래처와 매출/매입 방향의 연결에 명시돼야 한다. */
export function serviceStatementErrors(
  lines: readonly { itemId?: string; name: string; accountCode?: string; price?: number }[],
  items: readonly Pick<Item, 'id' | 'type'>[],
  partnerItems: readonly PartnerItem[],
  partnerId: string,
  statementType: string,
): string[] {
  const direction = statementType === '매출' ? 'out' : statementType === '매입' ? 'in' : null;
  if (!direction) return [];
  const byId = new Map(items.map(item => [item.id, item]));
  return lines.flatMap(line => {
    if (!line.itemId || byId.get(line.itemId)?.type !== 'service') return [];
    const connection = partnerItems.find(row => row.itemId === line.itemId && row.partnerId === partnerId && row.Direction === direction);
    if (!connection) return [`${line.name}: 이 거래처의 ${statementType} 용역 연결이 없습니다.`];
    if (connection.taxType !== '과세' && connection.taxType !== '면세') return [`${line.name}: 과세 여부를 거래처 연결에서 선택해 주세요.`];
    if (!line.accountCode && !connection.Account_Code) return [`${line.name}: ${statementType} 계정과목을 선택해 주세요.`];
    if (!(Number(line.price ?? connection.price) > 0)) return [`${line.name}: 단가를 입력해 주세요.`];
    return [];
  });
}
