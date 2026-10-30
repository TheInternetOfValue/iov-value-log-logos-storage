import {afterEach,beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const {session,admin}=vi.hoisted(()=>({session:vi.fn(),admin:vi.fn()}));
vi.mock("@/lib/members/session",()=>({memberSession:session}));
vi.mock("@/lib/supabase/admin",()=>({adminClient:admin}));
import {NextRequest} from "next/server";
import {memberWriteBinding} from "@/lib/members/http";
import {encryptNarrative} from "@/lib/crypto";
import {GET} from "./route";
const owner="22222222-2222-4222-8222-222222222222",other="33333333-3333-4333-8333-333333333333";
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("AUDIT_DIGEST_KEY","synthetic-cohort-export-key-more-than-thirty-two");vi.stubEnv("NARRATIVE_ENCRYPTION_KEY_BASE64",Buffer.alloc(32,6).toString("base64"));session.mockResolvedValue({kind:"personal",user:{id:owner}});});afterEach(()=>vi.unstubAllEnvs());
it("exports beyond a page with owner and cutoff filters and decrypts only that owner's rows",async()=>{
 const content=encryptNarrative(JSON.stringify({activity:"Synthetic தமிழ் walk"}));const all=Array.from({length:102},(_,i)=>({id:String(i).padStart(4,"0"),owner_id:i===101?other:owner,content,created_at:"2026-10-25T00:00:00Z"}));const filters=vi.fn();admin.mockImplementation(()=>({from:()=>{let rows=all;const q={select:()=>q,eq:(key:string,value:string)=>{filters(key,value);rows=rows.filter(r=>r[key as keyof typeof r]===value);return q;},lte:(key:string,value:string)=>{filters(key,value);return q;},order:()=>q,range:async(start:number,end:number)=>({data:rows.slice(start,end+1),error:null})};return q;}}));
 const request=(offset:number,binding=memberWriteBinding(owner))=>new NextRequest(`https://valuelog.theinternetofvalue.org/api/cohort/export?table=cohort_records&offset=${offset}&cutoff=2026-10-26T00:00:00Z`,{headers:{"x-value-log-session":binding}});
 const first=await GET(request(0)),a=await first.json(),b=await(await GET(request(a.next))).json();expect(a.rows.length+b.rows.length).toBe(101);expect(b.next).toBeNull();expect(a.rows[0].content.activity).toBe("Synthetic தமிழ் walk");expect(JSON.stringify(a)).not.toContain(content.ciphertext);expect(filters).toHaveBeenCalledWith("owner_id",owner);expect(filters).toHaveBeenCalledWith("created_at","2026-10-26T00:00:00Z");expect(first.headers.get("cache-control")).toContain("no-store");
 admin.mockClear();expect((await GET(request(0,memberWriteBinding(other)))).status).toBe(403);expect(admin).not.toHaveBeenCalled();
});
