-- 2026-11-09 사장님 지시: 옛 앱 입출금(cashEntries)의 작성자가 옛 앱 내부 아이디(emp_…)로만 남아 직원 카드와 안 이어져
-- 전표 목록 담당자 칸에 그대로 보였다 → 모두 임영훈으로. 다시 돌려도 같다.
update erp.vouchers set created_by = '임영훈' where created_by like 'emp\_%';
