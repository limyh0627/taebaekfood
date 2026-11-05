-- erp-core 저장소 supabase/projects.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 업무(프로젝트) — 기존 앱 '업무'와 같게(2026-11-05). more.sql·hr.sql 뒤에 돈다.
--  프로젝트 = 제목·설명·만든 사람(owner)·참여자. 지우면 '지움' 상태로만 남긴다(옛 앱과 같음).
--  할 일(project_tasks) = 상태 할 일/하는 중/검토/끝, 담당(참여자 중), 시작·마감일, 중요도, 태그, 체크리스트.
--  할 일마다 댓글. 누가 무엇을 했는지 project_activity에 남긴다.
--  권한: 참여자나 관리자만 고친다. 참여자 넣고 빼기·프로젝트 지우기는 만든 사람이나 관리자.
--        댓글 고치기·지우기는 쓴 사람이나 만든 사람·관리자.

alter table erp.work_projects add column if not exists updated_at timestamptz;
-- 옛 앱과 같게 active/deleted 둘뿐(업무에 '끝남' 상태는 없다 — 할 일마다 끝을 표시)
update erp.work_projects set status = case when status = 'deleted' then 'deleted' else 'active' end;
update erp.work_projects set participant_ids = array_remove(array_prepend(owner_id, coalesce(participant_ids, '{}')), null)
where owner_id is not null and not (owner_id = any (coalesce(participant_ids, '{}')));

