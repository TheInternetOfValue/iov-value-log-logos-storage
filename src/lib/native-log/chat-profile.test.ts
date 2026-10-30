import { expect, it } from "vitest";
import { sarvamChatProfile } from "./chat-profile";
it("pins each allowed chat model to its documented endpoint and bounded token budget", () => {
  expect(sarvamChatProfile("sarvam-105b-conversations")).toMatchObject({
    path: "/v1/chat/completions",
    reasoning: null,
    maxTokens: 6000,
  });
  expect(sarvamChatProfile("glm5.3")).toMatchObject({
    path: "/v2/chat/completions",
    reasoning: "low",
    maxTokens: 8000,
  });
  expect(sarvamChatProfile("https://untrusted.invalid")).toBeNull();
  expect(sarvamChatProfile("toString")).toBeNull();
});
it("uses the V2 schema contract for GLM while retaining the legacy JSON mode",async()=>{
 const {sarvamResponseFormat}=await import("./chat-profile");
 const schema={type:"object",properties:{activities:{type:"array"}},required:["activities"],additionalProperties:false};
 expect(sarvamResponseFormat("glm5.3","value_log_proposal",schema)).toEqual({type:"json_schema",json_schema:{name:"value_log_proposal",strict:true,schema}});
 expect(sarvamResponseFormat("sarvam-105b-conversations","value_log_proposal",schema)).toEqual({type:"json_object"});
});
