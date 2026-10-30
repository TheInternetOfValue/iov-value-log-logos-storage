begin;

-- Structural assertions runnable with `supabase test db`.
select plan(19);

select has_table('public', 'intake_sessions', 'intake sessions exist');
select has_table('public', 'draft_slices', 'machine drafts exist');
select has_table('public', 'canonical_slices', 'canonical revisions exist');
select has_table('public', 'w_transitions', 'W events exist');
select has_table('public', 'credit_events', 'credit events exist');
select has_view('public', 'validation_queue', 'validation projection exists');
select has_view('public', 'daily_w_state', 'daily W projection exists');
select col_is_pk('public', 'audit_events', 'id', 'audit events have immutable identity');
select policies_are('public', 'intake_sessions', array['own_intakes','pilot_intakes_only'], 'intakes are owner-scoped');
select has_table('public', 'daily_plans', 'approved daily plans exist');
select has_table('public', 'daily_plan_blocks', 'daily plan blocks exist');
select has_table('public', 'campaigns', 'campaign definitions exist');
select has_table('public', 'campaign_events', 'campaign events exist');
select has_table('public', 'campaign_event_metric_movements', 'campaign movements exist');
select has_view('public', 'current_daily_plans', 'current plan projection exists');
select policies_are('public', 'campaign_events', array['own_campaign_events'], 'campaign events are owner-scoped');
select has_table('public', 'cinematic_day_reels', 'saved cinematic day reels exist');
select has_column('public', 'cinematic_day_reels', 'evidence_cutoff_at', 'cinematic reels preserve their evidence boundary');
select policies_are('public', 'cinematic_day_reels', array['own_cinematic_day_reels'], 'cinematic day reels are owner-scoped');

select * from finish();
rollback;
