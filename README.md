# IGSID → CAPI Sender

A tiny web app that sends **Instagram DM conversion events** to the **Meta Conversions API**,
keyed on **Instagram-Scoped User IDs (IGSIDs)**. Drop in a CSV of converted leads → it builds
the events server-side, hashes any PII, and posts them to your dataset.

There is no native Meta UI for uploading IGSID-keyed conversions — they're an API-only path.
This app is that API layer with a form on top.

---

## What you need from Meta first

1. **Dataset ID** — Events Manager → Data sources → your **Instagram DM** dataset.
   (This is the "Dataset ID", *not* the old Pixel ID.) If you don't have one:
   Events Manager → create a dataset with an Instagram DM source.
2. **Page ID** — the Facebook Page linked to the Instagram account.
3. **Access token** — a System User token (Business Settings → System Users) with
   `ads_management` and `business_management`, with access to the dataset/ad account.

---

## Deploy to Vercel (pick one)

### Option A — Git + Vercel dashboard (easiest)
1. Push this folder to a new GitHub repo.
2. Go to vercel.com → **Add New → Project** → import the repo.
3. Framework preset auto-detects **Next.js**. Click **Deploy**. Done.

### Option B — Vercel CLI
```bash
npm i -g vercel
cd capi-igsid-sender
vercel        # follow prompts; accept Next.js defaults
vercel --prod # deploy to production
```

### Run locally first (optional)
```bash
npm install
npm run dev     # http://localhost:3000
```

---

## Using it

1. Open the deployed URL.
2. Fill **Access token**, **Dataset ID**, **Page ID** (API version defaults to `v22.0`).
3. Choose your **CSV** (or paste it). Only the `igsid` column is required.
4. Leave **Dry run** ticked → **Preview events**. Check the JSON looks right.
5. Paste a **Test event code** (Events Manager → Test events), untick Dry run, **Send** —
   watch the events appear under Test events.
6. Once confirmed, clear the test code and send for real.

### CSV format
```
igsid,event_name,event_time,value,currency,event_id,email,phone
1784140...,LeadSubmitted,2026-05-01T14:30:00Z,2500,EUR,conv-0001,,
1784140...,Purchase,2026-05-03T09:00:00Z,5000,EUR,conv-0002,jane@x.com,+31612345678
```
| Column | Required | Notes |
|---|---|---|
| `igsid` | ✅ | Instagram-Scoped User ID. Rows without it are skipped. |
| `event_name` | | Default `LeadSubmitted`. e.g. `Purchase`, `Schedule`. |
| `event_time` | | Unix seconds or ISO-8601. Default = now. Backdated events allowed within the attribution window. |
| `value` / `currency` | | For value-based optimisation. |
| `event_id` | | For de-duplication; auto-generated if blank. Re-running is safe. |
| `email` / `phone` | | Optional extra match keys; SHA-256 hashed before sending. |

---

## Security notes

- The token is sent to **this app's own serverless function over HTTPS** and used per request —
  it is never stored or logged. Because the app does nothing on its own, a stranger opening the
  URL can't do anything without their own token.
- **Recommended hardening:** set `META_ACCESS_TOKEN` (and optionally `META_DATASET_ID`,
  `META_PAGE_ID`) as Environment Variables in Vercel. If set, they override the form fields, so
  the token never has to be typed into a browser. See `.env.example`.
- Optionally enable Vercel **Deployment Protection** (password / SSO) so only your team can open it.

---

## One thing to verify before a big run

The messaging-event fields live at the top of `lib/capi.ts`:
`action_source = "business_messaging"`, `messaging_channel = "instagram"`, IGSID in
`page_scoped_user_id`. This matches Meta's current documented pattern, but Meta has changed
messaging-CAPI parameters across API versions — so always confirm against the Graph API docs
for your version, and rely on the dry run + test-event check to catch a mismatch early.

## Notes on attribution

IGSID matching is strongest for conversions that originated from **click-to-DM ads** (the IGSID
bridges the ad click to the in-DM conversion). Organic converts still land and still identify the
person, but with no ad click behind them their optimisation value is thinner. Consider tagging
the two groups with different `event_name`s so you can compare them in Events Manager.
