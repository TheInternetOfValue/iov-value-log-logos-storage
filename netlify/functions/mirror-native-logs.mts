import { mirrorNativeLogs } from "../../src/lib/native-log/mirror";
export default async function mirrorNativeLogsTick() {
  const result = await mirrorNativeLogs();
  if (result?.failed) console.warn("native-log mirror", result);
}
export const config = { schedule: "*/15 * * * *" };
