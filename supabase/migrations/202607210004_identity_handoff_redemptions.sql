-- Append-only proof that a Wellbeing Identity handoff code was redeemed.
-- The code itself is never stored, and a unique hash makes each code one-use.
create table public.identity_handoff_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  did text not null,
  redeemed_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index identity_handoff_redemptions_did_idx
on public.identity_handoff_redemptions (did, redeemed_at desc);

alter table public.identity_handoff_redemptions enable row level security;
grant insert, select on public.identity_handoff_redemptions to service_role;
