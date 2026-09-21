"""
Inbox caching and batch email routes for ShipCheck.
Provides instant (<10ms) loading from SQLite and intelligent caching.
"""
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.exc import IntegrityError
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

# Shared thread pool for running the blocking classify() calls concurrently
# without blocking FastAPI's event loop. Reused across requests rather than
# created fresh each time. Lower this if you see rate-limit (429) errors.
_classify_executor = ThreadPoolExecutor(max_workers=8)


def _classify_sync(item: EmailRecordCreate):
    """Runs in a worker thread. Returns (item, classify_response)."""
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
    return item, classify_resp


@router.get("", response_model=List[EmailRecord], summary="Get cached inbox emails")
async def get_emails(
    limit: int = Query(default=50, ge=1, le=500),
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
        stmt = stmt.where(EmailRecord.user_id == user_id)
    if email_type:
        stmt = stmt.where(EmailRecord.email_type == email_type)
    if status:
        stmt = stmt.where(EmailRecord.status == status)

    stmt = stmt.order_by(EmailRecord.timestamp.desc()).offset(offset).limit(limit)
    return session.exec(stmt).all()


@router.post("/batch", response_model=List[EmailRecord], summary="Sync and batch-classify Gmail messages")
async def batch_sync_emails(
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

    # 1. Fetch all existing records for this user in one query
    email_ids = [e.id for e in emails]
    stmt = select(EmailRecord).where(EmailRecord.id.in_(email_ids))
    if user_id:
        stmt = stmt.where(EmailRecord.user_id == user_id)
    existing_records = {rec.id: rec for rec in session.exec(stmt).all()}

    results_by_id: dict[str, EmailRecord] = {}
    needs_classify: List[EmailRecordCreate] = []

    # Pass 1: figure out which items are already cached vs need classifying
    for item in emails:
        if item.id in existing_records:
            rec = existing_records[item.id]
            if rec.status and rec.status != "Processing":
                results_by_id[item.id] = rec
                continue
        needs_classify.append(item)

    # Pass 2: classify everything that needs it CONCURRENTLY, not one at a
    # time - this is the part that used to take a while for a 25-email batch.
    if needs_classify:
        loop = asyncio.get_event_loop()
        classify_tasks = [
            loop.run_in_executor(_classify_executor, _classify_sync, item)
            for item in needs_classify
        ]
        classified_pairs = await asyncio.gather(*classify_tasks)
    else:
        classified_pairs = []

    # Pass 3: fast local DB writes, sequential (no need to parallelize this part).
    # pending_new holds the transient (not-yet-committed) objects for brand
    # new records, keyed by id, so a retry after a race can reuse the exact
    # same objects with session.merge() instead of rebuilding them.
    pending_new: dict[str, EmailRecord] = {}

    for item, classify_resp in classified_pairs:
        effective_user_id = item.user_id or user_id
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
            results_by_id[item.id] = rec
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
            pending_new[item.id] = new_record
            results_by_id[item.id] = session.merge(new_record)

    try:
        session.commit()
    except IntegrityError:
        # Another concurrent request inserted one of these rows between our
        # existence check and this commit. Roll back and retry with merge
        # (update-if-exists) instead of a blind insert, reusing the exact
        # same transient objects - they were never persisted, so rollback
        # doesn't invalidate them.
        session.rollback()
        logger.warning("Batch sync hit a concurrent-insert race, retrying with merge")
        for eid, transient_record in pending_new.items():
            results_by_id[eid] = session.merge(transient_record)
        session.commit()

    for r in results_by_id.values():
        session.refresh(r)

    # Return in the same order the request came in, per this endpoint's contract
    return [results_by_id[item.id] for item in emails if item.id in results_by_id]