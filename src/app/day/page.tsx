import Link from "next/link";
import { CampaignDirectionCard } from "@/components/CampaignDirectionCard";
import { CinematicDayReel } from "@/components/CinematicDayReel";
import { DailyBharathi } from "@/components/DailyBharathi";
import { DailyMovementSummary, type DailyMovementReading } from "@/components/DailyMovementSummary";
import { DayClock, type DayClockPlan } from "@/components/DayClock";
import { DayTimelineAgenda, type DayAgendaItem } from "@/components/DayTimelineAgenda";
import { DailyOperatingPanel } from "@/components/DailyOperatingPanel";
import { campaignDirectionForDate } from "@/lib/campaign-direction-server";
import { SetupRequired } from "@/components/SetupRequired";
import { calculationIsActiveForDay } from "@/lib/day-clock";
import { buildDailyMovementProjection, type DailyMovementEvent } from "@/lib/day-movement";
import { dayNavigation } from "@/lib/day-navigation";
import { dailyBriefingForDate, weatherForDate } from "@/lib/day-external-context-server";
import { isConfigured } from "@/lib/env";
import { formatLocalTime, localDateFor } from "@/lib/format";
import { redirect } from "next/navigation";
import { memberPageSession } from "@/lib/members/session";
import { memberWriteBinding } from "@/lib/members/http";
import { memberWritingOpen } from "@/lib/members/admission";
import { nativeLoggingOpen } from "@/lib/native-log/server";
import { VoiceEntry } from "@/components/native-log/VoiceEntry";
import { AddedNotice } from "@/components/native-log/AddedNotice";
import { TodayView } from "@/components/members/TodayView";
import { CohortDashboard } from "@/components/cohort/CohortDashboard";
import { cohortSnapshot } from "@/lib/cohort/server";
import { dateSchema, type SavedMemberEntry } from "@/lib/members/entries";
import { entryColumns, readMemberEntry } from "@/lib/members/storage";
import { MemberDay } from "@/components/members/MemberDay";
import { findTimelineOverlaps } from "@/lib/timeline-integrity";
import { founderEventsAsReplayRows, scoreBranchForOccurrence, scoreRegimeForDate, type FounderViewEvent } from "@/lib/score-cutover";
import { formatWMovement } from "@/lib/w-presentation";
import { sharedDayFor } from "@/lib/field-station/shared-day";
import { memberDayProjection } from "@/lib/members/day-server";
import { datedAvailability } from "@/lib/field-station/dated-server";
import { DatedSetup } from "@/components/cohort/DatedSetup";
import { logosDemoEnabled } from "@/lib/logos-demo";

export const dynamic = "force-dynamic";

const DISPLAY_TIMEZONE = "Asia/Kolkata";
const ASSISTANT_URL = "https://chatgpt.com/g/g-JxRtWybbJ-value-log-assistant";

function todayInIndia() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DISPLAY_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function readableDate(value: string, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric", ...options }).format(new Date(`${value}T12:00:00Z`));
}

function durationLabel(totalMinutes: number) {
  const rounded = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (!hours) return `${minutes} min`;
  if (!minutes) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

function monthCalendar(selected: string) {
  const [year, month] = selected.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const dates = Array.from({ length: daysInMonth }, (_, index) => `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`);
  const monthName = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, 1)));
  const shifted = (offset: number) => new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 10);
  return { dates, firstWeekday, monthName, start: dates[0], end: dates.at(-1) ?? dates[0], previous: shifted(-1), next: shifted(1) };
}

function localClockMinutes(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const value = (type: "hour" | "minute") => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value("hour") * 60 + value("minute");
}

function communityLabel(value: string) {
  if (value === "house_of_bros") return "HouseOfBros";
  if (value === "iov") return "IoV";
  return "GFE";
}

