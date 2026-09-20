"""
Document comparison endpoint router.
Supports both file uploads (PDF/DOCX/TXT/XLSX) and direct text payloads.
Persists comparison history in SQLite ComparisonRecord table.
"""
import json
import logging
from typing import Optional
from fastapi import APIRouter, Depends, File, Form, UploadFile, HTTPException, status
from sqlmodel import Session
from api.db import get_session
from api.models import ComparisonRecord, EmailRecord, utc_now
from api.schemas import CompareResponse, CompareTextRequest
from api.adapter import build_compare_response
from core.check_email import AttachmentExtractor
from core.compare_ai import DocumentComparator
from core.extract import extract_fields, FIELDS
from core.readers.reader import UnreadableAttachment

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Document Comparison"])
_extractor = AttachmentExtractor()
_comparator = DocumentComparator()


def _save_comparison_record(
    session: Session,
    si_name: str,
    bl_name: str,
    response: CompareResponse,
    email_id: Optional[str] = None,
) -> int:
    """Helper to persist ComparisonRecord and update linked EmailRecord if present."""
    fields_data = [f.model_dump() for f in response.fields]
    fields_json = json.dumps(fields_data)

    rec = ComparisonRecord(
        email_id=email_id,
        si_name=si_name,
        bl_name=bl_name,
        status=response.status,
        summary=response.summary,
        fields_json=fields_json,
        reviewed=False,
    )
    session.add(rec)
    session.commit()
    session.refresh(rec)

    if email_id:
        email_rec = session.get(EmailRecord, email_id)
        if email_rec:
            email_rec.status = response.status
            email_rec.updated_at = utc_now()
            session.add(email_rec)
            session.commit()

    return rec.id


@router.post("/compare", response_model=CompareResponse, summary="Compare SI vs BL uploaded document files")
async def compare_documents_files(
    si_file: UploadFile = File(..., description="Shipping Instruction document (PDF, TXT, DOCX, XLSX)"),
    bl_file: UploadFile = File(..., description="Draft Bill of Lading document (PDF, TXT, DOCX, XLSX)"),
    email_id: Optional[str] = Form(default=None, description="Optional Gmail ID to link this comparison"),
    session: Session = Depends(get_session),
) -> CompareResponse:
    """
    Extracts the 7 shipping fields from uploaded SI and draft BL documents and compares them.
    Saves the result to ComparisonRecord and returns comparison_id.
    """
    try:
        si_bytes = await si_file.read()
        bl_bytes = await bl_file.read()

        if not si_bytes or not bl_bytes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One or both uploaded files are empty.",
            )

        si_name = si_file.filename or "si_document"
        bl_name = bl_file.filename or "bl_document"

        try:
            si_fields, _ = _extractor.extract_from_bytes(si_name, si_bytes)
            bl_fields, _ = _extractor.extract_from_bytes(bl_name, bl_bytes)
        except UnreadableAttachment as e:
            res = build_compare_response(
                si_fields={},
                bl_fields={},
                comparison=_comparator.compare({}, {}, FIELDS),
                review_reason=f"Unreadable attachment: {str(e)}",
            )
            res.comparison_id = _save_comparison_record(session, si_name, bl_name, res, email_id)
            return res

        comparison = _comparator.compare(si_fields, bl_fields, FIELDS)
        res = build_compare_response(si_fields, bl_fields, comparison)
        res.comparison_id = _save_comparison_record(session, si_name, bl_name, res, email_id)
        return res

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error during document comparison: {e}", exc_info=True)
        err_str = str(e)
        if "Could not resolve authentication method" in err_str or "ANTHROPIC_API_KEY" in err_str:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="ANTHROPIC_API_KEY is not configured on the backend server.",
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Comparison failed: {err_str}",
        )


@router.post("/compare/text", response_model=CompareResponse, summary="Compare raw document texts")
async def compare_documents_text(
    payload: CompareTextRequest,
    session: Session = Depends(get_session),
) -> CompareResponse:
    """
    Extracts the 7 shipping fields from raw SI and BL document texts and compares them.
    Saves the result to ComparisonRecord and returns comparison_id.
    """
    try:
        si_fields = extract_fields(payload.si_text)
        bl_fields = extract_fields(payload.bl_text)

        comparison = _comparator.compare(si_fields, bl_fields, FIELDS)
        res = build_compare_response(si_fields, bl_fields, comparison)
        res.comparison_id = _save_comparison_record(
            session, "raw_si_text", "raw_bl_text", res, payload.email_id
        )
        return res
    except Exception as e:
        err_str = str(e)
        if "Could not resolve authentication method" in err_str or "ANTHROPIC_API_KEY" in err_str:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="ANTHROPIC_API_KEY is not configured on the backend server.",
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Text comparison failed: {err_str}",
        )
