-- Pilot reference rates. These produce non-settlement Performance credits;
-- the dollar-like 100–500 scale is a pilot valuation reference, not a payout.

alter table public.community_rate_versions
  drop constraint if exists community_rate_versions_community_check;

insert into public.community_rate_versions (
  community,
  lane,
  skill_level,
  credits_per_hour,
  effective_from,
  version,
  created_by
)
select
  community::public.community_code,
  lane::public.sao_lane,
  skill_level::public.skill_level,
  credits_per_hour,
  '2000-01-01T00:00:00Z'::timestamptz,
  'pilot-standard-100-500-v1',
  members.id
from public.members
cross join (
  values
    ('house_of_bros', 'Learning', 'L0', 100),
    ('house_of_bros', 'Learning', 'L1', 200),
    ('house_of_bros', 'Learning', 'L2', 300),
    ('house_of_bros', 'Learning', 'L3', 400),
    ('house_of_bros', 'Learning', 'L4', 500),
    ('house_of_bros', 'Earning', 'L0', 100),
    ('house_of_bros', 'Earning', 'L1', 200),
    ('house_of_bros', 'Earning', 'L2', 300),
    ('house_of_bros', 'Earning', 'L3', 400),
    ('house_of_bros', 'Earning', 'L4', 500),
    ('house_of_bros', 'OrgBuilding', 'L0', 100),
    ('house_of_bros', 'OrgBuilding', 'L1', 200),
    ('house_of_bros', 'OrgBuilding', 'L2', 300),
    ('house_of_bros', 'OrgBuilding', 'L3', 400),
    ('house_of_bros', 'OrgBuilding', 'L4', 500),
    ('iov', 'Learning', 'L0', 100),
    ('iov', 'Learning', 'L1', 200),
    ('iov', 'Learning', 'L2', 300),
    ('iov', 'Learning', 'L3', 400),
    ('iov', 'Learning', 'L4', 500),
    ('iov', 'Earning', 'L0', 100),
    ('iov', 'Earning', 'L1', 200),
    ('iov', 'Earning', 'L2', 300),
    ('iov', 'Earning', 'L3', 400),
    ('iov', 'Earning', 'L4', 500),
    ('iov', 'OrgBuilding', 'L0', 100),
    ('iov', 'OrgBuilding', 'L1', 200),
    ('iov', 'OrgBuilding', 'L2', 300),
    ('iov', 'OrgBuilding', 'L3', 400),
    ('iov', 'OrgBuilding', 'L4', 500),
    ('gfe', 'Learning', 'L0', 100),
    ('gfe', 'Learning', 'L1', 200),
    ('gfe', 'Learning', 'L2', 300),
    ('gfe', 'Learning', 'L3', 400),
    ('gfe', 'Learning', 'L4', 500),
    ('gfe', 'Earning', 'L0', 100),
    ('gfe', 'Earning', 'L1', 200),
    ('gfe', 'Earning', 'L2', 300),
    ('gfe', 'Earning', 'L3', 400),
    ('gfe', 'Earning', 'L4', 500),
    ('gfe', 'OrgBuilding', 'L0', 100),
    ('gfe', 'OrgBuilding', 'L1', 200),
    ('gfe', 'OrgBuilding', 'L2', 300),
    ('gfe', 'OrgBuilding', 'L3', 400),
    ('gfe', 'OrgBuilding', 'L4', 500)
) as rates(community, lane, skill_level, credits_per_hour)
on conflict (community, lane, skill_level, version) do nothing;
