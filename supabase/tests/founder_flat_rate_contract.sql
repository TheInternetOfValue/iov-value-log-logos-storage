begin;

select plan(25);

select has_table('public', 'founder_flat_rate_authority_versions', 'bitemporal authority versions exist');
select has_table('public', 'founder_flat_community_rate_policy_versions', 'flat community rate policy versions exist');
select has_table('public', 'founder_wellbeing_replay_verifications', 'append-only replay verifications exist');
select has_table('public', 'founder_wellbeing_replay_promotions', 'append-only replay promotions exist');
select has_view('public', 'current_promoted_founder_replay', 'current replay is an explicit promotion projection');
select has_view('public', 'current_promoted_founder_value_events', 'current value events come from the promoted replay');
select has_function('public', 'founder_occurrence_is_post_genesis', array['uuid','timestamp with time zone'], 'Genesis comparison is database-owned');
select has_function('public', 'resolve_founder_flat_community_rate', array['text','community_code','sao_lane','timestamp with time zone','timestamp with time zone'], 'rate resolution is bitemporal and database-owned');
select has_function('public', 'promote_verified_founder_replay', array['uuid','text','text'], 'promotion is a single database transaction');
select has_function('public', 'founder_round_half_even', array['numeric','integer'], 'database uses canonical half-even rounding');
select has_function('public', 'calculate_founder_performance_fixed12', array['numeric','bigint','numeric'], 'database can cross-check fixed12 Performance value');
select is(to_char(public.founder_round_half_even(1.0000000000005, 12), 'FM999999999999999999990.000000000000'), '1.000000000000', 'positive half-even tie rounds to even');
select is(to_char(public.founder_round_half_even(-1.0000000000015, 12), 'FM999999999999999999990.000000000000'), '-1.000000000002', 'negative half-even tie rounds to even');

select is(
  (select community_rate_amount from public.resolve_founder_flat_community_rate(
    'did:iov:member:10000000-0000-4000-8000-000000000001', 'iov', 'Learning',
    '2026-07-28T12:00:00Z', clock_timestamp()
  )),
  '750.000000000000',
  'IoV SM3 resolves USD 750/hour'
);
select is(
  (select community_rate_amount from public.resolve_founder_flat_community_rate(
    'did:iov:member:10000000-0000-4000-8000-000000000001', 'gfe', 'OrgBuilding',
    '2026-07-28T12:00:00Z', clock_timestamp()
  )),
  '500.000000000000',
  'GFE-3.3.3 resolves USD 500/hour'
);
select is(
  (select rate_null_reason::text from public.resolve_founder_flat_community_rate(
    'did:iov:member:10000000-0000-4000-8000-000000000001', 'iov', 'Learning',
    '2026-07-28T11:11:34.890018Z', clock_timestamp()
  )),
  'pre_genesis',
  'Genesis boundary equality is excluded'
);
select is(
  (select community_rate_amount from public.resolve_founder_flat_community_rate(
    'did:iov:member:10000000-0000-4000-8000-000000000001', 'iov', 'Learning',
    '2026-07-28T11:11:34.890019Z', clock_timestamp()
  )),
  '750.000000000000',
  'one database microsecond after Genesis is eligible'
);
select is(
  (select rate_null_reason::text from public.resolve_founder_flat_community_rate(
    'did:iov:member:10000000-0000-4000-8000-000000000001', 'iov', 'Learning',
    '2026-07-28T12:00:00Z', '2026-07-28T12:00:00Z'
  )),
  'policy_not_recorded_as_of_system_time',
  'retroactive policy is invisible before transaction-time recording'
);
select is(
  (select protocol_finality_status from public.resolve_founder_flat_community_rate(
    'did:iov:member:10000000-0000-4000-8000-000000000001', 'gfe', 'Earning',
    '2026-07-28T12:00:00Z', clock_timestamp()
  )),
  'final',
  'GFE Moses-only self-ratification carries valuation finality'
);
select is(
  (select payability_status from public.resolve_founder_flat_community_rate(
    'did:iov:member:10000000-0000-4000-8000-000000000001', 'gfe', 'Earning',
    '2026-07-28T12:00:00Z', clock_timestamp()
  )),
  'non_payable',
  'protocol finality is always explicitly non-payable'
);
select results_eq(
  $$ select vcom_event_amount, vcperformance_event_amount
     from public.calculate_founder_performance_fixed12(750.000000000000, 5400000000, 771.000000000000) $$,
  $$ values ('1125.000000000000'::text, '867.375000000000'::text) $$,
  'database IoV fixed12 example matches the canonical contract'
);
select results_eq(
  $$ select vcom_event_amount, vcperformance_event_amount
     from public.calculate_founder_performance_fixed12(500.000000000000, 5400000000, 771.000000000000) $$,
  $$ values ('750.000000000000'::text, '578.250000000000'::text) $$,
  'database GFE fixed12 example matches the canonical contract'
);
select results_eq(
  $$ select distinct community_rate_unit from public.founder_flat_community_rate_policy_versions order by 1 $$,
  $$ values ('USD_per_hour'::text) $$,
  'community rate has an hourly typed unit'
);
select results_eq(
  $$ select unnest(routes)::text from public.founder_flat_community_rate_policy_versions where community = 'iov' order by 1 $$,
  $$ values ('Earning'::text), ('Learning'::text), ('OrgBuilding'::text) $$,
  'IoV flat rate covers all three routes'
);
select results_eq(
  $$ select unnest(routes)::text from public.founder_flat_community_rate_policy_versions where community = 'gfe' order by 1 $$,
  $$ values ('Earning'::text), ('Learning'::text), ('OrgBuilding'::text) $$,
  'GFE flat rate covers all three routes'
);

select * from finish();
rollback;
