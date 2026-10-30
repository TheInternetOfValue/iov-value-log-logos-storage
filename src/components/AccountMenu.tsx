import { TildeMenu } from "./TildeMenu";
import { memberSession } from "@/lib/members/session";
import { nativeLoggingOpen } from "@/lib/native-log/server";
export async function AccountMenu() {
  let personal = false, signedIn = false;
  try { personal = (await memberSession()).kind === "personal"; signedIn = true; } catch { /* Public menu retains sign-in destinations. */ }
  return <TildeMenu personal={personal} nativeLogging={signedIn && nativeLoggingOpen()} />;
}
