create table public.member_identity_bindings (
  owner_id uuid primary key references public.members(id) on delete restrict,
  did text not null unique check (did = 'did:iov:member:10000000-0000-4000-8000-000000000001'),
  authority text not null default 'word-wallet-web' check (authority = 'word-wallet-web'),
  bound_at timestamptz not null default now()
);

insert into public.member_identity_bindings(owner_id, did)
select id, 'did:iov:member:10000000-0000-4000-8000-000000000001'
from public.members
on conflict (owner_id) do nothing;

create or replace function public.prevent_identity_binding_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Wellbeing Identity bindings are immutable and controlled by the identity authority';
end;
$$;

create trigger member_identity_bindings_immutable
before update or delete on public.member_identity_bindings
for each row execute function public.prevent_identity_binding_mutation();

alter table public.member_identity_bindings enable row level security;
create policy member_reads_identity_binding on public.member_identity_bindings
for select using (auth.uid() = owner_id);
grant select on public.member_identity_bindings to authenticated, service_role;
