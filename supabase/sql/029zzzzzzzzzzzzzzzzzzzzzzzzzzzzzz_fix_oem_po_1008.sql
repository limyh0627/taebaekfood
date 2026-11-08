-- 2026-11-09 사장님 지시: 10/8 임가공 발주(옛 앱) 취소. 원료는 같은 날 보냈다 되돌려 0, 전표 없음.
-- 옛 앱 되돌림 기록이 reversal_of로 이어져 있지 않아 앱의 발주 취소가 막혀서 여기서 직접 취소한다. 다시 돌려도 같다.
update erp.purchase_orders set status = 'cancelled'
 where id = 'oem-e6b314b3-5158-45e6-b7a7-0bbe0cc17473' and status in ('pending', 'invoiced') and voucher_id is null
   and not exists (select 1 from erp.oem_receipts where po_id = 'oem-e6b314b3-5158-45e6-b7a7-0bbe0cc17473' and canceled_at is null);
