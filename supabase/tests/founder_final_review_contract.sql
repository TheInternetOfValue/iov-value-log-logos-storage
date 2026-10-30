begin;
select plan(5);
select is((select count(*)::integer from public.founder_pilot_appointments where entity_id = 'gfe'), 2, 'GFE appointment history is preserved');
select is((select review_mode from public.founder_pilot_appointments where id = 'a8c9e734-1700-4657-ac80-43a0bda00ca4'), 'founder_self_review_provisional', 'historical provisional appointment is unchanged');
select ok((select settlement_authority from public.founder_pilot_appointments where entity_id = 'gfe' order by valid_from desc limit 1), 'newest GFE founder appointment can finalize');
select is((select supersedes_appointment_id::text from public.founder_pilot_appointments where id = '84459f69-1edd-43e0-9358-f6b7c3a5f44f'), 'a8c9e734-1700-4657-ac80-43a0bda00ca4', 'final appointment references its predecessor');
select ok((select a.finality_authority and not a.external_validation_claimed from public.founder_pilot_appointments p join public.founder_flat_rate_authority_versions a on a.id = p.authority_version_id where p.id = '84459f69-1edd-43e0-9358-f6b7c3a5f44f'), 'final appointment uses the existing self-ratified authority');
select * from finish();
rollback;
