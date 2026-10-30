import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { readFileSync } from "node:fs";
describe("recording page permissions",()=>{
 it("permits only same-origin microphone use on Log and Today and keeps it blocked elsewhere",async()=>{
  const rules=await nextConfig.headers!();
  expect(rules.find(rule=>rule.source==="/(.*)")!.headers).toContainEqual({key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=()"});
  expect(rules.find(rule=>rule.source==="/log")!.headers).toContainEqual({key:"Permissions-Policy",value:"camera=(), microphone=(self), geolocation=()"});
  expect(rules.find(rule=>rule.source==="/day")!.headers).toContainEqual({key:"Permissions-Policy",value:"camera=(), microphone=(self), geolocation=()"});
  expect(rules.find(rule=>rule.source.includes("private("))!.source).toContain("log");
  const deployment=readFileSync("netlify.toml","utf8");expect(deployment).toContain('for = "/log"\n  [headers.values]\n    Permissions-Policy = "camera=(), microphone=(self), geolocation=()"');
 });
});
