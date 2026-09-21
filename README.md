# ShipCheck

**AI-powered shipping document verification** — built for the Averis x Monash Hackathon 2026.

ShipCheck reads a team's Gmail inbox, classifies every incoming message into one of five
categories, and for document-comparison requests, automatically extracts and compares 7
shipment fields between a **Shipping Instruction (SI)** and a draft **Bill of Lading (BL)** —
flagging discrepancies for human review before the BL is finalized.

---

## Why

Verifying a draft Bill of Lading against the original Shipping Instruction is normally a manual,
error-prone process: an ops team member has to open both documents, cross-check 7 separate
fields by eye, and catch formatting differences that hide real discrepancies (or, worse, miss
a real discrepancy hiding behind a formatting difference). ShipCheck automates that pipeline
end-to-end — from inbox to a flagged, reviewable result.

## What it does

1. **Classify** — every inbound email is classified by intent (not keywords) into one of:
   `Document Comparison`, `New SI Request`, `Invoice Query`, `General`, or `Spam`.
2. **Extract** — for document-comparison emails, the SI and BL attachments (PDF, DOCX, XLSX,
   or TXT — including scanned/image-only PDFs via a vision fallback) are read and 7 standard
   shipment fields are extracted from each: shipper, consignee, notify party, port of loading,
   port of discharge, container count, and gross weight.
3. **Compare** — a hybrid comparator checks the two field sets: cheap deterministic
   normalize-and-compare first (handles separator/formatting differences for free), then an
   AI-assisted second pass only when a text field still disagrees after normalization.
   Numeric fields never go through the AI path.
4. **Escalate** — each comparison resolves to `Match`, `Mismatch`, or `Needs Review`, surfaced
   in a review queue and a reporting dashboard so a human makes the final call.

## Architecture

```
                    Gmail inbox (shared team account)
                              │
                     ┌────────┴────────┐
                     │   Classifier    │  OpenRouter Jev decision model
                     └────────┬────────┘
                              │
              ┌───────────────┴────────────────┐
              │                                 │
     Document Comparison                  New SI Request / Invoice
     Query / General / Spam
              │
     ┌────────┴────────┐
     │    Extractor     │  Claude Haiku (text) / Sonnet (scanned/vision)
     └────────┬────────┘
              │
     ┌────────┴────────┐
     │    Comparator     │  Deterministic normalize-and-compare
     │                   │  + Claude-assisted second pass (text fields only)
     └────────┬────────┘
              │
     Match / Mismatch / Needs Review
              │
     ┌────────┴────────┐
     │  React dashboard  │  Inbox, Review queue, Reports, Upload & Compare
     └───────────────────┘
```

## Repo layout

This is a single repo containing both halves of the app:

```
shipcheck/
├── backend/     — FastAPI + Postgres (Supabase), Python
└── frontend/    — React + Vite + TypeScript
```

Each folder keeps its own dependency manifest and its own `README.md` with more detail; this
root README covers the project as a whole and how to run it end-to-end.

## Tech stack

| | |
|---|---|
| **Backend** | Python, FastAPI, SQLModel/SQLAlchemy, Postgres (Supabase) with a SQLite fallback for local dev |
| **AI / ML** | Claude (Haiku for text extraction, Sonnet for the scanned-document vision fallback), OpenRouter's Jev model for email classification |
| **Frontend** | React, Vite, TypeScript |
| **Auth** | Supabase (email/Google OAuth), with a server-side Gmail integration (OAuth authorization-code flow + refresh token) for shared team inbox sync |

## Getting started

### Backend

```bash
cd backend
pip install -r requirements.txt
```

Create a `.env` file in `backend/` with:

```ini
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-v1-...
DATABASE_URL=postgresql://...        # optional — falls back to local SQLite if unset
SUPABASE_JWT_SECRET=...
GMAIL_CLIENT_ID=...                  # optional — enables server-side Gmail sync
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
```

Run it:

```bash
python3 -m uvicorn api.main:app --reload --port 8000
```

Run the (fully mocked, no API keys needed) test suite:

```bash
python3 -m unittest discover -s tests -p "test_*.py" -v
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # fill in VITE_GOOGLE_CLIENT_ID if using real Google login
npm run dev
```

Opens on `http://localhost:5173` and proxies API calls to the backend at
`http://localhost:8000` (see `vite.config.ts`'s `server.proxy`).

## Team

Built by Team Fortress 3 for the Averis x Monash Hackathon 2026.
