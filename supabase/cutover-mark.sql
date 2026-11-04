-- 실제 운영 전환 표시. 전환일에 마지막 이전과 대조가 끝난 뒤 SQL Editor에서 한 번만 돌린다.
-- 이 표가 있으면 시험 이전 파이프라인(000·010)이 시작하자마자 멈춰 운영 데이터를 지우지 않는다.
-- 되돌리기(다시 시험 단계로): drop table app.cutover;  — 운영 데이터가 지워져도 될 때만.
create schema if not exists app;
create table if not exists app.cutover (done_at timestamptz not null default now(), note text);
insert into app.cutover (note) values ('실제 운영 전환');
revoke all on app.cutover from anon, authenticated;
