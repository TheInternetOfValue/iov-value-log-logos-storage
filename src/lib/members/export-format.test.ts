import { describe, expect, it } from "vitest";
import { memberExportWriter } from "./export-format";
describe("paged private export file", () => {
  it("keeps all pages, Unicode writing and removal records in valid downloadable JSON", () => {
    const file = memberExportWriter({ schema: "value-log-private-activities-v1", member: { name: "Synthetic member" } });
    const records = Array.from({length:1001},(_,id)=>({id,text:"A private reflection · நினைவு · 界"}));
    file.append("activities",records.slice(0,100));file.append("activities",records.slice(100));file.append("activities",[]);
    file.append("audit",[{event_type:"private_activity_removed"}]);file.append("audit",[]);
    const data = JSON.parse(file.finish().join(""));
    expect(data.activities).toEqual(records);expect(data.audit).toEqual([{event_type:"private_activity_removed"}]);expect(data.member.name).toBe("Synthetic member");
  });
  it("empty histories remain valid, and an unfinished or out-of-order export cannot finish", () => {
    const file=memberExportWriter({assessment:"unassessed"});file.append("activities",[]);file.append("audit",[]);
    expect(JSON.parse(file.finish().join(""))).toEqual({assessment:"unassessed",activities:[],audit:[]});
    const unfinished=memberExportWriter({});unfinished.append("activities",[]);expect(()=>unfinished.finish()).toThrow("Incomplete export");
    expect(()=>memberExportWriter({}).append("audit",[])).toThrow("Invalid export order");
  });
});
