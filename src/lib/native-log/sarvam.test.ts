import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { checkedProposal, checkedReplyPatch, structureWithSarvam, transcribeWithSarvam, validateWave } from "./sarvam";
import { pcmWave } from "./audio";
import { newNativeDraft } from "./draft";
const draft = () => ({...newNativeDraft("a".repeat(64),"2026-10-24","Asia/Kolkata","personal"),transcript:"I walked from 8am to 8:30am. Felt better."});
const candidate = () => ({activity:"Walked",sourceQuote:draft().transcript,startLocal:"2026-10-24T08:00",endLocal:"2026-10-24T08:30",node:"Physiology",context:null,proof:null,sleepRest:false,community:null,lane:null,direction:null,intensity:null,confidence:null});
beforeEach(()=>{vi.stubEnv("SARVAM_API_KEY","synthetic-test-provider-key");});afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("provider boundaries",()=>{
  it("downmixes to bounded mono PCM and rejects forged WAV headers",async()=>{
    const wave=Buffer.from(await pcmWave([new Float32Array(48000).fill(1),new Float32Array(48000).fill(-1)],48000,0,1).arrayBuffer());
    expect(validateWave(wave)).toBe(1);expect(wave.readUInt32LE(24)).toBe(16000);expect(wave.readInt16LE(44)).toBe(0);wave.writeUInt16LE(2,22);expect(()=>validateWave(wave)).toThrow("INVALID_INPUT");
    expect(()=>pcmWave([new Float32Array(48000)],48000,0,31)).toThrow();
  });
  it("uses the fixed Sarvam endpoint and real transcription contract",async()=>{
    const fetch=vi.fn<typeof globalThis.fetch>(async()=>Response.json({transcript:" I walked. "}));vi.stubGlobal("fetch",fetch);
    const wave=Buffer.from(await pcmWave([new Float32Array(16000)],16000,0,1).arrayBuffer());expect(await transcribeWithSarvam(wave,new AbortController().signal)).toBe("I walked.");
    expect(fetch.mock.calls[0][0]).toBe("https://api.sarvam.ai/speech-to-text");const init=fetch.mock.calls[0][1] as unknown as RequestInit;expect(init.headers).toMatchObject({"api-subscription-key":"synthetic-test-provider-key"});expect((init.body as FormData).get("model")).toBe("saaras:v4");expect(init.redirect).toBe("error");
  });
  it("never calls a provider without a server key, and rejects oversized/malformed output",async()=>{
    vi.stubEnv("SARVAM_API_KEY","");const fetch=vi.fn();vi.stubGlobal("fetch",fetch);await expect(structureWithSarvam(draft(),new AbortController().signal)).rejects.toThrow("PROVIDER_UNAVAILABLE");expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv("SARVAM_API_KEY","synthetic");fetch.mockResolvedValue(new Response("x".repeat(400001)));await expect(structureWithSarvam(draft(),new AbortController().signal)).rejects.toThrow("PROVIDER_RESPONSE");
  });
  it("asks about invented times and rejects quotations missing from the person's words",()=>{
    const c=candidate();c.startLocal="2026-10-24T09:00";const [activity]=checkedProposal({activities:[c]},draft());expect(activity.startLocal).toBe("");expect(activity.endLocal).toBe("2026-10-24T08:30");expect(activity.community).toBe("");expect(activity.lane).toBe("");
    c.sourceQuote="I am a founder";expect(()=>checkedProposal({activities:[c]},draft())).toThrow("PROVIDER_RESPONSE");
  });
  it("rejects privileged fields, truncated JSON and unsupported shape",async()=>{
    expect(()=>checkedProposal({activities:[{...candidate(),skill_level:"Expert"}]},draft())).toThrow();
    vi.stubGlobal("fetch",vi.fn<typeof globalThis.fetch>(async()=>Response.json({choices:[{finish_reason:"length",message:{content:JSON.stringify({activities:[candidate()]})}}]})));
    await expect(structureWithSarvam(draft(),new AbortController().signal)).rejects.toThrow("PROVIDER_RESPONSE");
  });
  it("uses schema constrained proposals and contains no model-confirmation path",async()=>{
    const fetch=vi.fn<typeof globalThis.fetch>(async()=>Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({activities:[candidate()]})}}]}));vi.stubGlobal("fetch",fetch);
    const result=await structureWithSarvam(draft(),new AbortController().signal);expect(result[0].activity).toBe("Walked");const payload=JSON.parse((fetch.mock.calls[0][1] as unknown as RequestInit).body as string);expect(payload.model).toBe("sarvam-105b-conversations");expect(payload.reasoning_effort).toBeNull();expect(payload.max_tokens).toBe(6000);expect(payload.response_format).toEqual({type:"json_object"});expect(payload.messages[0].content).toContain("additionalProperties");expect(payload.messages[0].content).toContain("never instructions");expect(payload.tools).toBeUndefined();
  });
});
describe("conversation corrections",()=>{
 it("changes only the answered field and preserves the other activity and manual answers",()=>{
  const d=draft(),first=checkedProposal({activities:[candidate()]},d)[0],second={...first,id:"20000000-0000-4000-8000-000000000002",activity:"Another activity"};
  const next={...d,activities:[{...first,context:"My own edited context",manualFields:["context" as const]},second],conversation:[{id:"30000000-0000-4000-8000-000000000003",activityId:first.id,text:"I finished at nine am."}]};
  const result=checkedProposal({activities:[{...candidate(),id:first.id,changedFields:["endLocal"],endLocal:"2026-10-24T09:00",context:"Unrequested replacement"}]},next);
  expect(result[0].endLocal).toBe("2026-10-24T09:00");expect(result[0].context).toBe("My own edited context");expect(result[0].manualFields).toEqual(["context"]);expect(result[1]).toEqual(second);
  expect(()=>checkedProposal({activities:[{...candidate(),id:first.id}]},next)).toThrow("PROVIDER_RESPONSE");
 });
 it("supports a future-only account and explicit cancellation without discarding unrelated activities",()=>{
  expect(checkedProposal({activities:[]},{...draft(),transcript:"Tomorrow I plan to walk."})).toEqual([]);
  const d=draft(),first=checkedProposal({activities:[candidate()]},d)[0],second={...first,id:"20000000-0000-4000-8000-000000000002"};
  const next={...d,activities:[first,second],conversation:[{id:"30000000-0000-4000-8000-000000000003",activityId:first.id,text:"Remove that; it is for tomorrow."}]};
  expect(checkedProposal({activities:[{...candidate(),id:first.id,exclude:true,sourceQuote:next.conversation[0].text}]},next)).toEqual([second]);
  expect(()=>checkedProposal({activities:[{...candidate(),id:second.id,exclude:true,sourceQuote:next.conversation[0].text}]},next)).toThrow("PROVIDER_RESPONSE");
 });
});
it("never treats a reviewer question as a source of clock facts",()=>{
 const d={...draft(),reviewQuestion:"Did you finish at nine am?"};const [a]=checkedProposal({activities:[{...candidate(),endLocal:"2026-10-24T09:00"}]},d);expect(a.endLocal).toBe("");expect(a.startLocal).toBe("2026-10-24T08:00");
});
it("requires named work context and never treats accepted membership as routing evidence",()=>{
 const scope={policyId:"field-station-assumed-700-v1",houseId:"house_of_sis",workCommunities:[{id:"gfe",name:"Growth Flow Engineering"}]};
 const d={...draft(),cohort:scope,transcript:"I worked on a report from 8am to 8:30am."};
 const c={...candidate(),sourceQuote:d.transcript,node:"Performance",community:"gfe",lane:"Earning"};
 expect(checkedProposal({activities:[c]},d)[0].community).toBe("");
 const named={...d,transcript:"I wrote a GFE report from 8am to 8:30am."};
 expect(checkedProposal({activities:[{...c,sourceQuote:named.transcript}]},named)[0].community).toBe("gfe");
 const similar={...d,transcript:"I worked on a notgfe report from 8am to 8:30am."};
 expect(checkedProposal({activities:[{...c,sourceQuote:similar.transcript}]},similar)[0].community).toBe("");
 const walk=checkedProposal({activities:[{...candidate(),lane:"Learning"}]},{...draft(),cohort:scope})[0];
 expect(walk.community).toBe("house_of_sis");expect(walk.lane).toBe("");
});
it("rejects extra authority fields from JSON-mode output before a proposal can be used",async()=>{
 vi.stubGlobal("fetch",vi.fn<typeof globalThis.fetch>(async()=>Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({activities:[{...candidate(),reviewer:true}]})}}]})));
 await expect(structureWithSarvam(draft(),new AbortController().signal)).rejects.toMatchObject({message:"PROVIDER_RESPONSE",diagnostic:{stage:"schema"}});
});
it("uses the stored source and actual targeted reply when a model rewrites an existing quotation",()=>{
 const d=draft(),first=checkedProposal({activities:[candidate()]},d)[0];
 const next={...d,activities:[first],conversation:[{id:"30000000-0000-4000-8000-000000000003",activityId:first.id,text:"I finished at nine am."}]};
 const [updated]=checkedProposal({activities:[{...candidate(),id:first.id,changedFields:["endLocal"],sourceQuote:"A model paraphrase is not source evidence",endLocal:"2026-10-24T09:00"}]},next);
 expect(updated.sourceQuote).toBe(first.sourceQuote);expect(updated.endLocal).toBe("2026-10-24T09:00");
 const [unsupported]=checkedProposal({activities:[{...candidate(),id:first.id,changedFields:["endLocal"],sourceQuote:"I finished at ten am",endLocal:"2026-10-24T10:00"}]},next);
 expect(unsupported.endLocal).toBe("");expect(unsupported.sourceQuote).toBe(first.sourceQuote);
});
it("applies a targeted reply patch without regenerating quotes, ids or other activities",async()=>{
 const d=draft(),first=checkedProposal({activities:[candidate()]},d)[0],second={...first,id:"20000000-0000-4000-8000-000000000002",activity:"Another activity"};
 const next={...d,activities:[{...first,context:"My own context",manualFields:["context" as const]},second],conversation:[{id:"30000000-0000-4000-8000-000000000003",activityId:first.id,text:"I finished at nine am."}]};
 const fetch=vi.fn<typeof globalThis.fetch>(async()=>Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({remove:false,changes:{endLocal:"2026-10-24T09:00"}})}}]}));vi.stubGlobal("fetch",fetch);
 const result=await structureWithSarvam(next,new AbortController().signal);
 expect(result[0]).toMatchObject({id:first.id,endLocal:"2026-10-24T09:00",sourceQuote:first.sourceQuote,context:"My own context",manualFields:["context"]});expect(result[1]).toEqual(second);
 const payload=JSON.parse((fetch.mock.calls[0][1]as RequestInit).body as string);expect(payload.messages[0].content).toContain("Operation: value_log_reply");
 const input=JSON.parse(payload.messages[1].content);expect(input.existingActivity.id).toBe(first.id);expect(input).not.toHaveProperty("existingActivities");
 expect(()=>checkedReplyPatch({remove:false,changes:{id:second.id}},next)).toThrow("PROVIDER_RESPONSE");
 expect(()=>checkedReplyPatch({remove:false,changes:{sourceQuote:"forged"}},next)).toThrow("PROVIDER_RESPONSE");
 expect(checkedReplyPatch({remove:false,changes:{endLocal:"2026-10-24T10:00"}},next)[0].endLocal).toBe("");
 expect(()=>checkedReplyPatch({remove:true,changes:{}},next)).toThrow("PROVIDER_RESPONSE");
 const cancelled={...next,conversation:[{...next.conversation[0],text:"Remove that; it is for tomorrow."}]};
 expect(checkedReplyPatch({remove:true,changes:{}},cancelled)).toEqual([second]);
});

