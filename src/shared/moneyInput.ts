/**
 * 원화 입력칸에 보여 줄 값. 저장값은 숫자지만 사람이 확인하는 동안은 천 단위 쉼표가 있어야
 * 1,428,000을 142,800이나 14,280,000으로 잘못 읽지 않는다.
 */
export function formatMoneyInput(value: string | number | null | undefined): string {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  const normalized = digits.replace(/^0+(?=\d)/, '');
  return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 쉼표가 보이는 원화 입력값을 저장용 숫자로 되돌린다. */
export function parseMoneyInput(value: string | number | null | undefined): number {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
}
