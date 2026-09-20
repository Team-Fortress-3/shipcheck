"""
Debug tool — check one email's SI vs BL extraction and comparison at a glance.

Usage:
    python3 check_email.py 115
    python3 check_email.py email_115          (also works)

Expects two folders sitting next to this script:
    inbox/           containing email_NNN.json files
    attachments/      containing email_NNN_SI.* and email_NNN_BL.* files

Set ANTHROPIC_API_KEY before running (this calls the real Claude API).
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent / "readers"))

from classify_wrapper import classify_email  # noqa: E402
from extract import extract_fields, extract_fields_from_image, FIELDS  # noqa: E402
from readers.reader import read_attachment_text, UnreadableAttachment, ScannedPDF  # noqa: E402
from readers.formats import render_pdf_page_as_image  # noqa: E402

INBOX_DIR = Path(__file__).parent / "inbox"
ATTACHMENTS_DIR = Path(__file__).parent / "attachments"


def normalize_id(raw: str) -> str:
    return raw if raw.startswith("email_") else f"email_{raw.zfill(3)}"


def load_email(email_id: str) -> dict:
    path = INBOX_DIR / f"{email_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"No such email: {path}")
    return json.loads(path.read_text())


def get_fields_for_attachment(rel_path: str) -> tuple[dict, str]:
    """Returns (extracted_fields, method) where method is 'text' or 'vision',
    so the caller can report which path was used. Raises UnreadableAttachment
    if neither text extraction nor the vision fallback works."""
    filename = rel_path.rsplit("/", 1)[-1]
    full_path = ATTACHMENTS_DIR / filename
    raw = full_path.read_bytes()

    try:
        text = read_attachment_text(filename, raw)
        return extract_fields(text), "text"
    except ScannedPDF as e:
        print(f"  (no text layer detected — rendering as image and using vision extraction)")
        image_bytes = render_pdf_page_as_image(e.raw_bytes)
        return extract_fields_from_image(image_bytes), "vision"


def normalize_for_compare(value):
    if value is None:
        return None
    return " ".join(str(value).strip().upper().replace(",", "").split())


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 check_email.py <email number, e.g. 115>")
        sys.exit(1)

    email_id = normalize_id(sys.argv[1])
    print(f"=== {email_id} ===\n")

    email = load_email(email_id)
    print(f"From:    {email['from']}")
    print(f"Subject: {email['subject']}")
    print(f"Body:    {email['body'][:200]}{'...' if len(email['body']) > 200 else ''}")
    print()

    attachments = email.get("attachments", [])
    print(f"Attachments ({len(attachments)}): {attachments}")
    print()

    print("Classifying...")
    category = classify_email(email)
    print(f"Category: {category}")
    print()

    if category != "BL_COMPARISON":
        print("(not a comparison request — nothing further to do)")
        return

    if not attachments:
        print("No attachments on this email — nothing to compare.")
        return

    si_path = next((a for a in attachments if "_SI." in a), None)
    bl_path = next((a for a in attachments if "_BL." in a), None)

    if not si_path or not bl_path:
        print(f"Missing SI or BL attachment — SI: {si_path}, BL: {bl_path}")
        print("This would be flagged NEEDS_REVIEW / missing_attachment in the real pipeline.")
        return

    print(f"SI: {si_path}")
    print(f"BL: {bl_path}")
    print()

    results = {}
    for label, path in [("SI", si_path), ("BL", bl_path)]:
        try:
            fields, method = get_fields_for_attachment(path)
        except UnreadableAttachment as e:
            print(f"[{label}] UNREADABLE: {e}")
            print("This would be flagged NEEDS_REVIEW / unreadable in the real pipeline.")
            return
        print(f"Extracting {label} fields via Claude ({method})...")
        results[label] = fields

    si_fields, bl_fields = results["SI"], results["BL"]

    from compare_ai import compare_fields_hybrid, normalize

    defect_fields, ai_reasoning = compare_fields_hybrid(si_fields, bl_fields, FIELDS)

    print()
    print(f"{'FIELD':<20} {'SI':<35} {'BL':<35} {'MATCH'}")
    print("-" * 100)
    for field in FIELDS:
        si_val = si_fields.get(field)
        bl_val = bl_fields.get(field)
        match = field not in defect_fields
        marker = "✓" if match else "✗ MISMATCH"
        si_display = str(si_val)[:33] if si_val is not None else "(none)"
        bl_display = str(bl_val)[:33] if bl_val is not None else "(none)"
        print(f"{field:<20} {si_display:<35} {bl_display:<35} {marker}")
        if field in ai_reasoning:
            print(f"  (AI check: {ai_reasoning[field]})")

    print()
    if defect_fields:
        print("Result: MISMATCH")
    else:
        print("Result: OK — no mismatch detected")


if __name__ == "__main__":
    main()