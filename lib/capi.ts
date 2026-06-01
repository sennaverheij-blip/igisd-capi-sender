import crypto from "node:crypto";
import Papa from "papaparse";

export type Row = Record<string, string>;

export interface BuiltEvent {
  event_name: string;
  event_time: number;
  action_source: string;
  messaging_channel: string;
  event_id: string;
  user_data: Record<string, string>;
  custom_data?: Record<string, any>;
}

// Funnel stage → Meta standard event name.
// Lead = qualified prospect, Schedule = appointment booked, Purchase = closed deal.
const STAGE_TO_EVENT: Record<string, string> = {
  QUALIFIED: "Lead",
  BOOKED_CALL: "Schedule",
  WON: "Purchase",
};

function mapStage(stage: string): string | null {
  const k = stage.trim().toUpperCase().replace(/[\s-]/g, "_");
  return STAGE_TO_EVENT[k] || null;
}

// ---------------------------------------------------------------------------
// Messaging-specific fields. Verify these against the CURRENT Graph API
// messaging-CAPI docs for your API version before a large run — Meta has
// changed messaging parameters across versions before.
// ---------------------------------------------------------------------------
const ACTION_SOURCE = "business_messaging";
const MESSAGING_CHANNEL = "instagram"; // "instagram" | "messenger" | "whatsapp"

function sha256(v: string): string {
  return crypto.createHash("sha256").update(v.trim().toLowerCase()).digest("hex");
}

function normPhone(p: string): string {
  return p.trim().replace(/[\s-]/g, "");
}

function toUnix(ts?: string): number {
  if (!ts || !ts.trim()) return Math.floor(Date.now() / 1000);
  const s = ts.trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) {
    throw new Error(`Bad event_time: "${s}" (use unix seconds or ISO-8601)`);
  }
  return Math.floor(ms / 1000);
}

export function parseCsv(text: string): Row[] {
  const res = Papa.parse<Row>(text.trim(), { header: true, skipEmptyLines: true });
  return res.data;
}

export function buildEvent(row: Row, pageId: string): BuiltEvent | null {
  // Accept either `igsid` or `instagram_id` as the IGSID column.
  const igsid = (row.igsid || row.instagram_id || "").trim();
  if (!igsid) return null; // no IGSID -> can't be matched, skip

  // Event name: explicit > stage-mapped > fallback.
  const stage = (row.current_funnel_stage || row.stage || "").trim();
  const mappedStage = stage ? mapStage(stage) : null;
  if (stage && !mappedStage) return null; // unknown stage -> skip rather than send garbage
  const event_name =
    (row.event_name && row.event_name.trim()) || mappedStage || "Lead";

  const user_data: Record<string, string> = {
    page_id: String(pageId),
    page_scoped_user_id: igsid,
  };
  if (row.email && row.email.trim()) user_data.em = sha256(row.email);
  if (row.phone && row.phone.trim()) user_data.ph = sha256(normPhone(row.phone));

  // Stable event_id so re-uploading the same CSV dedupes inside Meta's window.
  const stageTag = (mappedStage || event_name).toLowerCase();
  const event_id =
    (row.event_id && row.event_id.trim()) || `${igsid}-${stageTag}`;

  const event: BuiltEvent = {
    event_name,
    event_time: toUnix(row.event_time),
    action_source: ACTION_SOURCE,
    messaging_channel: MESSAGING_CHANNEL,
    event_id,
    user_data,
  };

  const custom_data: Record<string, any> = {};
  if (row.value && row.value.trim()) {
    custom_data.value = parseFloat(row.value);
    custom_data.currency = (row.currency || "EUR").trim().toUpperCase();
  }
  if (row.instagram_username && row.instagram_username.trim()) {
    custom_data.instagram_username = row.instagram_username.trim();
  }
  if (stage) custom_data.funnel_stage = stage;
  if (Object.keys(custom_data).length > 0) event.custom_data = custom_data;

  return event;
}

export function buildEvents(
  rows: Row[],
  pageId: string
): { events: BuiltEvent[]; skipped: number } {
  const events: BuiltEvent[] = [];
  let skipped = 0;
  for (const r of rows) {
    const e = buildEvent(r, pageId);
    if (e) events.push(e);
    else skipped++;
  }
  return { events, skipped };
}

export function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
