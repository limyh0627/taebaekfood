-- 택배는 판매 채널이 아니라 출고 방식이다 (사장님 확인 2026-11-09).
-- 채널이 '택배'인 거래처 → 채널 '일반', 기본 출고 방식이 비었으면 '택배'. 이미 정해진 출고 방식은 그대로. 다시 돌려도 같다.
update erp.partners
   set channel = '일반',
       default_ship_method = coalesce(nullif(default_ship_method, ''), '택배')
 where channel = '택배';
