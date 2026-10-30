-- Preserve the provisional appointment and decisions; append its final successor.
alter table public.founder_pilot_appointments
  add column supersedes_appointment_id uuid references public.founder_pilot_appointments(id),
  add column authority_version_id uuid references public.founder_flat_rate_authority_versions(id);

alter table public.founder_pilot_appointments
  drop constraint founder_pilot_appointments_identity_ref_entity_id_role_key;
create unique index founder_appointment_version_unique
  on public.founder_pilot_appointments(identity_ref, entity_id, role, valid_from);
create trigger founder_appointments_append_only before update or delete
  on public.founder_pilot_appointments
  for each row execute function public.prevent_event_mutation();

insert into public.founder_pilot_appointments (
  id, identity_ref, entity_id, role, review_mode, settlement_authority,
  subject_scope, scopes, status, registry_version,
  supersedes_appointment_id, authority_version_id
)
select '84459f69-1edd-43e0-9358-f6b7c3a5f44f', a.subject_did, 'gfe',
  'gfe_validator', 'founder_self_review', true, 'self',
  array['performance_source_review'], 'active', '0.1.0',
  a.supersedes_appointment_id, a.id
from public.founder_flat_rate_authority_versions a
where a.id = '1ca67f1f-7ea2-48dc-91f7-fd61598419a2'
  and a.finality_authority and not a.external_validation_claimed
  and a.subject_scope = 'moses_only';

do $$ begin
  if not exists (select 1 from public.founder_pilot_appointments
    where id = '84459f69-1edd-43e0-9358-f6b7c3a5f44f') then
    raise exception 'FINAL_GFE_AUTHORITY_REQUIRED';
  end if;
end $$;