create table if not exists erp.project_tasks (
  id          text primary key,
  company_id  text not null references erp.companies(id),
  project_id  text not null references erp.work_projects(id) on delete cascade,
  title       text not null,
  description text,
  status      text not null default 'todo' check (status in ('todo', 'doing', 'review', 'done')),
  assignee_id text,
  start_date  date,
  end_date    date,
  priority    text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  tags        text[] not null default '{}',
  checklist   jsonb not null default '[]',   -- [{id, title, checked}]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists project_tasks_project on erp.project_tasks (project_id);

create table if not exists erp.project_comments (
  id         text primary key,
  company_id text not null references erp.companies(id),
  project_id text not null references erp.work_projects(id) on delete cascade,
  task_id    text not null references erp.project_tasks(id) on delete cascade,
  author_id  text,
  body       text not null,
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  deleted_at timestamptz
);
create index if not exists project_comments_task on erp.project_comments (task_id);

create table if not exists erp.project_activity (
  id         bigint generated always as identity primary key,
  company_id text not null references erp.companies(id),
  project_id text not null references erp.work_projects(id) on delete cascade,
  task_id    text,
  actor_id   text,
  action     text not null,
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists project_activity_project on erp.project_activity (project_id, created_at desc);

do $$ declare t text; begin
  foreach t in array array['project_tasks', 'project_comments', 'project_activity'] loop
    execute format('alter table erp.%I enable row level security', t);
    execute format('drop policy if exists member_read on erp.%I', t);
    execute format('create policy member_read on erp.%I for select to authenticated using (company_id = any (app.my_company_ids()))', t);
    execute format('grant select on erp.%I to authenticated', t);
  end loop;
end $$;

-- 로그인한 사람의 직원 id(계정 관리에서 연결한 것)
create or replace function erp.my_employee(p_company text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select employee_id from app.member_employees where user_id = auth.uid() and company_id = p_company),
                  (select id from erp.employees where company_id = p_company and auth_uid = auth.uid()::text limit 1)) $$;

create or replace function public.my_employee_id(p_company text) returns text
language plpgsql stable security definer set search_path = '' as $$
begin perform erp.assert_member(p_company); return erp.my_employee(p_company); end $$;
revoke all on function public.my_employee_id(text) from public, anon;
grant execute on function public.my_employee_id(text) to authenticated;

-- 고칠 수 있는지 보고 (프로젝트, 나, 관리 권한 여부)를 돌려준다
create or replace function erp.project_guard(p_project text, p_manage boolean default false, out proj erp.work_projects, out me text, out manager boolean)
language plpgsql security definer set search_path = '' as $$
declare v_admin boolean;
begin
  select * into proj from erp.work_projects where id = p_project for update;
  if proj.id is null then raise exception '업무를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(proj.company_id);
  if proj.status = 'deleted' then raise exception '지운 업무입니다.'; end if;
  v_admin := proj.company_id = any (app.my_admin_company_ids());
  me := erp.my_employee(proj.company_id);
  if not v_admin and (me is null or not (me = any (coalesce(proj.participant_ids, '{}')))) then
    raise exception '이 업무의 참여자만 고칠 수 있습니다.';
  end if;
  manager := v_admin or (me is not null and me = proj.owner_id);
  if p_manage and not manager then raise exception '업무를 만든 사람이나 관리자만 할 수 있습니다.'; end if;
end $$;

create or replace function erp.project_log(p_project erp.work_projects, p_me text, p_task text, p_action text, p_detail text) returns void
language sql security definer set search_path = '' as $$
  insert into erp.project_activity (company_id, project_id, task_id, actor_id, action, detail)
  values (p_project.company_id, p_project.id, p_task, p_me, p_action, p_detail);
  update erp.work_projects set updated_at = now() where id = p_project.id;
$$;

-- 프로젝트 만들기·고치기: {id?, company_id, title, description}
create or replace function public.save_project(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_id text := nullif(p->>'id', ''); g record; v_me text; v_status text := 'active';
begin
  if coalesce(trim(p->>'title'), '') = '' then raise exception '제목을 넣으세요.'; end if;
  if v_id is null then
    perform erp.assert_member(v_company);
    v_me := erp.my_employee(v_company);
    if v_me is null and not (v_company = any (app.my_admin_company_ids())) then
      raise exception '계정에 직원이 연결되어 있지 않습니다. 관리자에게 계정 관리에서 연결해 달라고 하세요.';
    end if;
    v_id := 'proj-' || gen_random_uuid();
    insert into erp.work_projects (id, company_id, title, description, status, owner_id, participant_ids, created_at, updated_at)
    values (v_id, v_company, trim(p->>'title'), nullif(p->>'description', ''), v_status, v_me, array_remove(array[v_me], null), now(), now());
    perform erp.project_log((select w from erp.work_projects w where w.id = v_id), v_me, null, '업무 만듦', trim(p->>'title'));
    return v_id;
  end if;
  select * into g from erp.project_guard(v_id);
  if (g.proj).company_id <> v_company then raise exception '업무를 찾을 수 없습니다.'; end if;
  update erp.work_projects set title = trim(p->>'title'), description = nullif(p->>'description', ''), status = v_status,
         due_date = coalesce((p->>'due_date')::date, due_date)
  where id = v_id;
  perform erp.project_log(g.proj, g.me, null, '업무 고침', trim(p->>'title'));
  return v_id;
end $$;

create or replace function public.delete_project(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare g record;
begin
  select * into g from erp.project_guard(p_id, true);
  update erp.work_projects set status = 'deleted' where id = p_id;
  perform erp.project_log(g.proj, g.me, null, '업무 지움', (g.proj).title);
end $$;

-- 참여자 넣기·빼기. 만든 사람은 뺄 수 없다.
create or replace function public.set_project_member(p_project text, p_employee text, p_add boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare g record; v_name text;
begin
  select * into g from erp.project_guard(p_project, true);
  select name into v_name from erp.employees where id = p_employee and company_id = (g.proj).company_id;
  if v_name is null then raise exception '직원을 찾을 수 없습니다.'; end if;
  if p_add then
    if p_employee = any (coalesce((g.proj).participant_ids, '{}')) then return; end if;
    if cardinality(coalesce((g.proj).participant_ids, '{}')) >= 50 then raise exception '참여자는 50명까지입니다.'; end if;
    update erp.work_projects set participant_ids = array_append(coalesce(participant_ids, '{}'), p_employee) where id = p_project;
  else
    if p_employee = (g.proj).owner_id then raise exception '업무를 만든 사람은 뺄 수 없습니다.'; end if;
    update erp.work_projects set participant_ids = array_remove(participant_ids, p_employee) where id = p_project;
    update erp.project_tasks set assignee_id = null, updated_at = now() where project_id = p_project and assignee_id = p_employee and deleted_at is null;
  end if;
  perform erp.project_log(g.proj, g.me, null, case when p_add then '참여자 넣음' else '참여자 뺌' end, v_name);
end $$;

-- 할 일 만들기·고치기: {id?, project_id, title, description, status, assignee_id, start_date, end_date, priority, tags[], checklist?}
create or replace function public.save_project_task(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare g record; v_id text := nullif(p->>'id', ''); t erp.project_tasks; v_assignee text := nullif(p->>'assignee_id', '');
        v_start date := (nullif(p->>'start_date', ''))::date; v_end date := (nullif(p->>'end_date', ''))::date; v_new boolean := v_id is null;
begin
  select * into g from erp.project_guard(p->>'project_id');
  if coalesce(trim(p->>'title'), '') = '' then raise exception '할 일 제목을 넣으세요.'; end if;
  if coalesce(p->>'status', 'todo') not in ('todo', 'doing', 'review', 'done') then raise exception '상태를 고르세요.'; end if;
  if coalesce(p->>'priority', 'normal') not in ('low', 'normal', 'high') then raise exception '중요도를 고르세요.'; end if;
  if v_start is not null and v_end is not null and v_end < v_start then raise exception '마감일이 시작일보다 앞입니다.'; end if;
  if not v_new then
    select * into t from erp.project_tasks where id = v_id and project_id = (g.proj).id and deleted_at is null for update;
    if t.id is null then raise exception '할 일을 찾을 수 없습니다.'; end if;
  end if;
  if v_assignee is not null and not (v_assignee = any (coalesce((g.proj).participant_ids, '{}'))) and v_assignee is distinct from t.assignee_id then
    raise exception '담당은 참여자 중에서 고르세요.';
  end if;
  if v_new then
    v_id := 'task-' || gen_random_uuid();
    insert into erp.project_tasks (id, company_id, project_id, title) values (v_id, (g.proj).company_id, (g.proj).id, trim(p->>'title'));
  end if;
  update erp.project_tasks set title = trim(p->>'title'), description = nullif(p->>'description', ''), status = coalesce(p->>'status', 'todo'),
         assignee_id = v_assignee, start_date = v_start, end_date = v_end, priority = coalesce(p->>'priority', 'normal'),
         tags = coalesce(array(select distinct trim(x) from jsonb_array_elements_text(coalesce(p->'tags', '[]')) x where trim(x) <> ''), '{}'),
         checklist = case when p ? 'checklist' then erp.clean_checklist(p->'checklist') else checklist end,
         updated_at = now()
  where id = v_id;
  perform erp.project_log(g.proj, g.me, v_id,
    case when v_new then '할 일 만듦'
         when t.status <> coalesce(p->>'status', 'todo') then '상태 바꿈: ' || erp.task_status_label(t.status) || ' → ' || erp.task_status_label(coalesce(p->>'status', 'todo'))
         else '할 일 고침' end, trim(p->>'title'));
  return v_id;
end $$;

create or replace function erp.task_status_label(s text) returns text language sql immutable as $$
  select case s when 'todo' then '할 일' when 'doing' then '하는 중' when 'review' then '검토' when 'done' then '끝' else s end $$;

create or replace function erp.clean_checklist(v jsonb) returns jsonb language plpgsql immutable as $$
declare r jsonb := '[]'; x jsonb;
begin
  for x in select * from jsonb_array_elements(case when jsonb_typeof(v) = 'array' then v else '[]' end) loop
    if coalesce(trim(x->>'title'), '') <> '' then
      r := r || jsonb_build_array(jsonb_build_object('id', coalesce(nullif(x->>'id', ''), gen_random_uuid()::text), 'title', trim(x->>'title'),
                                                     'checked', coalesce((x->>'checked')::boolean, false)));
    end if;
  end loop;
  if jsonb_array_length(r) > 50 then raise exception '체크리스트는 50개까지입니다.'; end if;
  return r;
end $$;

-- 체크리스트 한 줄 체크·풀기(할 일 창을 안 열고)
create or replace function public.check_task_item(p_task text, p_item text, p_checked boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare g record; t erp.project_tasks; v_title text;
begin
  select * into t from erp.project_tasks where id = p_task and deleted_at is null;
  if t.id is null then raise exception '할 일을 찾을 수 없습니다.'; end if;
  select * into g from erp.project_guard(t.project_id);
  select x->>'title' into v_title from jsonb_array_elements(t.checklist) x where x->>'id' = p_item;
  if v_title is null then raise exception '체크리스트 항목을 찾을 수 없습니다.'; end if;
  update erp.project_tasks set updated_at = now(),
         checklist = (select jsonb_agg(case when x->>'id' = p_item then jsonb_set(x, '{checked}', to_jsonb(p_checked)) else x end) from jsonb_array_elements(checklist) x)
  where id = p_task;
  perform erp.project_log(g.proj, g.me, p_task, case when p_checked then '체크' else '체크 풂' end, v_title);
end $$;

create or replace function public.delete_project_task(p_task text) returns void
language plpgsql security definer set search_path = '' as $$
declare g record; t erp.project_tasks;
begin
  select * into t from erp.project_tasks where id = p_task and deleted_at is null;
  if t.id is null then raise exception '할 일을 찾을 수 없습니다.'; end if;
  select * into g from erp.project_guard(t.project_id);
  update erp.project_tasks set deleted_at = now(), updated_at = now() where id = p_task;
  perform erp.project_log(g.proj, g.me, p_task, '할 일 지움', t.title);
end $$;

-- 댓글: p_id 없으면 새로, 있으면 고침. p_body가 비면 지움.
create or replace function public.save_task_comment(p_task text, p_id text, p_body text) returns text
language plpgsql security definer set search_path = '' as $$
declare g record; t erp.project_tasks; c erp.project_comments; v_id text := nullif(p_id, '');
begin
  select * into t from erp.project_tasks where id = p_task and deleted_at is null;
  if t.id is null then raise exception '할 일을 찾을 수 없습니다.'; end if;
  select * into g from erp.project_guard(t.project_id);
  if length(coalesce(p_body, '')) > 5000 then raise exception '댓글은 5000자까지입니다.'; end if;
  if v_id is null then
    if coalesce(trim(p_body), '') = '' then raise exception '댓글을 적으세요.'; end if;
    v_id := 'cmt-' || gen_random_uuid();
    insert into erp.project_comments (id, company_id, project_id, task_id, author_id, body)
    values (v_id, t.company_id, t.project_id, t.id, g.me, trim(p_body));
    perform erp.project_log(g.proj, g.me, t.id, '댓글 씀', left(trim(p_body), 60));
    return v_id;
  end if;
  select * into c from erp.project_comments where id = v_id and task_id = t.id and deleted_at is null for update;
  if c.id is null then raise exception '댓글을 찾을 수 없습니다.'; end if;
  if not (g.manager or c.author_id = g.me) then raise exception '쓴 사람만 고치거나 지울 수 있습니다.'; end if;
  if coalesce(trim(p_body), '') = '' then
    update erp.project_comments set deleted_at = now() where id = v_id;
    perform erp.project_log(g.proj, g.me, t.id, '댓글 지움', left(c.body, 60));
  else
    update erp.project_comments set body = trim(p_body), edited_at = now() where id = v_id;
    perform erp.project_log(g.proj, g.me, t.id, '댓글 고침', left(trim(p_body), 60));
  end if;
  return v_id;
end $$;

revoke all on function public.save_project(jsonb), public.delete_project(text), public.set_project_member(text, text, boolean),
  public.save_project_task(jsonb), public.check_task_item(text, text, boolean), public.delete_project_task(text),
  public.save_task_comment(text, text, text) from public, anon;
grant execute on function public.save_project(jsonb), public.delete_project(text), public.set_project_member(text, text, boolean),
  public.save_project_task(jsonb), public.check_task_item(text, text, boolean), public.delete_project_task(text),
  public.save_task_comment(text, text, text) to authenticated;
revoke all on function erp.project_guard(text, boolean), erp.project_log(erp.work_projects, text, text, text, text), erp.my_employee(text) from public, anon;

-- 옛 앱 할 일·댓글 옮기기(시험 이전 때만: raw.docs가 있을 때). export가 workProjectTasks / workProjectComments로 올려 둔다.
do $$ begin
  if to_regclass('raw.docs') is null then return; end if;
  insert into erp.project_tasks (id, company_id, project_id, title, description, status, assignee_id, start_date, end_date, priority, tags, checklist, created_at, updated_at, deleted_at)
  select d.id, w.company_id, w.id, coalesce(nullif(trim(d.data->>'title'), ''), '(제목 없음)'), nullif(d.data->>'description', ''),
         case when d.data->>'status' in ('todo', 'doing', 'review', 'done') then d.data->>'status' else 'todo' end,
         (select e.id from erp.employees e where e.id = d.data->>'assigneeEmployeeId'),
         erp.to_date(d.data->>'startDate'), erp.to_date(d.data->>'endDate'),
         case when d.data->>'priority' in ('low', 'normal', 'high') then d.data->>'priority' else 'normal' end,
         erp.txt_arr(d.data->'tags'),
         coalesce((select jsonb_agg(jsonb_build_object('id', k, 'title', v->>'title', 'checked', coalesce((v->>'checked')::boolean, false)) order by k)
                   from jsonb_each(case when jsonb_typeof(d.data->'checklist') = 'object' then d.data->'checklist' else '{}' end) c(k, v)
                   where coalesce(v->>'title', '') <> ''), '[]'),
         coalesce(erp.to_ts(d.data->>'createdAt'), now()), coalesce(erp.to_ts(d.data->>'updatedAt'), now()), erp.to_ts(d.data->>'deletedAt')
  from raw.docs d join erp.work_projects w on w.id = d.data->>'projectId'
  where d.collection = 'workProjectTasks'
  on conflict (id) do nothing;

  insert into erp.project_comments (id, company_id, project_id, task_id, author_id, body, created_at, edited_at, deleted_at)
  select d.id, t.company_id, t.project_id, t.id, d.data->>'authorEmployeeId', d.data->>'body',
         coalesce(erp.to_ts(d.data->>'createdAt'), now()),
         case when coalesce((d.data->>'revision')::int, 1) > 1 then erp.to_ts(d.data->>'updatedAt') end, erp.to_ts(d.data->>'deletedAt')
  from raw.docs d join erp.project_tasks t on t.id = (d.data->>'projectId') || ':' || (d.data->>'taskId')
  where d.collection = 'workProjectComments' and coalesce(d.data->>'body', '') <> ''
  on conflict (id) do nothing;
end $$;
