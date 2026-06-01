"use client";

import { useState } from "react";

export default function Home() {
  const [accessToken, setAccessToken] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [pageId, setPageId] = useState("");
  const [apiVersion, setApiVersion] = useState("v22.0");
  const [testEventCode, setTestEventCode] = useState("");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setCsv(await file.text());
  }

  async function send() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken,
          datasetId,
          pageId,
          apiVersion,
          testEventCode,
          csv,
          dryRun,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const meta = json.metaError ? ` — ${JSON.stringify(json.metaError)}` : "";
        setError((json.error || "Request failed.") + meta);
      }
      setResult(json);
    } catch (e: any) {
      setError(e?.message || "Network error.");
    } finally {
      setLoading(false);
    }
  }

  const canSend = csv.trim().length > 0 && !loading;

  return (
    <main className="wrap">
      <p className="eyebrow">Meta Conversions API · Instagram DM</p>
      <h1>IGSID → CAPI Sender</h1>
      <p className="sub">
        Upload a CSV of converted leads keyed on their Instagram-Scoped User IDs (IGSIDs).
        Events are built and signed on the server and posted to your Meta dataset as
        business-messaging conversions. Always preview with a dry run, then validate with a
        test-event code before sending live.
      </p>

      <div className="card">
        <p className="card-title">Connection</p>
        <div className="grid">
          <div className="full">
            <label>Access token</label>
            <input
              type="password"
              placeholder="System-user token (ads_management + business_management)"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              autoComplete="off"
            />
            <p className="hint">
              Stays inside your own deployment. For extra safety, set it as the{" "}
              <code style={{ fontFamily: "var(--mono)" }}>META_ACCESS_TOKEN</code> env var in
              Vercel instead — that overrides this field.
            </p>
          </div>
          <div>
            <label>Dataset ID</label>
            <input
              type="text"
              placeholder="Instagram-DM dataset (not Pixel ID)"
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
            />
          </div>
          <div>
            <label>Page ID</label>
            <input
              type="text"
              placeholder="Facebook Page linked to the IG account"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
            />
          </div>
          <div>
            <label>API version</label>
            <input type="text" value={apiVersion} onChange={(e) => setApiVersion(e.target.value)} />
          </div>
          <div>
            <label>Test event code (optional)</label>
            <input
              type="text"
              placeholder="From Events Manager → Test events"
              value={testEventCode}
              onChange={(e) => setTestEventCode(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <p className="card-title">Data</p>
        <div className="file">
          <label htmlFor="csv" className="file-btn">Choose CSV</label>
          <input id="csv" type="file" accept=".csv,text/csv" onChange={handleFile} />
          <span className="file-name">{fileName || "No file selected"}</span>
        </div>
        <p className="hint" style={{ marginBottom: 14 }}>
          Required column: <code style={{ fontFamily: "var(--mono)" }}>igsid</code>. Optional:
          event_name, event_time, value, currency, event_id, email, phone. Or paste below.
        </p>
        <textarea
          placeholder="igsid,event_name,event_time,value,currency,event_id,email,phone&#10;1784140...,Purchase,2026-05-01T14:30:00Z,5000,EUR,conv-0001,,"
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            if (e.target.value && !fileName) setFileName("");
          }}
        />
      </div>

      <div className="card">
        <div className="row">
          <label className="toggle">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            <span>Dry run (build &amp; preview, don&apos;t send)</span>
          </label>
          <button className="send" onClick={send} disabled={!canSend}>
            {loading ? "Working…" : dryRun ? "Preview events" : "Send to CAPI"}
          </button>
        </div>
      </div>

      {(result || error) && (
        <div className="result">
          {error && <div className="banner err">{error}</div>}
          {result?.ok && (
            <div className="banner ok">
              {result.testMode
                ? "Sent in TEST mode — check Events Manager → Test events to confirm."
                : "Live events accepted by Meta. Confirm match quality in Events Manager."}
            </div>
          )}
          {result?.dryRun && (
            <div className="banner warn">
              Dry run only — nothing was sent. Showing the first {Math.min(5, result.built)} built events.
            </div>
          )}
          {result && !error && (
            <div className="stat-row">
              {"rows" in result && (
                <div className="stat"><b>{result.rows}</b><span>Rows</span></div>
              )}
              {"built" in result && (
                <div className="stat"><b>{result.built}</b><span>Built</span></div>
              )}
              {"skipped" in result && (
                <div className="stat"><b>{result.skipped}</b><span>Skipped</span></div>
              )}
              {"eventsReceived" in result && (
                <div className="stat"><b>{result.eventsReceived}</b><span>Received</span></div>
              )}
            </div>
          )}
          {result && (
            <pre>{JSON.stringify(result.sample ?? result.responses ?? result, null, 2)}</pre>
          )}
        </div>
      )}

      <p className="foot">
        Skipped rows have no IGSID and can&apos;t be matched. PII (email/phone) is SHA-256 hashed
        before sending; the IGSID rides in <code>page_scoped_user_id</code>. Verify messaging
        params in <code>lib/capi.ts</code> against your Graph API version before a large run.
      </p>
    </main>
  );
}
