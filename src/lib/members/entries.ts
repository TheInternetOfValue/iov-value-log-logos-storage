import { z } from "zod";
import { wellbeingNodes } from "./nodes";
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value && value >= "1900-01-01";
});
export const entrySchema = z.object({
  id: z.uuid(), revision: z.number().int().min(0).max(2147483645),
  date: dateSchema, node: z.enum(wellbeingNodes),
  text: z.string().trim().min(1).max(6000), minutes: z.number().int().min(1).max(1440).nullable(),
}).strict();
export type MemberEntry = z.infer<typeof entrySchema>;
export type SavedMemberEntry = MemberEntry & { createdAt: string; updatedAt: string };
export const profileSchema = z.object({ name: z.string().trim().min(1).max(80),
  timezone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }),
  accepted: z.literal(true),
}).strict();
