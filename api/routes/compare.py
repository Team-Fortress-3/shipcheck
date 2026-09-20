"""
Document comparison endpoint router.
Supports both file uploads (PDF/DOCX/TXT/XLSX) and direct text payloads.
"""
import logging
from typing import Optional
from fastapi import APIRouter, File, UploadFile, HTTPException, status
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


@router.post("/compare", response_model=CompareResponse, summary="Compare SI vs BL uploaded document files")
async def compare_documents_files(
    si_file: UploadFile = File(..., description="Shipping Instruction document (PDF, TXT, DOCX, XLSX)"),
    bl_file: UploadFile = File(..., description="Draft Bill of Lading document (PDF, TXT, DOCX, XLSX)"),
) -> CompareResponse:
    """
    Extracts the 7 shipping fields from uploaded SI and draft BL documents and compares them.
    Returns status ('Match', 'Mismatch', 'Needs Review') and field-by-field breakdown.
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
            return build_compare_response(
                si_fields={},
                bl_fields={},
                comparison=_comparator.compare({}, {}, FIELDS),
                review_reason=f"Unreadable attachment: {str(e)}",
            )

        comparison = _comparator.compare(si_fields, bl_fields, FIELDS)
        return build_compare_response(si_fields, bl_fields, comparison)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error during document comparison: {e}", exc_info=True)
        # Check for missing Anthropic key notice
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
async def compare_documents_text(payload: CompareTextRequest) -> CompareResponse:
    """
    Extracts the 7 shipping fields from raw SI and BL document texts and compares them.
    """
    try:
        si_fields = extract_fields(payload.si_text)
        bl_fields = extract_fields(payload.bl_text)

        comparison = _comparator.compare(si_fields, bl_fields, FIELDS)
        return build_compare_response(si_fields, bl_fields, comparison)
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

