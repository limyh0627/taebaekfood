import {OrderStatus,type Order} from '../../../shared/types';

export const fmtYYMMDD = (d: Date) =>
  `${String(d.getFullYear()).slice(2)}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;

export const expiryFromMfgDate = (mfgDate: string) => {
  const d = new Date(`${mfgDate.slice(0, 10)}T00:00:00`);
  d.setDate(d.getDate() + 365);
  return d;
};

export const seoulDateInput = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

export const isCarriedOrder = (order: Order): boolean => {
  if (![OrderStatus.PENDING, OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DISPATCHED, OrderStatus.ON_HOLD].includes(order.status)) return false;
  const created = new Date(order.createdAt);
  return Number.isFinite(created.getTime()) && seoulDateInput(created).slice(0, 7) < seoulDateInput().slice(0, 7);
};
