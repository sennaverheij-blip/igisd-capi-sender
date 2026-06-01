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

// Some exports (e.g. Google Sheets "download as CSV") wrap every entire row
// in double quotes, turning the line into ONE quoted field. Detect and strip.
function unwrapDoubleQuotedRows(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let wrapped = 0;
  let nonEmpty = 0;
  for (const ln of lines) {
    if (!ln.trim()) continue;
    nonEmpty++;
    if (ln.length >= 2 && ln.startsWith('"') && ln.endsWith('"')) wrapped++;
  }
  if (nonEmpty === 0 || wrapped / nonEmpty < 0.8) return text;
  return lines
    .map((ln) =>
      ln.length >= 2 && ln.startsWith('"') && ln.endsWith('"')
        ? ln.slice(1, -1).replace(/""/g, '"')
        : ln
    )
    .join("\n");
}

// Look up a CSV field by header name, case-insensitively, with all whitespace
// collapsed. So "IGSID", "igsid", " Igsid " all match the same key.
function pick(row: Row, ...names: string[]): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const map: Record<string, string> = {};
  for (const k of Object.keys(row)) map[norm(k)] = row[k];
  for (const n of names) {
    const v = map[norm(n)];
    if (v != null && String(v).trim()) return String(v);
  }
  return "";
}

export function parseCsv(text: string): Row[] {
  const cleaned = unwrapDoubleQuotedRows(text.trim());
  const res = Papa.parse<Row>(cleaned, { header: true, skipEmptyLines: true });
  return res.data;
}

export function buildEvent(row: Row, pageId: string): BuiltEvent | null {
  const igsid = pick(row, "igsid", "instagram_id", "ig_id", "page_scoped_user_id").trim();
  if (!igsid) return null; // no IGSID -> can't be matched, skip

  // Event name: explicit > stage-mapped > fallback.
  const stage = pick(row, "current_funnel_stage", "stage", "funnel_stage").trim();
  const mappedStage = stage ? mapStage(stage) : null;
  if (stage && !mappedStage) return null; // unknown stage -> skip rather than send garbage
  const event_name = pick(row, "event_name").trim() || mappedStage || "Lead";

  const email = pick(row, "email", "em").trim();
  const phone = pick(row, "phone", "ph").trim();

  const user_data: Record<string, string> = {
    page_id: String(pageId),
    page_scoped_user_id: igsid,
  };
  if (email) user_data.em = sha256(email);
  if (phone) user_data.ph = sha256(normPhone(phone));

  // Stable event_id so re-uploading the same CSV dedupes inside Meta's window.
  const stageTag = (mappedStage || event_name).toLowerCase();
  const event_id = pick(row, "event_id").trim() || `${igsid}-${stageTag}`;

  const event: BuiltEvent = {
    event_name,
    event_time: toUnix(pick(row, "event_time")),
    action_source: ACTION_SOURCE,
    messaging_channel: MESSAGING_CHANNEL,
    event_id,
    user_data,
  };

  const value = pick(row, "value").trim();
  const username = pick(row, "instagram_username", "username").trim();
  const custom_data: Record<string, any> = {};
  if (value) {
    custom_data.value = parseFloat(value);
    custom_data.currency = (pick(row, "currency").trim() || "EUR").toUpperCase();
  }
  if (username) custom_data.instagram_username = username;
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
