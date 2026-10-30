import { expect, it } from "vitest";
import { z } from "zod";
import {
  decodedProviderResponse,
  ProviderContractError,
  safeProviderFailure,
} from "./provider-contract";
const schema = z.object({ value: z.string() }).strict();
it("distinguishes exhausted answer budget without retaining model or reasoning text", () => {
  try {
    decodedProviderResponse(
      {
        choices: [
          {
            finish_reason: "length",
            message: { content: null, reasoning_content: "private reasoning" },
          },
        ],
        usage: {
          completion_tokens: 6000,
          completion_tokens_details: { reasoning_tokens: 6000 },
        },
      },
      schema,
    );
    throw new Error("accepted truncated response");
  } catch (e) {
    expect(e).toBeInstanceOf(ProviderContractError);
    expect(safeProviderFailure(e)).toEqual({
      code: "PROVIDER_RESPONSE",
      diagnostic: {
        stage: "finish",
        finishReason: "length",
        contentType: "null",
        completionTokens: 6000,
        reasoningTokens: 6000,
      },
    });
    expect(JSON.stringify(safeProviderFailure(e))).not.toContain(
      "private reasoning",
    );
  }
});
it("keeps schema and JSON failures separate, with no response text or arbitrary error values", () => {
  for (const [content, stage] of [
    ["private invalid JSON", "json"],
    [JSON.stringify({ value: 42, secret: "private" }), "schema"],
  ]) {
    try {
      decodedProviderResponse(
        { choices: [{ finish_reason: "stop", message: { content } }] },
        schema,
      );
    } catch (e) {
      const result = safeProviderFailure(e);
      expect(result.diagnostic?.stage).toBe(stage);
      expect(JSON.stringify(result)).not.toContain("private");
    }
  }
  expect(safeProviderFailure(new Error("Bearer private credential"))).toEqual({
    code: "CONTRACT_CHECK_FAILED",
  });
});
it("accepts only completed strict output and reports safe response metadata", () => {
  expect(
    decodedProviderResponse(
      {
        choices: [
          { finish_reason: "stop", message: { content: '{"value":"ok"}' } },
        ],
      },
      schema,
    ),
  ).toMatchObject({
    data: { value: "ok" },
    facts: {
      finishReason: "stop",
      contentType: "string",
      contentCharacters: 14,
    },
  });
  expect(() =>
    decodedProviderResponse(
      {
        choices: [
          {
            finish_reason: "tool_calls",
            message: { content: '{"value":"ok"}' },
          },
        ],
      },
      schema,
    ),
  ).toThrow("PROVIDER_RESPONSE");
});

it("does not let null or unfamiliar optional usage telemetry reject a complete valid answer", () => {
  for (const usage of [
    null,
    { completion_tokens: null, completion_tokens_details: null },
    { completion_tokens: -1, completion_tokens_details: "unknown" },
  ]) {
    expect(
      decodedProviderResponse(
        {
          choices: [
            { finish_reason: "stop", message: { content: '{"value":"ok"}' } },
          ],
          usage,
        },
        schema,
      ).data,
    ).toEqual({ value: "ok" });
  }
});
it("reports only allowlisted schema paths and never private field names or values",()=>{
 const nested=z.object({changes:z.object({endLocal:z.string()}).strict()}).strict();
 try{decodedProviderResponse({choices:[{finish_reason:"stop",message:{content:JSON.stringify({changes:{endLocal:"ok",privateSensitiveName:"privateSensitiveValue"}})}}]},nested);throw Error("accepted extra field");}
 catch(error){const diagnostic=safeProviderFailure(error);expect(diagnostic).toMatchObject({code:"PROVIDER_RESPONSE",diagnostic:{stage:"schema",issues:[{code:"unrecognized_keys",path:"changes",keys:["other"]}]}});expect(JSON.stringify(diagnostic)).not.toContain("privateSensitive");}
});
