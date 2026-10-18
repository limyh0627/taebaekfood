export function workStatusFromItems(items: readonly {checked?:boolean}[]): 'PENDING'|'PROCESSING'|'DISPATCHED' {
  const checked = items.filter(item => item.checked === true).length;
  if (items.length > 0 && checked === items.length) return 'DISPATCHED';
  return checked > 0 ? 'PROCESSING' : 'PENDING';
}