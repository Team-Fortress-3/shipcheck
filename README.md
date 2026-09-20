# Shipping Document Verification — Extraction & Comparison Pipeline

Part of the Averis x Monash Hackathon 2026 submission. This covers: reading
email attachments in multiple formats, extracting the 7 standard shipment
fields via Claude, comparing Shipping Instruction (SI) vs draft Bill of
Lading (BL) values, and flagging cases that need human review.

## What's in here

| File | Purpose |
|---|---|
| `readers/formats.py` | Converts `.txt`, `.pdf`, `.docx`, `.xlsx` attachments into plain text |
| `readers/reader.py` | Dispatches to the right reader by file extension; distinguishes genuinely broken files from scanned PDFs with no text layer |
| `extract.py` | Calls Claude to extract the 7 fields (shipper, consignee, notify_party, port_of_loading, port_of_discharge, container_count, gross_weight_kg) from a document — text-based, plus a vision fallback for scanned PDFs |
| `parse_eml.py` | Parses a real `.eml` email file (subject, body, attachments) into the same shape the rest of the pipeline expects |
| `check_email.py` | Debug tool — pass one email ID from the dataset, see its full classify → extract → compare breakdown |
| `run_eml_folder.py` | Batch tool — drop `.eml` files into `emails/`, get a report for each; identifies SI vs BL by reading document *content*, not filename, since real emails won't follow the dataset's `_SI`/`_BL` naming convention |

## How it works

```
attachment (any format) → readers/ → plain text
                                          ↓
                          extract.py (Claude, structured output)
                                          ↓
                    compare SI fields vs BL fields (deterministic)
                                          ↓
              OK / MISMATCH / NEEDS_REVIEW (+ which fields, + why)
```

**Escalation (NEEDS_REVIEW) triggers on:**
- Missing SI or BL attachment
- A document that's corrupted / won't open
- A scanned PDF where even the vision fallback can't extract a value
- Any of the 7 fields coming back empty from either document

## Setup

```bash
pip install anthropic pdfplumber python-docx openpyxl PyMuPDF
```

Set your API key as an environment variable — **never hardcode it or commit
it to a file**:

```bash
# macOS/Linux
export ANTHROPIC_API_KEY=sk-ant-...

# Windows PowerShell (current session only)
$env:ANTHROPIC_API_KEY = "sk-ant-..."

# Windows PowerShell (persists across sessions)
setx ANTHROPIC_API_KEY "sk-ant-..."
```

### Dataset

The organizers' dataset (`inbox/` and `attachments/`) is **not included in
this repo** — it's provided separately by Averis and shouldn't be
redistributed. To run `check_email.py` against it, copy those two folders
from the organizers' zip into this directory:

```
.
├── inbox/            <- from the organizers' dataset, not committed
├── attachments/       <- from the organizers' dataset, not committed
├── check_email.py
└── ...
```

## Usage

**Check one email from the dataset:**
```bash
python3 check_email.py 004
```
Prints the email's classification, identifies its SI/BL attachments,
extracts all 7 fields from each, and shows a side-by-side comparison table.

**Process a batch of real `.eml` files:**
```bash
python3 run_eml_folder.py            # looks in ./emails by default
python3 run_eml_folder.py some/folder
```

## Known limitations / next steps

- **Field comparison is currently exact-match** (after basic normalization —
  case, whitespace, commas). It does not yet handle cases where two values
  refer to the same thing but are worded/ordered differently (e.g. a
  reordered address). An AI-based fuzzy comparison step for the text fields
  (shipper, consignee, notify_party, ports) is designed but not yet built —
  see discussion in project notes.
- **`classify.py`** is a teammate's deliverable, not part of this folder —
  the pipeline above assumes a `classify_email(email) -> category` function
  exists somewhere and returns one of the 5 required category strings
  (`BL_COMPARISON`, `SI_REQUEST`, `INVOICE_QUERY`, `GENERAL`, `SPAM`); wire
  it in once it's ready.
- The vision fallback (scanned PDFs) uses a stronger model
  (`claude-sonnet-5`) than plain text extraction (`claude-haiku-4-5`) — this
  was a deliberate fix after testing showed the cheaper model misread
  clearly legible scanned text.
