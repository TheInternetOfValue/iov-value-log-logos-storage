-- Repair the initial campaign bootstrap function after its production migration.
-- The first migration created the tables safely; this only removes a PL/pgSQL
-- variable/column naming collision in the controlled setup helper.
create or replace function public.bootstrap_august_15_campaign(p_owner_id uuid, p_targets jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_campaign_id uuid; metric record; v_metric_id uuid; current_target numeric;
begin
  insert into public.campaigns(owner_id, slug, name, starts_on, ends_on, status)
  values (p_owner_id, 'august-15-iov-launch-2026', 'August 15 Internet of Value Launch Campaign', '2026-07-20', '2026-08-20', 'active')
  on conflict (owner_id, slug) do update set name = excluded.name
  returning id into v_campaign_id;
  for metric in select * from (values
    ('revenue_collected', 'Revenue collected', 'inr', 1),
    ('confirmed_book_orders', 'Confirmed book orders', 'count', 2),
    ('founders_edition_purchases', 'Founder''s Edition purchases', 'count', 3),
    ('confirmed_registrations', 'Confirmed registrations', 'count', 4),
    ('workshop_purchases_deposits', 'Workshop purchases/deposits', 'count', 5),
    ('partnership_commitments', 'Partnership commitments', 'count', 6)
  ) as defaults(key, label, unit, display_order) loop
    insert into public.campaign_metrics(campaign_id, owner_id, key, label, unit, display_order)
    values (v_campaign_id, p_owner_id, metric.key, metric.label, metric.unit, metric.display_order)
    on conflict (campaign_id, key) do update set label = excluded.label, display_order = excluded.display_order
    returning id into v_metric_id;
    if p_targets ? metric.key then
      select target_value into current_target from public.campaign_metric_targets where campaign_metric_id = v_metric_id order by version desc limit 1;
      if current_target is distinct from (p_targets->>metric.key)::numeric then
        insert into public.campaign_metric_targets(campaign_metric_id, owner_id, target_value, version)
        select v_metric_id, p_owner_id, (p_targets->>metric.key)::numeric, coalesce(max(version), 0) + 1
        from public.campaign_metric_targets where campaign_metric_id = v_metric_id;
      end if;
    end if;
  end loop;
  return v_campaign_id;
end; $$;