export default async function DayPage({ searchParams }: { searchParams: Promise<{ date?: string; draft?: string; saved?: string; removed?: string; filter?: string; added?: string }> }) {
  if (!isConfigured() && !logosDemoEnabled()) return <SetupRequired />;
  const session = await memberPageSession();
  if (session.kind === "personal") {
    if (!session.onboarded) redirect("/onboarding");
    // Logging is its own sequence of screens; Today keeps the day itself.
    const requested = await searchParams;
    if (requested.draft && /^[0-9a-f-]{36}$/i.test(requested.draft))
      redirect(`/log?draft=${requested.draft}${requested.date && dateSchema.safeParse(requested.date).success ? `&date=${requested.date}` : ""}`);
    const cohort = await cohortSnapshot(session.user.id);
    const sharedEnabled = await sharedDayFor(session.user.id);
    const pilotTimezone = sharedEnabled ? DISPLAY_TIMEZONE : cohort?.enrollment.timezone ?? session.timezone;
    const today = localDateFor(new Date().toISOString(), pilotTimezone);
    const date = dateSchema.safeParse((await searchParams).date);
    const selected = date.success && date.data <= today ? date.data : today;
    // The owner-scoped clock is a read-only view for every member. The shared-day
    // switch still controls the separate submission and recovery capabilities.
    const projectedDay = await memberDayProjection(session.client, session.user.id, selected, cohort).catch(() => null);
    const shared = sharedEnabled ? projectedDay : null;
    // After a submission, name and highlight exactly the activities that log placed on this day.
    const added = shared && requested.added && /^[0-9a-f-]{36}$/i.test(requested.added)
      ? await session.client.from("native_log_day_index").select("occurrence_id,start_at").eq("native_draft_id", requested.added).is("superseded_at", null).limit(30)
      : null;
    const addedIds = (added?.data ?? []).filter((row) => row.start_at).map((row) => String(row.occurrence_id));
    const addedNotes = (added?.data ?? []).filter((row) => !row.start_at).length;
    const availability = shared && !cohort ? await datedAvailability(session.user.id, session.did) : null;
    const result = await session.client
      .from("member_activity_entries")
      .select(entryColumns, { count: "exact" })
      .eq("owner_id", session.user.id)
      .eq("activity_date", selected)
      .is("removed_at", null)
      .order("created_at")
      .order("id")
      .range(0, 49);
    let initialEntries: SavedMemberEntry[] = [];
    let initialError = Boolean(result.error);
    try {
      initialEntries = (result.data ?? [])
        .map(readMemberEntry)
        .filter((entry): entry is SavedMemberEntry => "text" in entry);
    } catch {
      initialError = true;
    }
    const notes = (
      <MemberDay
        embedded
        voiceDefault={nativeLoggingOpen()}
        // Keyed by date too: the Today stepper is a client navigation, and the notes must follow it.
        key={`${session.user.id}:${selected}`}
        today={today}
        initialDate={selected}
        initialEntries={initialEntries}
        initialTotal={result.count ?? 0}
        initialError={initialError}
        timezone={shared ? DISPLAY_TIMEZONE : session.timezone}
        binding={memberWriteBinding(session.user.id)}
        writing={memberWritingOpen()}
      />
    );
    // Today keeps the day circle as it is; the page around it is one calm column with logging pinned.
    return (
      <TodayView
        selected={selected}
        today={today}
        timed={projectedDay ? projectedDay.activities.length : 0}
        unavailable={!projectedDay}
        notes={shared ? shared.notes : null}
        logHref={nativeLoggingOpen() ? `/log?date=${selected}` : null}
        setup={availability && availability.eligible && !availability.qa && "policy" in availability ? <DatedSetup policy={availability.policy} house={availability.assignedHouse} binding={memberWriteBinding(session.user.id)} qa={availability.qa} /> : null}
        circle={<><DayClock memberView activities={projectedDay?.activities ?? []} plans={[]} isToday={selected === todayInIndia()} assistantUrl="" highlightIds={addedIds} quietIntro calculationActive={Boolean(cohort)} performanceTerm="Unassessed work" />{!projectedDay ? <p role="status">Your activities could not load on the clock. Your saved records remain available.</p> : null}{!sharedEnabled && pilotTimezone !== DISPLAY_TIMEZONE ? <p className="meta">The clock displays India time; your private notes use {pilotTimezone}.</p> : null}</>}
        notice={added?.data?.length ? <AddedNotice timed={addedIds.length} notes={addedNotes} /> : null}
      >
        {cohort ? (
          <>
            <CohortDashboard
              initial={cohort}
              binding={memberWriteBinding(session.user.id)}
              view="summary"
              day={selected}
            />
            <details className="today-section">
              <summary>Private notes outside the pilot</summary>
              {notes}
            </details>
          </>
        ) : shared ? null : (
          <details className="today-section">
            <summary>Private notes</summary>
            {notes}
          </details>
        )}
      </TodayView>
    );
  }
  const { client } = session;
  const query = await searchParams;
  const today = todayInIndia();
  const selected = query.date ?? today;
  const weatherPromise = weatherForDate(selected, today);
  const briefingPromise = dailyBriefingForDate(selected);
  const dayStart = `${selected}T00:00:00+05:30`;
  const dayEnd = `${selected}T23:59:59.999+05:30`;
  const calendar = monthCalendar(selected);
  const navigation = dayNavigation(selected, today);
  const stripDates = navigation.dates;
  const rangeStartDate = stripDates[0] < calendar.start ? stripDates[0] : calendar.start;
  const rangeEndDate = stripDates.at(-1)! > calendar.end ? stripDates.at(-1)! : calendar.end;
  const rangeStart = `${rangeStartDate}T00:00:00+05:30`;
  const rangeEnd = `${rangeEndDate}T23:59:59.999+05:30`;

  const { data: founderRun } = await client.from("current_promoted_founder_replay")
    .select("replay_run_id,baseline_effective_at,baseline_wellbeing_score")
    .eq("mode", "founder_v0_1_live").maybeSingle();
  const founderBaseline = founderRun ? {
    effective_at: founderRun.baseline_effective_at,
    wellbeing_score: founderRun.baseline_wellbeing_score,
  } : null;

  const [{ data: slices }, { data: rangeSlices }, { data: transitions }, { data: creditEvents }, { data: wReversals }, { data: creditReversals }, { data: timeline }, { data: planRows }, { data: campaignRows }, { data: reelRows }, { data: runningReplayRows }, { data: founderValues }] = await Promise.all([
    client.from("current_time_slices").select("id,start_at,end_at,timezone,activity,wellbeing_node,slice_type,community,sao_lane,skill_level,status").gte("start_at", dayStart).lte("start_at", dayEnd).order("start_at"),
    client.from("current_time_slices").select("id,start_at,end_at,timezone").gte("start_at", rangeStart).lte("start_at", rangeEnd),
    client.from("w_transitions").select("id,canonical_slice_id,pre_slice_w,post_slice_w,applied_change,canonical_slices!inner(start_at,end_at,timezone),replay_runs!inner(status)").eq("event_kind", "calculation").eq("replay_runs.status", "completed").gte("canonical_slices.end_at", rangeStart).lte("canonical_slices.end_at", rangeEnd),
    client.from("credit_events").select("id,canonical_slice_id,formula_result,canonical_slices!inner(start_at,timezone),replay_runs!inner(status)").eq("event_kind", "calculation").eq("replay_runs.status", "completed").gte("canonical_slices.start_at", rangeStart).lte("canonical_slices.start_at", rangeEnd),
    client.from("w_transitions").select("reversal_of,canonical_slices!inner(end_at),replay_runs!inner(status)").eq("event_kind", "reversal").eq("replay_runs.status", "completed").gte("canonical_slices.end_at", rangeStart).lte("canonical_slices.end_at", rangeEnd),
    client.from("credit_events").select("reversal_of,canonical_slices!inner(start_at),replay_runs!inner(status)").eq("event_kind", "reversal").eq("replay_runs.status", "completed").gte("canonical_slices.start_at", rangeStart).lte("canonical_slices.start_at", rangeEnd),
    client.from("canonical_slices").select("id,start_at,end_at,community,status").order("start_at"),
    client.from("current_daily_plans").select("id,daily_focus,status").eq("plan_date", selected).limit(1),
    selected === today ? client.from("campaigns").select("id,name,north_star_label,ends_on").eq("status", "active").lte("starts_on", today).gte("ends_on", today).limit(1) : Promise.resolve({ data: [] }),
    selected <= today ? client.from("current_cinematic_day_reels").select("id,title,duration_seconds,script_markdown,evidence_cutoff_at,approved_at").eq("reel_date", selected).order("approved_at", { ascending: false }).limit(1) : Promise.resolve({ data: [] }),
    client.from("replay_runs").select("id,status,from_timestamp,started_at").eq("status", "running").order("started_at", { ascending: false }).limit(1),
    founderRun ? client.from("founder_wellbeing_value_events")
      .select("id,canonical_slice_id,event_kind,vcperformance_event_amount,w_before,w_after,delta_w,protocol_finality_status,payability_status,canonical_slices!inner(id,start_at,end_at,timezone,activity,wellbeing_node,slice_type,community)")
      .eq("replay_run_id", founderRun.replay_run_id).gte("canonical_slices.end_at", rangeStart).lte("canonical_slices.end_at", rangeEnd) : Promise.resolve({ data: [] }),
  ]);
  const currentPlan = planRows?.[0] ?? null;
  const activeCampaign = campaignRows?.[0] ?? null;
  const currentReel = reelRows?.[0] ?? null;
  const [{ data: planBlocks }, { data: campaignMetrics }] = await Promise.all([
    currentPlan ? client.from("daily_plan_blocks").select("id,start_at,end_at,timezone,responsible_party,founder_activity,ai_codex_activity,intended_outcome,context,status,display_order").eq("daily_plan_id", currentPlan.id).order("display_order") : Promise.resolve({ data: [] }),
    activeCampaign ? client.from("campaign_metrics").select("id,label,unit,display_order").eq("campaign_id", activeCampaign.id).eq("is_active", true).order("display_order") : Promise.resolve({ data: [] }),
  ]);
  const metricIds = (campaignMetrics ?? []).map((metric) => metric.id);
  const [{ data: targetRows }, { data: movementRows }] = await Promise.all([
    metricIds.length ? client.from("campaign_metric_targets").select("campaign_metric_id,target_value,version").in("campaign_metric_id", metricIds).order("version", { ascending: false }) : Promise.resolve({ data: [] }),
    metricIds.length ? client.from("campaign_event_metric_movements").select("campaign_metric_id,delta").in("campaign_metric_id", metricIds) : Promise.resolve({ data: [] }),
  ]);
  const targets = new Map<string, number>();
  for (const target of targetRows ?? []) if (!targets.has(target.campaign_metric_id)) targets.set(target.campaign_metric_id, Number(target.target_value));
  const campaignTotals = new Map<string, number>();
  for (const movement of movementRows ?? []) campaignTotals.set(movement.campaign_metric_id, (campaignTotals.get(movement.campaign_metric_id) ?? 0) + Number(movement.delta));
  const operatingPlan = currentPlan ? { ...currentPlan, blocks: planBlocks ?? [] } : null;
  const operatingCampaign = activeCampaign ? { ...activeCampaign, metrics: (campaignMetrics ?? []).map((metric) => ({ ...metric, total: campaignTotals.get(metric.id) ?? 0, target: targets.get(metric.id) ?? null })) } : null;
  const [campaignDirection, weather, briefing] = await Promise.all([
    campaignDirectionForDate(selected),
    weatherPromise,
    briefingPromise,
  ]);

  const reversedW = new Set((wReversals ?? []).map((row) => row.reversal_of));
  const reversedCredits = new Set((creditReversals ?? []).map((row) => row.reversal_of));
  const historicalTransitions = (transitions ?? []).filter((row) => !reversedW.has(row.id)).filter((row) => {
    if (!founderBaseline) return true;
    const canonical = Array.isArray(row.canonical_slices) ? row.canonical_slices[0] : row.canonical_slices;
    return canonical && scoreBranchForOccurrence(canonical.start_at, founderBaseline.effective_at) === "historical_pilot";
  });
  const historicalCredits = (creditEvents ?? []).filter((row) => !reversedCredits.has(row.id)).filter((row) => {
    if (!founderBaseline) return true;
    const canonical = Array.isArray(row.canonical_slices) ? row.canonical_slices[0] : row.canonical_slices;
    return canonical && scoreBranchForOccurrence(canonical.start_at, founderBaseline.effective_at) === "historical_pilot";
  });
  const founderValueEvents = (founderValues ?? []) as FounderViewEvent[];
  const founderRows = founderEventsAsReplayRows(founderValueEvents);
  const activeTransitions = [...historicalTransitions, ...founderRows.wEvents];
  const activeCredits = [...historicalCredits, ...founderRows.creditEvents];
  const dayTransitions = activeTransitions.filter((row) => {
    const canonical = Array.isArray(row.canonical_slices) ? row.canonical_slices[0] : row.canonical_slices;
    return canonical && localDateFor(canonical.end_at, canonical.timezone) === selected;
  }).sort((left, right) => {
    const a = Array.isArray(left.canonical_slices) ? left.canonical_slices[0] : left.canonical_slices;
    const b = Array.isArray(right.canonical_slices) ? right.canonical_slices[0] : right.canonical_slices;
    return new Date(a?.end_at ?? 0).getTime() - new Date(b?.end_at ?? 0).getTime();
  });
  const dayCredits = activeCredits.filter((row) => {
    const canonical = Array.isArray(row.canonical_slices) ? row.canonical_slices[0] : row.canonical_slices;
    return canonical && localDateFor(canonical.start_at, canonical.timezone) === selected;
  });
  const selectedRegime = founderBaseline ? scoreRegimeForDate(selected, founderBaseline.effective_at) : "historical_pilot";
  const selectedTransitions = dayTransitions.filter((row) => selectedRegime === "historical_pilot"
    ? historicalTransitions.some((candidate) => candidate.id === row.id)
    : founderRows.wEvents.some((candidate) => candidate.id === row.id));
  const selectedCredits = dayCredits.filter((row) => selectedRegime === "historical_pilot"
    ? historicalCredits.some((candidate) => candidate.id === row.id)
    : founderRows.creditEvents.some((candidate) => candidate.id === row.id));
  const timelineTransitions = selectedRegime === "genesis_day" ? dayTransitions : selectedTransitions;
  const timelineCredits = selectedRegime === "genesis_day" ? dayCredits : selectedCredits;
  const transitionBySlice = new Map(timelineTransitions.map((row) => [row.canonical_slice_id, row]));
  const creditBySlice = new Map(timelineCredits.map((row) => [row.canonical_slice_id, row]));
  const totalCredits = selectedCredits.length ? selectedCredits.reduce((total, row) => total + Number(row.formula_result), 0) : null;
  const minutes = (slices ?? []).reduce((sum, slice) => sum + (new Date(slice.end_at).getTime() - new Date(slice.start_at).getTime()) / 60_000, 0);

  const allConflicts = findTimelineOverlaps(timeline ?? []);
  const dayConflict = allConflicts.find((conflict) =>
    localDateFor(conflict.first.start_at, DISPLAY_TIMEZONE) === selected || localDateFor(conflict.second.start_at, DISPLAY_TIMEZONE) === selected);

  const rangeSummary = new Map<string, { count: number; minutes: number }>();
  for (const slice of rangeSlices ?? []) {
    const date = localDateFor(slice.start_at, slice.timezone);
    const current = rangeSummary.get(date) ?? { count: 0, minutes: 0 };
    current.count += 1;
    current.minutes += (new Date(slice.end_at).getTime() - new Date(slice.start_at).getTime()) / 60_000;
    rangeSummary.set(date, current);
  }

  const endWByDate = new Map<string, number>();
  const movementByDate = new Map<string, number>();
  let carriedW: number | null = null;
  for (const transition of activeTransitions.sort((left, right) => {
    const a = Array.isArray(left.canonical_slices) ? left.canonical_slices[0] : left.canonical_slices;
    const b = Array.isArray(right.canonical_slices) ? right.canonical_slices[0] : right.canonical_slices;
    return new Date(a?.end_at ?? 0).getTime() - new Date(b?.end_at ?? 0).getTime();
  })) {
    const canonical = Array.isArray(transition.canonical_slices) ? transition.canonical_slices[0] : transition.canonical_slices;
    if (!canonical) continue;
    const date = localDateFor(canonical.end_at, canonical.timezone);
    carriedW = Number(transition.post_slice_w);
    endWByDate.set(date, carriedW);
    const regime = founderBaseline ? scoreRegimeForDate(date, founderBaseline.effective_at) : "historical_pilot";
    const visibleInRegime = regime === "historical_pilot"
      ? historicalTransitions.some((candidate) => candidate.id === transition.id)
      : founderRows.wEvents.some((candidate) => candidate.id === transition.id);
    if (visibleInRegime) movementByDate.set(date, (movementByDate.get(date) ?? 0) + Number(transition.applied_change));
  }
  const calendarScore = new Map<string, number | null>();
  const genesisDate = founderBaseline ? localDateFor(founderBaseline.effective_at, DISPLAY_TIMEZONE) : null;
  for (const date of calendar.dates) {
    if (founderBaseline && date === genesisDate) carriedW = Number(founderBaseline.wellbeing_score);
    if (endWByDate.has(date)) carriedW = endWByDate.get(date) ?? carriedW;
    calendarScore.set(date, carriedW);
  }

  const timelineSlices = (slices ?? []).map((slice, index, all) => {
    const startMinute = localClockMinutes(slice.start_at, slice.timezone);
    const rawDuration = (new Date(slice.end_at).getTime() - new Date(slice.start_at).getTime()) / 60_000;
    const endMinute = Math.min(1440, startMinute + rawDuration);
    const overlappingBefore = all.slice(0, index).filter((other) => {
      const otherStart = localClockMinutes(other.start_at, other.timezone);
      const otherEnd = otherStart + (new Date(other.end_at).getTime() - new Date(other.start_at).getTime()) / 60_000;
      return otherStart < endMinute && otherEnd > startMinute;
    }).length;
    return { ...slice, startMinute, endMinute, lane: Math.min(overlappingBefore, 2) };
  });
  const agendaFilter: "all" | "wellbeing" | "performance" = ["all", "wellbeing", "performance"].includes(query.filter ?? "") ? query.filter as "all" | "wellbeing" | "performance" : "all";
  const runningReplay = runningReplayRows?.[0] ?? null;
  const calculationActive = calculationIsActiveForDay({
    dayEnd,
    replay: runningReplay ? { status: runningReplay.status, fromTimestamp: runningReplay.from_timestamp } : null,
    sliceStatuses: timelineSlices.map((slice) => slice.status),
  });
  const historicalMovementEvents: DailyMovementEvent[] = historicalTransitions.flatMap((row) => {
    const canonical = Array.isArray(row.canonical_slices) ? row.canonical_slices[0] : row.canonical_slices;
    if (!canonical || localDateFor(canonical.end_at, canonical.timezone) !== selected) return [];
    return [{ id: row.id, settledAt: canonical.end_at, preW: row.pre_slice_w, change: row.applied_change, postW: row.post_slice_w }];
  });
  const founderMovementEvents: DailyMovementEvent[] = founderValueEvents.flatMap((row) => {
    const canonical = Array.isArray(row.canonical_slices) ? row.canonical_slices[0] : row.canonical_slices;
    if (!canonical || localDateFor(canonical.end_at, canonical.timezone ?? DISPLAY_TIMEZONE) !== selected) return [];
    return [{ id: row.id, settledAt: canonical.end_at, preW: row.w_before, change: row.delta_w, postW: row.w_after }];
  });
  const pendingMovement = calculationActive || timelineSlices.some((slice) => slice.status === "validated");
  const movementReadings: DailyMovementReading[] = selectedRegime === "genesis_day" ? [
    { id: "historical", label: "Historical Pilot W before Genesis", projection: buildDailyMovementProjection({ events: historicalMovementEvents }) },
    { id: "canonical", label: "Canonical founder W after Genesis", projection: buildDailyMovementProjection({ events: founderMovementEvents, pending: pendingMovement }) },
  ] : selectedRegime === "historical_pilot" ? [
    { id: "historical", label: "Historical Pilot W", projection: buildDailyMovementProjection({ events: historicalMovementEvents, pending: pendingMovement }) },
  ] : [
    { id: "canonical", label: "Canonical founder W", projection: buildDailyMovementProjection({ events: founderMovementEvents, pending: pendingMovement }) },
  ];
  const dayMovement = movementReadings.length === 1 ? movementReadings[0].projection.netW : null;
  const summaryBits = timelineSlices.length ? [`${slices?.length ?? 0} ${(slices?.length ?? 0) === 1 ? "activity" : "activities"}`, `${durationLabel(minutes)} recorded`] : ["No activities recorded yet"];
  if (dayMovement !== null) summaryBits.push(formatWMovement(dayMovement));
  if (totalCredits !== null) summaryBits.push(`${Math.round(totalCredits).toLocaleString("en-IN")} ${selectedRegime === "historical_pilot" ? "historical credits" : "VCperformance"}`);
  const conflictIds = new Set(dayConflict ? [dayConflict.first.id, dayConflict.second.id] : []);
  const agendaItems = timelineSlices.map((slice): DayAgendaItem => {
    const transition = transitionBySlice.get(slice.id);
    const credit = creditBySlice.get(slice.id);
    const needsReview = slice.status === "validation_pending" || slice.status === "validation_rejected";
    const calculating = slice.status === "validated";
    const detail = slice.slice_type === "performance" ? [communityLabel(slice.community), slice.sao_lane, slice.skill_level].filter(Boolean).join(" · ") : slice.wellbeing_node;
    const historical = founderBaseline ? scoreBranchForOccurrence(slice.start_at, founderBaseline.effective_at) === "historical_pilot" : true;
    const movementResult = transition ? formatWMovement(transition.applied_change) : "";
    const performanceResult = credit ? `${Math.round(Number(credit.formula_result)).toLocaleString("en-IN")} ${historical ? "historical credits" : "VCperformance"}` : "";
    const result = [movementResult, performanceResult].filter(Boolean).join(" · ") || (needsReview ? "Needs review" : "");
    return {
      id: slice.id,
      activity: slice.activity,
      detail,
      start: formatLocalTime(slice.start_at, slice.timezone),
      end: formatLocalTime(slice.end_at, slice.timezone),
      result,
      needsReview,
      calculating,
      type: slice.slice_type === "performance" ? "performance" : "wellbeing",
      node: slice.wellbeing_node,
      startMinute: slice.startMinute,
      endMinute: slice.endMinute,
      conflict: conflictIds.has(slice.id),
      startPercent: (slice.startMinute / 1440) * 100,
      widthPercent: Math.max(((slice.endMinute - slice.startMinute) / 1440) * 100, .65),
      lane: slice.lane,
    };
  });
  const clockPlans = (planBlocks ?? []).map((block): DayClockPlan => {
    const startMinute = localClockMinutes(block.start_at, block.timezone);
    const rawDuration = (new Date(block.end_at).getTime() - new Date(block.start_at).getTime()) / 60_000;
    return {
      id: block.id,
      activity: block.founder_activity,
      start: formatLocalTime(block.start_at, block.timezone),
      end: formatLocalTime(block.end_at, block.timezone),
      startMinute,
      endMinute: Math.min(1440, startMinute + rawDuration),
      status: block.status,
      aiCodexActivity: block.ai_codex_activity,
      intendedOutcome: block.intended_outcome,
      startAt: block.start_at,
      endAt: block.end_at,
    };
  });

  return <section className="canonical-day">
    <header className="canonical-day-heading">
      <div><h1>{readableDate(selected)}</h1><p>{summaryBits.join(" · ")}</p></div>
      <DailyBharathi date={selected} />
    </header>
    {nativeLoggingOpen() ? <VoiceEntry date={selected} draft={query.draft}/> : null}

    {selectedRegime === "genesis_day" && founderBaseline ? <section className="card genesis-day-boundary"><p className="meta">Measurement regime changed during this day</p><h2>Genesis constituted · {Number(founderBaseline.wellbeing_score).toFixed(2)} / 1000</h2><p>Earlier occurrences remain Historical Pilot W. Occurrences beginning after {formatLocalTime(founderBaseline.effective_at, DISPLAY_TIMEZONE)} use the canonical HouseOfBros founder policy. The two series are never joined or added.</p></section> : null}

    {query.saved ? <div className="success" style={{ marginBottom: 20 }}>Confirmed. {Number(query.saved) > 1 ? `${query.saved} activities were` : "The activity was"} processed for this date.</div> : null}
    {query.removed === "duplicate" ? <div className="success" style={{ marginBottom: 20 }}>Duplicate removed. Its audit record remains, and affected calculations were replayed.</div> : null}

    <DayClock
      activities={agendaItems}
      assistantUrl={ASSISTANT_URL}
      nativeLogHref={nativeLoggingOpen() ? `/log?date=${selected}` : undefined}
      briefing={briefing}
      calculationActive={calculationActive}
      conflictHref={dayConflict ? `/slices/canonical/${dayConflict.first.id}` : undefined}
      focus={currentPlan?.daily_focus}
      isToday={selected === today}
      plans={clockPlans}
      performanceTerm={selectedRegime === "historical_pilot" ? "Historical Performance credits" : "VCperformance"}
      weather={weather}
    />

    <nav className="day-pager" aria-label="Move between days">
      <Link href={`/day?date=${navigation.previous}`} aria-label={`Previous day, ${readableDate(navigation.previous)}`}>← Previous day</Link>
      <Link className={navigation.isToday ? "current" : undefined} href={`/day?date=${navigation.today}`} aria-current={navigation.isToday ? "date" : undefined}>Today</Link>
      {navigation.next ? <Link href={`/day?date=${navigation.next}`} aria-label={`Next day, ${readableDate(navigation.next)}`}>Next day →</Link> : <span aria-disabled="true">Next day →</span>}
    </nav>

    <nav className="seven-day-strip" aria-label="Seven day navigation">
      {stripDates.map((date) => {
        const summary = rangeSummary.get(date) ?? { count: 0, minutes: 0 };
        return <Link className={`${date === selected ? "selected" : ""}${date === today ? " today" : ""}`} href={`/day?date=${date}`} key={date} aria-current={date === selected ? "date" : undefined}>
          <span>{new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short" }).format(new Date(`${date}T12:00:00Z`))}</span>
          <strong>{new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00Z`))}</strong>
          <small>{summary.count} {summary.count === 1 ? "activity" : "activities"}<br />{durationLabel(summary.minutes)}</small>
        </Link>;
      })}
    </nav>

    <DailyMovementSummary date={selected} readings={movementReadings} />

    <DailyOperatingPanel selected={selected} today={today} plan={operatingPlan} campaign={operatingCampaign} campaignDirection={<CampaignDirectionCard direction={campaignDirection} />} />

    {currentReel ? <CinematicDayReel title={currentReel.title} durationSeconds={currentReel.duration_seconds} script={currentReel.script_markdown} evidenceCutoffAt={currentReel.evidence_cutoff_at} /> : null}

    {selectedTransitions.length ? <section className="identity-entry-card"><div><p className="meta">{selectedRegime === "historical_pilot" ? "Historical Pilot W" : "Canonical movement"}</p><h2>Replay how this day moved</h2><p>{selectedTransitions.length} completed {selectedTransitions.length === 1 ? "transition is" : "transitions are"} available as a separate private reading.</p></div><div className="identity-entry-preview" aria-hidden="true"><i /><i /><i /><b>~</b></div><Link className="button secondary" href={`/explore?date=${selected}`}>Open replay →</Link></section> : null}

    <details className="month-disclosure">
      <summary><span>View month</span><span>{calendar.monthName}</span></summary>
      <section className="card activity-calendar" aria-labelledby="activity-heading">
        <div className="calendar-legend">
          <div><p className="meta">Monthly activity</p><h2 id="activity-heading">{calendar.monthName}</h2><p className="meta">Logged days show their end-of-day Wellbeing Score and activity count.</p></div>
          <div className="month-controls"><Link className="button secondary" href={`/day?date=${calendar.previous}`} aria-label="Previous month">←</Link><Link className="button secondary" href={`/day?date=${calendar.next}`} aria-label="Next month">→</Link></div>
        </div>
        <div className="month-weekdays" aria-hidden="true">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="month-grid">
          {Array.from({ length: calendar.firstWeekday }, (_, index) => <i className="month-day empty-day" key={`blank-${index}`} />)}
          {calendar.dates.map((date) => {
            const count = rangeSummary.get(date)?.count ?? 0;
            const endW = calendarScore.get(date) ?? null;
            const movement = movementByDate.get(date) ?? 0;
            const tone = !count ? "empty" : endW === null ? "unavailable" : movement > 0 ? "positive" : movement < 0 ? "negative" : "neutral";
            return <Link className={`month-day ${tone}${date === selected ? " selected" : ""}${date === today ? " current" : ""}`} href={`/day?date=${date}`} key={date} aria-label={`${readableDate(date)}: ${count} records`}>
              <span>{Number(date.slice(-2))}</span>{count ? <div className="month-day-summary">{endW !== null ? <strong>{endW.toFixed(2)}</strong> : null}<em>{count} {count === 1 ? "activity" : "activities"}</em></div> : null}
            </Link>;
          })}
        </div>
      </section>
    </details>

    {timelineSlices.length ? <DayTimelineAgenda calculationActive={calculationActive} date={selected} filter={agendaFilter} items={agendaItems} performanceTerm={selectedRegime === "historical_pilot" ? "historical credits" : "VCperformance"} /> : <div className="empty canonical-empty">Nothing has been recorded for this day yet.</div>}

    <details className="sources-protocol"><summary>Submission and provenance details</summary><div><Link href={`/privacy?date=${selected}`}>Privacy &amp; data for this date</Link><Link href={`/protocol?date=${selected}`}>Provenance and calculation detail</Link></div></details>
  </section>;
}
