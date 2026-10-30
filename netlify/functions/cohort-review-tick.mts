import { runCohortQueue } from "../../src/lib/cohort/queue";
export default async function cohortReviewTick() {
  await runCohortQueue();
}
export const config = { schedule: "*/5 * * * *" };
