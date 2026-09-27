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

/** 쉼표를 다시 그려도 중간 자리에서 숫자를 고치는 커서가 끝으로 튀지 않게 한다. */
export function changeMoneyInput(input: HTMLInputElement, setValue: (digits: string) => void): void {
  const value = input.value;
  const before = value.slice(0, input.selectionStart ?? value.length).replace(/\D/g, '').length;
  const digits = value.replace(/\D/g, '');
  setValue(digits);
  queueMicrotask(() => {
    if (document.activeElement !== input) return;
    const formatted = formatMoneyInput(digits);
    let position = 0;
    let seen = 0;
    while (position < formatted.length && seen < before) {
      if (/\d/.test(formatted[position])) seen++;
      position++;
    }
    input.setSelectionRange(position, position);
  });
}
