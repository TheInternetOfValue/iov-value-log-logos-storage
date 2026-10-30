import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { memberExportPage } from "./export-pages";
import { encryptNarrative } from "@/lib/crypto";
beforeEach(()=>{vi.stubEnv("NARRATIVE_ENCRYPTION_KEY_BASE64",Buffer.alloc(32,9).toString("base64"));vi.stubEnv("AUDIT_DIGEST_KEY","synthetic-page-test-key-over-thirty-two-characters");});
afterEach(()=>vi.unstubAllEnvs());
describe("bounded owner export pages",()=>{
  it("returns a stable cursor after 100 records and keeps ownership in the query",async()=>{
    const content=encryptNarrative(JSON.stringify({date:"2026-10-25",node:"Thought",text:"Synthetic writing",minutes:null}));
    const rows=Array.from({length:100},(_,id)=>({id:`00000000-0000-4000-8000-${String(id).padStart(12,"0")}`,revision:1,activity_date:"2026-10-25",wellbeing_node:"Thought",created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z",content_ciphertext:content.ciphertext,content_iv:content.iv,content_auth_tag:content.authTag,removed_at:null}));
    const eq=vi.fn(),limit=vi.fn(),gt=vi.fn();
    const q={select:()=>q,eq:(...v:unknown[])=>{eq(...v);return q;},lte:()=>q,order:()=>q,limit:(n:number)=>{limit(n);return q;},gt:(...v:unknown[])=>{gt(...v);return q;},then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:rows,error:null}).then(resolve)};
    const session={user:{id:"owner-A"},client:{from:()=>q}} as never;
    const page=await memberExportPage(session,"activities","2026-10-25T00:00:00Z","00000000-0000-4000-8000-000000000000");
    expect(page.records).toHaveLength(100);expect(page.next).toBe(rows.at(-1)!.id);expect(eq).toHaveBeenCalledWith("owner_id","owner-A");expect(limit).toHaveBeenCalledWith(100);expect(gt).toHaveBeenCalledWith("id","00000000-0000-4000-8000-000000000000");
    expect(JSON.stringify(page)).not.toContain("content_ciphertext");
  });
});
