/** 전표 행은 화면 폭과 관계없이 PC의 글자 역할을 그대로 쓴다. */
export const statementHistoryRowStyles = {
  body: 'text-[12px]',
  amount: 'text-[12px] tabular-nums',
  kind: 'text-[12px]',
  meta: 'text-[10px]',
  action: 'text-[11px]',
  row: 'bg-white text-[12px]',
} as const;
