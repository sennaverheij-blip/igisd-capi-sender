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
  custom_data?: { value: number; currency: string };
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
  const igsid = (row.igsid || "").trim();
  if (!igsid) return null; // no IGSID -> can't be matched, skip

  const user_data: Record<string, string> = {
    page_id: String(pageId),
    page_scoped_user_id: igsid, // the IGSID for Instagram messaging events
  };
  if (row.email && row.email.trim()) user_data.em = sha256(row.email);
  if (row.phone && row.phone.trim()) user_data.ph = sha256(normPhone(row.phone));

  const event: BuiltEvent = {
    event_name: (row.event_name || "LeadSubmitted").trim(),
    event_time: toUnix(row.event_time),
    action_source: ACTION_SOURCE,
    messaging_channel: MESSAGING_CHANNEL,
    event_id: (row.event_id || `${igsid}-${Math.floor(Date.now() / 1000)}`).trim(),
    user_data,
  };

  if (row.value && row.value.trim()) {
    event.custom_data = {
      value: parseFloat(row.value),
      currency: (row.currency || "EUR").trim().toUpperCase(),
    };
  }
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
