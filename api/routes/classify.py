"""
Classification endpoint router.
"""
import logging
from fastapi import APIRouter, HTTPException, status
from api.schemas import EmailClassifyRequest, EmailClassifyResponse
from api.adapter import build_classify_response, map_category_to_email_type
from core.classifier import EmailClassifier

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Classification"])
_classifier = EmailClassifier()


@router.post("/classify", response_model=EmailClassifyResponse, summary="Classify inbound email")
async def classify_email_endpoint(payload: EmailClassifyRequest) -> EmailClassifyResponse:
    """
    Classifies an email's intent (Document Comparison, New SI Request, Invoice Query, General, Spam).
    Matches the frontend EmailClassifyRequest / EmailClassifyResponse schema.
    """
    email_data = {
        "subject": payload.subject,
        "snippet": payload.snippet,
        "body": payload.body,
    }

    try:
        domain_result = _classifier.classify(email_data)
        return build_classify_response(domain_result)
    except ValueError as e:
        # Configuration error (e.g. missing API key)
        logger.warning(f"Classification configuration notice: {e}")
        # Fallback heuristic if API key not present, so UI won't crash during demo
        text = f"{payload.subject} {payload.snippet} {payload.body}".lower()
        if any(w in text for w in ["bill of lading", "b/l", "bl draft", "confirm bl", "si and bl"]):
            cat = "BL_COMPARISON"
        elif "invoice" in text or "remittance" in text or "payment" in text:
            cat = "INVOICE_QUERY"
        elif "shipping instruction" in text:
            cat = "SI_REQUEST"
        elif any(w in text for w in ["unsubscribe", "gift card", "promotion", "claim your"]):
            cat = "SPAM"
        else:
            cat = "GENERAL"

        return EmailClassifyResponse(
            type=map_category_to_email_type(cat),
            confidence=0.85,
            reasoning=f"Heuristic fallback (API key not configured: {e})",
        )
    except Exception as e:
        logger.error(f"Error during email classification: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Classification failed: {str(e)}",
        )