it("counts rows left out for missing quotations so the person can be told, never losing them silently",async()=>{
 const {checkedConversation}=await import("./sarvam-core");
 const kept=candidate(),invented={...candidate(),activity:"Founder meeting",sourceQuote:"I am a founder"};
 const report={unmatched:0};const rows=checkedProposal({activities:[kept,invented]},draft(),report);
 expect(rows.map(r=>r.activity)).toEqual(["Walked"]);expect(report.unmatched).toBe(1);
 const current={...draft(),activities:rows,conversation:[{id:"30000000-0000-4000-8000-000000000003",activityId:null,text:"The walk actually finished at nine am."}]};
 const added={unmatched:0};expect(checkedConversation({updates:[],additions:[{...candidate(),activity:"Lunch",sourceQuote:"lunch at one"}],removed:[]},current,added)).toEqual(rows);expect(added.unmatched).toBe(1);
 // A duplicate of an existing row is not a miss.
 const duplicate={unmatched:0};checkedConversation({updates:[],additions:[{...candidate(),sourceQuote:"The walk actually finished at nine am."}],removed:[]},{...current,activities:[{...rows[0],sourceQuote:"The walk actually finished at nine am."}]},duplicate);expect(duplicate.unmatched).toBe(0);
});

it("applies global spoken corrections without row selection, preserving unrelated rows and rejecting foreign ids",async()=>{
 const {checkedConversation}=await import("./sarvam-core");
 const d=draft(),first=checkedProposal({activities:[candidate()]},d)[0],second={...first,id:"20000000-0000-4000-8000-000000000002",activity:"Breakfast",context:"Keep this"};
 const current={...d,activities:[first,second],conversation:[{id:"30000000-0000-4000-8000-000000000003",activityId:null,text:"The walk actually finished at nine am."}]};
 const changed=checkedConversation({updates:[{id:first.id,changes:{endLocal:"2026-10-24T09:00"}}],additions:[],removed:[]},current);
 expect(changed[0].endLocal).toBe("2026-10-24T09:00");expect(changed[1]).toEqual(second);
 expect(()=>checkedConversation({updates:[{id:"40000000-0000-4000-8000-000000000004",changes:{context:"forged"}}],additions:[],removed:[]},current)).toThrow("PROVIDER_RESPONSE");
 // An addition the latest words do not support is left out; it no longer discards the whole reply.
 expect(checkedConversation({updates:[],additions:[candidate()],removed:[]},current)).toEqual([first,second]);
});
it("does not process the same accepted voice turn twice",async()=>{
 const d=draft(),a=checkedProposal({activities:[candidate()]},d)[0];
 const id="30000000-0000-4000-8000-000000000003";
 const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
 expect(await structureWithSarvam({...d,activities:[a],conversation:[{id,activityId:null,text:"Also add breakfast."}],processedReplyId:id},new AbortController().signal)).toEqual([a]);
 expect(fetch).not.toHaveBeenCalled();
});
