-- 2026-11-09: 옛 앱 '일반전표 템플릿'(fixedCostTemplates kind=voucher)을 새 앱 일반전표 템플릿(erp.journal_templates)으로 옮긴다.
--  옛 것은 voucher_templates(정기 전표 표)에 active=false로만 들어와 있어서 일반전표 창에 안 보였다.
--  줄 만들기: 분개 줄(transferLines)이 있으면 그대로, 없으면 방향대로
--   출금 = 차변 계정 / 대변 103 보통예금, 입금 = 차변 103 / 대변 계정, 대체 = 차변 계정 / 대변 253 미지급금. 금액은 옛 금액(0이면 빈칸).
--  같은 회사에 같은 이름의 템플릿이 이미 있으면 건너뛴다. 다시 돌려도 같다.
insert into erp.journal_templates (id, company_id, name, kind, partner_id, memo, lines, created_by)
select 'jt-' || t.id, t.company_id, t.name, '비용', t.partner_id, t.name,
  case
    when jsonb_typeof(t.lines) = 'array' and jsonb_array_length(t.lines) > 0 then
      (select jsonb_agg(jsonb_build_object('account_code', coalesce(l->>'accountCode', ''), 'side', coalesce(l->>'side', '차변'),
                                           'amount', case when jsonb_array_length(t.lines) = 2 then nullif(t.amount, 0) end,
                                           'note', coalesce(l->>'name', '')) order by o)
       from jsonb_array_elements(t.lines) with ordinality x(l, o))
    when t.direction = '입금' then jsonb_build_array(
      jsonb_build_object('account_code', '103', 'side', '차변', 'amount', nullif(t.amount, 0), 'note', ''),
      jsonb_build_object('account_code', coalesce(t.account_code, ''), 'side', '대변', 'amount', nullif(t.amount, 0), 'note', ''))
    when t.direction = '대체' then jsonb_build_array(
      jsonb_build_object('account_code', coalesce(t.account_code, ''), 'side', '차변', 'amount', nullif(t.amount, 0), 'note', ''),
      jsonb_build_object('account_code', '253', 'side', '대변', 'amount', nullif(t.amount, 0), 'note', ''))
    else jsonb_build_array(
      jsonb_build_object('account_code', coalesce(t.account_code, ''), 'side', '차변', 'amount', nullif(t.amount, 0), 'note', ''),
      jsonb_build_object('account_code', '103', 'side', '대변', 'amount', nullif(t.amount, 0), 'note', ''))
  end,
  '옛 앱 전표 템플릿'
from erp.voucher_templates t
where t.kind = 'voucher' and t.legacy_collection = 'fixedCostTemplates'
  and not exists (select 1 from erp.journal_templates j where j.company_id = t.company_id and j.name = t.name)
on conflict (id) do nothing;
