"""
Inbox caching and batch email routes for ShipCheck.
Provides instant (<10ms) loading from SQLite and intelligent caching.
"""
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select
from api.db import get_session
from api.models import EmailRecord, utc_now
from api.schemas import EmailRecordCreate
from api.routes.classify import classify_text_heuristic
from api.adapter import build_classify_response, map_category_to_email_type
from api.auth import get_current_user_id
from core.classifier import EmailClassifier

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/emails", tags=["Emails"])
_classifier = EmailClassifier()


@router.get("", response_model=List[EmailRecord], summary="Get cached inbox emails")
def get_emails(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    email_type: Optional[str] = Query(default=None, description="Filter by EmailType"),
    status: Optional[str] = Query(default=None, description="Filter by EmailStatus"),
    user_id: Optional[str] = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> List[EmailRecord]:
    """
    Returns cached EmailRecords sorted by timestamp descending.
    Allows the frontend to load inbox instantly (<10ms) without hitting Gmail or LLMs.
    """
    stmt = select(EmailRecord)
    if user_id:
        if user_id == "demo":
            stmt = stmt.where((EmailRecord.user_id == "demo") | (EmailRecord.user_id == None))
        else:
            stmt = stmt.where(EmailRecord.user_id == user_id)
    if email_type:
        stmt = stmt.where(EmailRecord.email_type == email_type)
    if status:
        stmt = stmt.where(EmailRecord.status == status)

    stmt = stmt.order_by(EmailRecord.timestamp.desc()).offset(offset).limit(limit)
    return session.exec(stmt).all()


@router.post("/batch", response_model=List[EmailRecord], summary="Sync and batch-classify Gmail messages")
def batch_sync_emails(
    emails: List[EmailRecordCreate],
    user_id: Optional[str] = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> List[EmailRecord]:
    """
    Intelligent cache layer:
    For each incoming Gmail message:
      - If already present in SQLite/Postgres for this user, returns cached record (0 LLM cost).
      - If new, classifies via EmailClassifier (or heuristic fallback) and saves to database.
    Returns the complete list of emails in original order.
    """
    if not emails:
        return []

    # 1. Fetch all existing records by ID in one query
    email_ids = [e.id for e in emails]
    stmt = select(EmailRecord).where(EmailRecord.id.in_(email_ids))
    existing_records = {rec.id: rec for rec in session.exec(stmt).all()}

    results: List[EmailRecord] = []
    to_add: List[EmailRecord] = []

    for item in emails:
        effective_user_id = item.user_id or user_id

        if item.id in existing_records:
            rec = existing_records[item.id]
            user_matches = (
                rec.user_id == effective_user_id
                or not rec.user_id
                or not effective_user_id
                or effective_user_id == "demo"
            )
            if user_matches and rec.status and rec.status != "Processing":
                # Claim record for authenticated user if previously unassigned
                if not rec.user_id and effective_user_id and effective_user_id != "demo":
                    rec.user_id = effective_user_id
                    session.add(rec)
                results.append(rec)
                continue

        # 2. Classify new or unclassified email
        email_data = {
            "subject": item.subject,
            "snippet": item.snippet,
            "body": item.body or item.body_snippet or "",
        }

        try:
            domain_result = _classifier.classify(email_data)
            classify_resp = build_classify_response(domain_result)
        except Exception as e:
            logger.warning(f"Batch classification notice for {item.id}: {e}")
            cat = classify_text_heuristic(item.subject, item.snippet, item.body or "")
            classify_resp = build_classify_response(
                domain_result=type("Dummy", (), {
                    "category": cat,
                    "confidence": 0.85,
                    "probabilities": {},
                })()
            )

        email_type = classify_resp.type
        status = "New" if email_type == "Document Comparison" else "Classified"

        if item.id in existing_records:
            rec = existing_records[item.id]
            rec.user_id = effective_user_id or rec.user_id
            rec.email_type = email_type
            rec.status = status
            rec.confidence = classify_resp.confidence
            rec.reasoning = classify_resp.reasoning
            rec.body_snippet = item.body_snippet or (item.body[:200] if item.body else item.snippet[:200])
            rec.updated_at = utc_now()
            session.add(rec)
            results.append(rec)
        else:
            new_record = EmailRecord(
                id=item.id,
                user_id=effective_user_id,
                thread_id=item.thread_id,
                from_name=item.from_name,
                from_email=item.from_email,
                subject=item.subject,
                snippet=item.snippet,
                date_str=item.date_str,
                timestamp=item.timestamp,
                email_type=email_type,
                status=status,
                confidence=classify_resp.confidence,
                reasoning=classify_resp.reasoning,
                has_attachments=item.has_attachments,
                body_snippet=item.body_snippet or (item.body[:200] if item.body else item.snippet[:200]),
                created_at=utc_now(),
                updated_at=utc_now(),
            )
            to_add.append(new_record)
            results.append(new_record)

    if to_add:
        session.add_all(to_add)
    session.commit()
    for r in results:
        session.refresh(r)

    return results

