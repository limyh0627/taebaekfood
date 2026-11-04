-- 시험 이전 1단계: Firestore 문서를 원본 그대로 담는 임시 저장소.
-- 변환(020)은 여기서 읽어 erp 스키마로 옮긴다. Firestore를 다시 읽지 않고 변환만 고쳐 다시 돌릴 수 있다.

-- 전환(실제 운영 시작) 뒤에는 이 파이프라인이 운영 데이터를 지우지 않게 멈춘다. 표시는 supabase/cutover-mark.sql.
do $$ begin
  if to_regclass('app.cutover') is not null then
    raise exception '이미 실제 운영으로 전환한 DB입니다. 시험 이전을 다시 돌리면 운영 데이터가 지워지므로 멈춥니다.';
  end if;
end $$;

create schema if not exists raw;

create table if not exists raw.docs (
  collection  text        not null,
  id          text        not null,
  company_id  text,
  data        jsonb       not null,
  imported_at timestamptz not null default now(),
  primary key (collection, id)
);

create index if not exists docs_collection_company on raw.docs (collection, company_id);

-- 앱 API에는 절대 열지 않는다. 직접 DB 접속(이전 스크립트)만 쓴다.
alter table raw.docs enable row level security;
revoke all on schema raw from anon, authenticated;
revoke all on all tables in schema raw from anon, authenticated;
