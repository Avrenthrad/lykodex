-- Daily Mastery refresh: run log, history-on-change, snapshot after the recompute.
--
-- NOT applied by the pull request. Run this whole file once in the
-- Supabase SQL editor for project zcwrlnljtfvslldwyldq (or
-- `supabase db push` against that project). Safe to re-run.
--
-- What it does:
--   1. mastery_refresh_runs — the Vercel cron (04:00 UTC) writes one
--      row per attempt. No client policies; only service_role inserts.
--      get_mastery_refresh_status() lets a signed-in user see whether
--      the last run finished, without any per-user data.
--   2. A trigger records a mastery_score_history row when
--      overall_mastery_score actually changes, so a friend's recompute
--      is in the chart's history immediately — not only as a synthetic
--      "now" point, and not only if the 04:00 copy happened to run after
--      the new value was saved.
--   3. Moves snapshot-mastery-scores-daily from 04:00 UTC to 05:00 UTC
--      and skips a second row when today's history already has this
--      score. The Vercel recompute starts at 04:00 and does live
--      Steam/Xbox/PSN calls; the old 04:00 snapshot copied the
--      pre-refresh score every day.

create table if not exists public.mastery_refresh_runs (
  id bigint generated always as identity primary key,
  source text not null default 'vercel-cron',
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  users_total integer,
  gaming_updated integer,
  overall_updated integer,
  history_written integer,
  no_data integer,
  failed integer,
  steam_fallbacks integer,
  error text
);

alter table public.mastery_refresh_runs enable row level security;

create index if not exists mastery_refresh_runs_started_idx
  on public.mastery_refresh_runs (started_at desc);

create or replace function public.get_mastery_refresh_status()
returns table (
  status text,
  started_at timestamptz,
  finished_at timestamptz,
  users_total integer,
  failed integer
)
language sql
security definer
set search_path = public
stable
as $$
  select r.status, r.started_at, r.finished_at, r.users_total, r.failed
  from public.mastery_refresh_runs r
  order by r.started_at desc
  limit 1;
$$;

revoke all on function public.get_mastery_refresh_status() from public, anon;
grant execute on function public.get_mastery_refresh_status() to authenticated;

create or replace function public.record_overall_mastery_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- security definer so the insert is not blocked by mastery_score_history
  -- having no insert policy for authenticated. The caller can already
  -- update their own profile; this only copies the new overall score.
  if tg_op = 'UPDATE'
     and new.overall_mastery_score is not null
     and new.overall_mastery_score > 0
     and abs(new.overall_mastery_score - coalesce(old.overall_mastery_score, 0)) >= 0.05 then
    insert into public.mastery_score_history (user_id, overall_mastery_score)
    values (new.id, new.overall_mastery_score);
  end if;
  return new;
end;
$$;

revoke all on function public.record_overall_mastery_history() from public, anon, authenticated;

drop trigger if exists profiles_record_overall_mastery_history on public.profiles;
create trigger profiles_record_overall_mastery_history
  after update of overall_mastery_score on public.profiles
  for each row
  execute function public.record_overall_mastery_history();

do $$
declare
  existing bigint;
begin
  select jobid into existing from cron.job where jobname = 'snapshot-mastery-scores-daily';
  if existing is not null then
    perform cron.unschedule(existing);
  end if;
end $$;

select cron.schedule(
  'snapshot-mastery-scores-daily',
  '0 5 * * *',
  $cmd$
    insert into public.mastery_score_history (user_id, overall_mastery_score)
    select p.id, p.overall_mastery_score
    from public.profiles p
    where p.overall_mastery_score > 0
      and not exists (
        select 1
        from public.mastery_score_history h
        where h.user_id = p.id
          and h.recorded_at >= date_trunc('day', now())
          and abs(h.overall_mastery_score - p.overall_mastery_score) < 0.05
      );
  $cmd$
);
