begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Logos Storage mirror of submitted native logs. Postgres stays the source of truth;
-- the mirror holds the same AES-GCM ciphertext, addressed by CID. Rows are never deleted:
-- removal of the source draft is recorded as node_deleted_at.
create table public.native_log_mirrors (
  owner_id uuid not null,
  draft_id uuid not null,
  revision integer not null check (revision > 0),
  cid text not null check (length(cid) between 10 and 200),
  content_digest text not null,
  mirrored_at timestamptz not null default now(),
  node_deleted_at timestamptz,
  primary key (owner_id, draft_id, revision),
  foreign key (owner_id, draft_id) references public.native_log_drafts(owner_id, id)
);
create index native_log_mirrors_live on public.native_log_mirrors(owner_id, draft_id) where node_deleted_at is null;
alter table public.native_log_mirrors enable row level security;
-- Default privileges grant service_role everything; mirror history is append/update only.
revoke all on public.native_log_mirrors from public, anon, authenticated, service_role;
grant select, insert, update on public.native_log_mirrors to service_role;

-- Submitted drafts whose current revision has no mirror yet.
create function public.pending_native_log_mirrors(p_limit integer)
returns table(owner_id uuid, id uuid, revision integer, content_ciphertext text, content_iv text, content_auth_tag text, content_key_version integer, content_digest text)
language sql stable security definer set search_path = '' as $$
  select d.owner_id, d.id, d.revision, d.content_ciphertext, d.content_iv, d.content_auth_tag, d.content_key_version, d.content_digest
  from public.native_log_drafts d
  where d.status = 'submitted'
    and not exists (select 1 from public.native_log_mirrors m where m.owner_id = d.owner_id and m.draft_id = d.id and m.revision = d.revision)
  order by d.submitted_at nulls last, d.id
  limit least(greatest(p_limit, 1), 50);
$$;

-- Live mirror copies whose source is removed or superseded by a newer revision.
create function public.stale_native_log_mirrors(p_limit integer)
returns table(owner_id uuid, draft_id uuid, revision integer, cid text)
language sql stable security definer set search_path = '' as $$
  select m.owner_id, m.draft_id, m.revision, m.cid
  from public.native_log_mirrors m
  join public.native_log_drafts d on d.owner_id = m.owner_id and d.id = m.draft_id
  where m.node_deleted_at is null and (d.status = 'removed' or d.revision <> m.revision)
  order by m.mirrored_at, m.draft_id
  limit least(greatest(p_limit, 1), 50);
$$;

revoke all on function public.pending_native_log_mirrors(integer), public.stale_native_log_mirrors(integer) from public, anon, authenticated;
grant execute on function public.pending_native_log_mirrors(integer), public.stale_native_log_mirrors(integer) to service_role;
commit;
