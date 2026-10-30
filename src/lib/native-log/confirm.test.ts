import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const { rpc, timeline } = vi.hoisted(()=>({rpc:vi.fn(),timeline:vi.fn()}));
vi.mock("@/lib/supabase/admin",()=>({adminClient:()=>({rpc})}));
vi.mock("@/lib/timeline-integrity",()=>({assertTimelineIntegrity:timeline}));
import { prepareNativeConfirmation } from "./confirm";
import { emptyNativeActivity, newNativeDraft } from "./draft";
import { decryptNarrative } from "@/lib/crypto";
const personal={kind:"personal",user:{id:"22222222-2222-4222-8222-222222222222"}} as never;
const now=new Date("2026-10-25T18:00:00Z");
const draft=()=>({...newNativeDraft("a".repeat(64),"2026-10-24","Asia/Kolkata","personal"),transcript:"I slept from 11pm to 7am",activities:[{...emptyNativeActivity("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),activity:"Sleep",startLocal:"2026-10-23T23:00",endLocal:"2026-10-24T07:00",node:"Physiology" as const,sleepRest:true}]});
beforeEach(()=>{vi.stubEnv("NARRATIVE_ENCRYPTION_KEY_BASE64",Buffer.alloc(32,3).toString("base64"));vi.stubEnv("AUDIT_DIGEST_KEY","synthetic-test-digest-key-longer-than-thirty-two");rpc.mockReset();timeline.mockReset();timeline.mockResolvedValue(undefined);});
afterEach(()=>vi.unstubAllEnvs());
describe("confirmed native records",()=>{
 it("creates encrypted unassessed private entries without recognition or canonical calls",async()=>{
  const result=await prepareNativeConfirmation(personal,draft(),now);expect(result.receipt.kind).toBe("unassessed");expect(result.entries).toHaveLength(2);expect(rpc).not.toHaveBeenCalled();expect(timeline).not.toHaveBeenCalled();
  const content=result.entries[0].content as {ciphertext:string;iv:string;authTag:string};const entry=JSON.parse(decryptNarrative(content));expect(entry.date).toBe("2026-10-23");expect(entry.minutes).toBe(60);expect(entry.text).toContain("Segment 1 of 2");expect(result.entries[0]).not.toHaveProperty("native_skill_level");
 });
 it("keeps a non-sleep overnight activity continuous",async()=>{const d=draft();d.activities[0].sleepRest=false;const result=await prepareNativeConfirmation(personal,d,now);expect(result.entries).toHaveLength(1);});
 it("cannot turn a personal draft into the pilot path",async()=>{const d=draft();d.mode="pilot";await expect(prepareNativeConfirmation(personal,d,now)).rejects.toThrow("REVIEW_REQUIRED");});
 it("uses existing verified recognition and pending review for pilot Performance",async()=>{
  const d=draft();d.mode="pilot";Object.assign(d.activities[0],{sleepRest:false,node:"Performance",context:"IoV website",community:"iov",lane:"OrgBuilding"});
  rpc.mockResolvedValue({data:[{native_level:"Expert",protocol_finality_status:"final"}],error:null});
  const result=await prepareNativeConfirmation({kind:"pilot",user:{id:"11111111-1111-4111-8111-111111111111"}} as never,d,now);
  expect(result.receipt.kind).toBe("validation_pending");expect(rpc).toHaveBeenCalledWith("resolve_founder_flat_community_rate",expect.objectContaining({p_community:"iov",p_route:"OrgBuilding"}));expect(result.entries[0].native_skill_level).toBe("Expert");expect(result.entries[0]).not.toHaveProperty("impact_direction");expect(timeline).toHaveBeenCalledTimes(1);
 });
 it("blocks missing or provisional recognition without inventing a level",async()=>{
  const d=draft();d.mode="pilot";Object.assign(d.activities[0],{node:"Performance",context:"IoV",community:"iov",lane:"Learning"});rpc.mockResolvedValue({data:[{native_level:"Expert",protocol_finality_status:"provisional"}],error:null});
  await expect(prepareNativeConfirmation({kind:"pilot",user:{id:"pilot"}} as never,d,now)).rejects.toThrow("RECOGNITION_REQUIRED");expect(timeline).not.toHaveBeenCalled();
 });
});
