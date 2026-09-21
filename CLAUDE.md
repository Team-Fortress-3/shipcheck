# ShipCheck — Averis x Monash Hackathon 2026

AI-powered shipping document verification. Reads an email inbox, classifies
each message into one of 5 categories, and for document-comparison requests,
extracts and compares 7 shipment fields between a Shipping Instruction (SI)
and a draft Bill of Lading (BL), flagging discrepancies before the BL is
finalized.

## Repo layout

This is a combined workspace containing two separate git repos:

```
shipcheck-project/
├── backend/     — FastAPI + Postgres (Supabase), Python
└── frontend/    — React + Vite + TypeScript
```

Each has its own `.git`, its own `README.md`, and its own dependencies.
They're only combined here so an agent can see both sides at once — commits
still need to happen from inside the correct subfolder.

## Backend (`backend/`)

**Stack:** Python, FastAPI, SQLModel/SQLAlchemy, Postgres (Supabase in
production, SQLite fallback locally if `DATABASE_URL` isn't set).

**Core pipeline** (`core/`): classify → extract → compare → escalate.
- `core/classifier.py` — 5-category classification via OpenRouter's Jev
  decision model (`~typesafe/jev-latest`). Judge by intent, not keywords —
  see "Known gotchas" below, this bit us once already.
- `core/extract.py` — field extraction via Claude (Haiku for text,
  Sonnet for the scanned-document/vision fallback — Haiku was tested and
  found to misread clearly legible scanned text, Sonnet fixed it).
- `core/compare_ai.py` — hybrid comparison: cheap deterministic
  normalize-and-compare first (handles separator/formatting differences for
  free), AI-assisted second pass only when that still disagrees on a text
  field (shipper/consignee/notify_party/ports). Numeric fields
  (container_count, gross_weight_kg) never go through the AI path.
- `readers/` — multi-format document reading (txt/pdf/docx/xlsx), plus
  PDF-to-image rendering for the vision fallback.

**API layer** (`api/`): FastAPI routes serving the frontend.
- `api/routes/emails.py` — batch classify/sync endpoint. Classification
  runs concurrently via a thread pool (`ThreadPoolExecutor`, 8 workers)
  wired into the async event loop via `run_in_executor` — this used to be
  sequential and took ~7.5s for 25 emails, now ~1.25s.
- `api/db.py` — reads `DATABASE_URL` env var, falls back to local SQLite
  (`shipcheck.db`) if unset. **`shipcheck.db` is gitignored and safe to
  delete anytime** — schema auto-recreates on startup via `init_db()`.
- `api/auth.py` — Supabase-based auth; unauthenticated requests default to
  a `"demo"` user_id.

**Run it:**
```bash
cd backend
pip install -r requirements.txt
# .env needs: ANTHROPIC_API_KEY, OPENROUTER_API_KEY, DATABASE_URL, SUPABASE_JWT_SECRET
python3 -m uvicorn api.main:app --reload --port 8000
```

**Tests:** `python3 -m unittest discover -s tests -p "test_*.py" -v` — all
mocked, no real API keys needed to run them. Keep this passing.

## Frontend (`frontend/`)

**Stack:** React, Vite, TypeScript. Structured into `src/pages/`,
`src/components/`, `src/services/`.

**Auth:** Supabase (email/Google OAuth) + a "Continue with Demo Data"
fallback when `VITE_GOOGLE_CLIENT_ID` is unset.

**Run it:**
```bash
cd frontend
npm install
copy .env.example .env.local   # then fill in VITE_GOOGLE_CLIENT_ID if using real login
npm run dev
```
Opens on `http://localhost:5173`. Proxies API calls to the backend at
`http://localhost:8000` — check `vite.config.ts`'s `server.proxy` target
if requests aren't reaching the backend.

## Known gotchas (learned the hard way today — don't re-break these)

1. **Classifier criteria wording matters a lot.** The Jev model appears to
   do something closer to semantic similarity matching than instruction-
   following. Putting a "don't classify as X" example *inside* X's own
   category description backfired — it pulled matches toward X instead of
   away. Fix: put negative examples in the category they actually belong
   to instead, not as an exclusion inside the wrong one.

2. **`ComparisonPage` (frontend) doesn't receive real `fields` data from
   the inbox click-through flow.** `App.tsx` renders `<ComparisonPage
   subject={...} onBack={...} onGoToUpload={...} />` with no `fields` prop
   — so clicking "Process Documents" on a real inbox email currently shows
   an honest "No Comparison Data Found" empty state, not real results. The
   only path with a real, working comparison end-to-end right now is the
   separate **Upload & Compare** page (`compareFilesApi`). Wiring the inbox
   flow up needs new plumbing to fetch that specific email's Gmail
   attachments and send them to `/api/compare` — not yet built.

3. **Concurrent batch requests can race on insert.** Fixed in
   `api/routes/emails.py` via `session.merge()` instead of a blind insert,
   plus an `IntegrityError` retry fallback. If you see
   `duplicate key value violates unique constraint "emailrecord_pkey"`
   again, check that this fix wasn't reverted.

4. **Never commit `.env`, `api key.txt`, or `shipcheck.db`.** All should
   be gitignored in both repos. If real credentials ever get pasted into
   chat/Discord, rotate them (Anthropic console, OpenRouter dashboard,
   Supabase project settings) once things settle down.

5. **The `vite.config.ts` proxy "target" URL** was previously pointed at
   a Cloud Run hostname with `:8000` appended, which isn't how Cloud Run
   URLs normally resolve — for local dev it should point at
   `http://localhost:8000`.

## Dataset

The hackathon's dataset (`inbox/`, `attachments/` — ~520 emails) is
provided separately by the organizers and is gitignored in `backend/` —
not committed, not redistributed. Copy it in locally to test against
`core/check_email.py` or the batch runner scripts.

## Submission deadline

Google Form submission (project description, GitHub link, live demo link,
slide deck/docs link, video demo ≤5 min) is due **22 September 2026,
12:00 PM**. If shortlisted to the Top 10, Final Pitch Day is **26
September 2026** at Monash University Malaysia, Subang Jaya (10 min
pitch/demo + 5 min Q&A, in person).
