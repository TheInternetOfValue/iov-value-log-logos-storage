import { afterEach, expect, it, vi } from "vitest";
import { pollNativeProposal } from "./poll";
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it("waits for a later saved revision, retaining the account binding and avoiding duplicate model requests",async()=>{
 vi.useFakeTimers();const fetch=vi.fn().mockResolvedValueOnce(Response.json({revision:2,status:"draft",document:{},processingUntil:new Date(Date.now()+75000).toISOString()})).mockResolvedValueOnce(Response.json({revision:3,status:"draft",document:{activities:[{activity:"Synthetic"}]},processingUntil:null}));vi.stubGlobal("fetch",fetch);
 const pending=pollNativeProposal({id:"draft",revision:2,binding:"owner-binding",signal:new AbortController().signal});await vi.advanceTimersByTimeAsync(2000);expect((await pending).revision).toBe(3);expect(fetch.mock.calls[0][1].headers).toEqual({"x-value-log-session":"owner-binding"});expect(fetch.mock.calls.every(c=>c[0].startsWith('/api/native-log/drafts'))).toBe(true);
});
it("retains the draft when sign-in expires and does not replace it with an error body",async()=>{vi.stubGlobal("fetch",vi.fn(async()=>Response.json({error:"Sign in again"},{status:401})));await expect(pollNativeProposal({id:"draft",revision:1,binding:"old-account",signal:new AbortController().signal})).rejects.toMatchObject({status:401,message:"Sign in again"});});
it("checks again as soon as the tab is back in view",async()=>{
 vi.useFakeTimers();const page=Object.assign(new EventTarget(),{visibilityState:"hidden"});vi.stubGlobal("document",page);
 const fetch=vi.fn().mockResolvedValueOnce(Response.json({revision:2,status:"draft",document:{},processingUntil:new Date(Date.now()+75000).toISOString()})).mockResolvedValueOnce(Response.json({revision:3,status:"draft",document:{},processingUntil:null}));vi.stubGlobal("fetch",fetch);
 const pending=pollNativeProposal({id:"draft",revision:2,binding:"b",signal:new AbortController().signal});await vi.advanceTimersByTimeAsync(0);expect(fetch).toHaveBeenCalledTimes(1);
 page.visibilityState="visible";page.dispatchEvent(new Event("visibilitychange"));expect((await pending).revision).toBe(3);expect(fetch).toHaveBeenCalledTimes(2);
});
it("waits for a late job claim after an uncertain queue request, then still reports a job that never starts",async()=>{
 vi.useFakeTimers();
 const unclaimed=()=>Response.json({revision:2,status:"draft",document:{},processingUntil:null});
 const fetch=vi.fn().mockResolvedValueOnce(unclaimed()).mockResolvedValueOnce(Response.json({revision:2,status:"draft",document:{},processingUntil:new Date(Date.now()+75000).toISOString()})).mockResolvedValueOnce(Response.json({revision:3,status:"draft",document:{},processingUntil:null}));vi.stubGlobal("fetch",fetch);
 const late=pollNativeProposal({id:"draft",revision:2,binding:"b",signal:new AbortController().signal,claimGraceMs:15000});await vi.advanceTimersByTimeAsync(5000);expect((await late).revision).toBe(3);
 vi.stubGlobal("fetch",vi.fn(async()=>unclaimed()));
 const never=pollNativeProposal({id:"draft",revision:2,binding:"b",signal:new AbortController().signal,claimGraceMs:15000});const failed=expect(never).rejects.toThrow("Processing stopped");await vi.advanceTimersByTimeAsync(20000);await failed;
 // Without a grace period (a confirmed queue), an unclaimed draft is still reported at once.
 await expect(pollNativeProposal({id:"draft",revision:2,binding:"b",signal:new AbortController().signal})).rejects.toThrow("Processing stopped");
});
