/** Formatting only. Sequence allocation belongs to the caller's existing counter/claim contract. */
export function formatVoucherNo(date: string, sequence: number, prefix = ''): string {
  return `${prefix}${date.slice(2).replace(/-/g, '')}-${String(sequence).padStart(3, '0')}`;
}
