import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const { session, adminRpc }=vi.hoisted(()=>({session:vi.fn(),adminRpc:vi.fn()}));
vi.mock("@/lib/members/session",()=>({memberSession:session}));
vi.mock("@/lib/supabase/admin",()=>({adminClient:()=>({rpc:adminRpc})}));
vi.mock("@/lib/supabase/admin-core",()=>({adminClient:()=>({rpc:adminRpc})}));
import { NextRequest } from "next/server";
import { memberWriteBinding } from "@/lib/members/http";
import { encryptNarrative } from "@/lib/crypto";
import { nativeBytes, nativeFailure, nativeOwnerScope, nativeSession, nativeView, providerAllowance, withNativeProcessing, writeNative } from "./server";
import { newNativeDraft } from "./draft";
const owner="22222222-2222-4222-8222-222222222222";
beforeEach(()=>{vi.stubEnv("NEXT_PUBLIC_APP_URL","https://valuelog.theinternetofvalue.org");vi.stubEnv("VALUE_LOG_NATIVE_LOGGING","open");vi.stubEnv("VALUE_LOG_MEMBER_WRITING","open");vi.stubEnv("NARRATIVE_ENCRYPTION_KEY_BASE64",Buffer.alloc(32,4).toString("base64"));vi.stubEnv("AUDIT_DIGEST_KEY","synthetic-owner-binding-longer-than-thirty-two");session.mockReset();session.mockResolvedValue({kind:"personal",user:{id:owner},onboarded:true});adminRpc.mockReset();});
afterEach(()=>vi.unstubAllEnvs());
function request(headers:Record<string,string>={}){return new NextRequest("https://valuelog.theinternetofvalue.org/api/native-log/drafts",{method:"PUT",headers:{origin:"https://valuelog.theinternetofvalue.org","content-type":"application/json","sec-fetch-site":"same-origin","x-value-log-session":memberWriteBinding(owner),...headers},body:"{}"});}
describe("native request isolation",()=>{
 it("verifies session, write binding and origin before processing",async()=>{await expect(nativeSession(request(),true)).resolves.toMatchObject({kind:"personal"});await expect(nativeSession(request({origin:"https://untrusted.example"}),true)).rejects.toThrow("ORIGIN_REQUIRED");await expect(nativeSession(request({"x-value-log-session":"another-account"}),true)).rejects.toThrow();session.mockRejectedValue(new Error("UNAUTHORIZED"));await expect(nativeSession(request(),true)).rejects.toThrow("UNAUTHORIZED");});
 it("keeps reads available while writing is paused",async()=>{vi.stubEnv("VALUE_LOG_NATIVE_LOGGING","closed");await expect(nativeSession(request(),false)).resolves.toBeTruthy();await expect(nativeSession(request(),true)).rejects.toThrow("WRITING_PAUSED");});
 it("rejects a changed account before the service writer",async()=>{const d=newNativeDraft(nativeOwnerScope(owner),"2026-10-24","Asia/Kolkata","personal");await expect(writeNative({kind:"personal",user:{id:"different"}} as never,"draft",0,{document:d,parts:{},totalParts:null})).rejects.toThrow("ACCOUNT_CHANGED");expect(adminRpc).not.toHaveBeenCalled();});
 it("releases provider leases on errors and enforces per-person and global quotas",async()=>{adminRpc.mockResolvedValueOnce({data:"lease",error:null}).mockResolvedValueOnce({data:null,error:null});await expect(withNativeProcessing({user:{id:owner}} as never,{id:"draft",revision:1} as never,async()=>{throw new Error("PROVIDER_RESPONSE");})).rejects.toThrow("PROVIDER_RESPONSE");expect(adminRpc.mock.calls[1][0]).toBe("release_native_log_processing");adminRpc.mockReset();adminRpc.mockResolvedValueOnce({data:true,error:null}).mockResolvedValueOnce({data:false,error:null});await expect(providerAllowance({user:{id:owner}} as never,"stt")).rejects.toThrow("PROVIDER_ALLOWANCE");expect(adminRpc.mock.calls[0][1].p_limit).toBe(48);expect(adminRpc.mock.calls[1][1].p_limit).toBe(240);});
 it("bounds chunked request bodies even without Content-Length",async()=>{const input=new NextRequest("https://valuelog.theinternetofvalue.org/api/native-log/drafts",{method:"POST",body:"x".repeat(51)});await expect(nativeBytes(input,50)).rejects.toThrow("PAYLOAD_TOO_LARGE");});
 it("returns no ciphertext, leases or private exception text",async()=>{
  const document=newNativeDraft(nativeOwnerScope(owner),"2026-10-24","Asia/Kolkata","personal"), encrypted=encryptNarrative(JSON.stringify({document,parts:{},totalParts:null}));
  const view=nativeView({id:"draft",revision:1,status:"draft",content_ciphertext:encrypted.ciphertext,content_iv:encrypted.iv,content_auth_tag:encrypted.authTag,receipt:null,updated_at:"now"} as never);
  expect(view.document?.date).toBe("2026-10-24");expect(JSON.stringify(view)).not.toContain(encrypted.ciphertext);const failure=nativeFailure(new Error("PRIVATE_SECRET_OR_TRANSCRIPT"));expect(failure.headers.get("cache-control")).toContain("no-store");expect(await failure.text()).not.toContain("PRIVATE_SECRET");
 });
});
