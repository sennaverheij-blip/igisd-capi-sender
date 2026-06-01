import { NextRequest, NextResponse } from "next/server";
import { parseCsv, buildEvents, chunk } from "@/lib/capi";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const csv = String(body.csv || "");
    const dryRun = Boolean(body.dryRun);

    // Vercel env vars (if set) override values typed into the form.
    const accessToken = process.env.META_ACCESS_TOKEN || body.accessToken;
    const datasetId = process.env.META_DATASET_ID || body.datasetId;
    const pageId = process.env.META_PAGE_ID || body.pageId;
    const apiVersion = process.env.META_API_VERSION || body.apiVersion || "v22.0";
    const testEventCode = body.testEventCode || undefined;

    if (!csv.trim()) {
      return NextResponse.json({ error: "No CSV data provided." }, { status: 400 });
    }
    if (!pageId) {
      return NextResponse.json({ error: "Missing Page ID." }, { status: 400 });
    }

    let rows;
    try {
      rows = parseCsv(csv);
    } catch (e: any) {
      return NextResponse.json({ error: `CSV parse failed: ${e?.message}` }, { status: 400 });
    }

    let built;
    try {
      built = buildEvents(rows, pageId);
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "Failed to build events." }, { status: 400 });
    }
    const { events, skipped } = built;

    if (events.length === 0) {
      return NextResponse.json(
        { error: "No rows with an IGSID were found.", rows: rows.length, skipped },
        { status: 400 }
      );
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        rows: rows.length,
        built: events.length,
        skipped,
        sample: events.slice(0, 5),
      });
    }

    if (!accessToken || !datasetId) {
      return NextResponse.json(
        { error: "Missing Access Token or Dataset ID for a live send." },
        { status: 400 }
      );
    }

    const url = `https://graph.facebook.com/${apiVersion}/${datasetId}/events`;
    let received = 0;
    const responses: any[] = [];

    for (const batch of chunk(events, 1000)) {
      const payload: any = { data: batch, access_token: accessToken };
      if (testEventCode) payload.test_event_code = testEventCode;

      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await r.json();

      if (!r.ok) {
        return NextResponse.json(
          {
            error: "Meta API returned an error.",
            status: r.status,
            metaError: json.error || json,
            receivedSoFar: received,
          },
          { status: 502 }
        );
      }

      received += json.events_received ?? batch.length;
      responses.push({
        events_received: json.events_received,
        fbtrace_id: json.fbtrace_id,
        messages: json.messages,
      });
    }

    return NextResponse.json({
      ok: true,
      rows: rows.length,
      built: events.length,
      skipped,
      eventsReceived: received,
      testMode: Boolean(testEventCode),
      responses,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unexpected error." }, { status: 500 });
  }
}
