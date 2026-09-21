"""
Server-side Gmail API service for ShipCheck.
Manages Google OAuth 2.0 refresh tokens, automatic access token renewal,
and background fetching of inbox emails directly from Google.
"""
import os
import re
import asyncio
import base64
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple, Dict, Any

import httpx
from sqlmodel import Session, select

from api.models import EmailIntegration, utc_now

logger = logging.getLogger(__name__)

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"

# Everyone on the team shares one Gmail account/quota via a single server-side
# refresh token, so concurrency has to be capped application-wide (not just
# per-request) - otherwise a couple of people syncing/opening emails at the
# same time is enough to blow the Gmail API's per-user-per-minute quota.
_GMAIL_CONCURRENCY = asyncio.Semaphore(5)
_GMAIL_MAX_RETRIES = 4
_GMAIL_RETRY_BASE_DELAY = 1.0  # seconds; doubles each retry


def _is_rate_limited(resp: httpx.Response) -> bool:
    """Gmail returns 429 for some rate limits and 403 for others (its 403
    covers both real permission errors and quota/rate-limit errors), so the
    body has to be inspected to tell a real permission failure from a
    transient rate limit worth retrying."""
    if resp.status_code == 429:
        return True
    if resp.status_code == 403:
        body = resp.text.lower()
        return "ratelimitexceeded" in body or "quotaexceeded" in body or "rate_limit_exceeded" in body
    return False


async def _gmail_get(client: httpx.AsyncClient, url: str, token: str, params: Optional[Dict[str, Any]] = None) -> httpx.Response:
    """GET against the Gmail API, capped to _GMAIL_CONCURRENCY concurrent
    requests app-wide and retried with exponential backoff on rate-limit
    responses instead of failing the whole sync/fetch on the first 403."""
    delay = _GMAIL_RETRY_BASE_DELAY
    resp: Optional[httpx.Response] = None
    async with _GMAIL_CONCURRENCY:
        for attempt in range(_GMAIL_MAX_RETRIES + 1):
            resp = await client.get(url, headers={"Authorization": f"Bearer {token}"}, params=params)
            if resp.is_success or not _is_rate_limited(resp):
                return resp
            if attempt < _GMAIL_MAX_RETRIES:
                logger.warning(f"Gmail rate limited on {url} (attempt {attempt + 1}/{_GMAIL_MAX_RETRIES + 1}) - retrying in {delay:.1f}s")
                await asyncio.sleep(delay)
                delay *= 2
    return resp

# In-memory token cache fallback if DB is not writable, keyed by user_id so
# one user's cached token can never be handed to another user's request.
_MEM_CACHE: Dict[str, Dict[str, Any]] = {}


def to_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Ensures a datetime is timezone-aware in UTC so comparisons never fail."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def get_oauth_credentials() -> Tuple[str, str]:
    """Returns (client_id, client_secret) from environment. No hardcoded
    fallback - these are real OAuth credentials and must come from .env
    (which is gitignored), never from source."""
    client_id = (
        os.environ.get("GMAIL_CLIENT_ID")
        or os.environ.get("GOOGLE_CLIENT_ID")
        or os.environ.get("VITE_GOOGLE_CLIENT_ID")
    )
    client_secret = (
        os.environ.get("GMAIL_CLIENT_SECRET")
        or os.environ.get("GOOGLE_CLIENT_SECRET")
        or os.environ.get("VITE_GOOGLE_CLIENT_SECRET")
    )
    if not client_id or not client_secret:
        raise RuntimeError(
            "Gmail OAuth credentials are not configured. Set GMAIL_CLIENT_ID and "
            "GMAIL_CLIENT_SECRET in backend/.env (rotate the client secret in Google "
            "Cloud Console first if it was ever committed to source control)."
        )
    return client_id, client_secret


def get_integration_record(session: Session, user_id: str) -> Optional[EmailIntegration]:
    """Retrieves this user's own EmailIntegration record from the database -
    never another user's, even if one exists."""
    stmt = select(EmailIntegration).where(EmailIntegration.id == user_id)
    return session.exec(stmt).first()


def disconnect_gmail_integration(session: Session, user_id: str) -> bool:
    """Removes this user's own Gmail integration record, if one exists.
    Returns True if a record was actually deleted."""
    record = get_integration_record(session, user_id)
    if not record:
        return False
    session.delete(record)
    session.commit()
    _MEM_CACHE.pop(user_id, None)
    return True


def get_refresh_token(session: Session, user_id: str) -> Optional[str]:
    """
    Returns the configured refresh token for this specific user.
    Prioritizes their own DB record. Only the "demo" user (the fallback
    get_current_user_id returns for unauthenticated requests) falls back to
    the bootstrap GMAIL_REFRESH_TOKEN env var - a real logged-in user who
    hasn't connected their own Gmail must see "not connected", never
    silently inherit the shared demo account's inbox.
    """
    record = get_integration_record(session, user_id)
    if record and record.refresh_token:
        return record.refresh_token
    if user_id == "demo":
        return os.environ.get("GMAIL_REFRESH_TOKEN")
    return None


async def exchange_auth_code_for_tokens(
    session: Session,
    user_id: str,
    code: str,
    redirect_uri: str = "postmessage",
) -> EmailIntegration:
    """
    Exchanges a Google OAuth authorization code for an access token and refresh token,
    then saves the refresh token to the database under this user's own record.
    """
    client_id, client_secret = get_oauth_credentials()
    payload = {
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data=payload)
        if not resp.is_success:
            err_text = resp.text
            logger.error(f"Failed to exchange Google OAuth code: {err_text}")
            raise RuntimeError(f"Google OAuth token exchange failed ({resp.status_code}): {err_text}")

        data = resp.json()
        access_token = data.get("access_token")
        refresh_token = data.get("refresh_token")
        expires_in = data.get("expires_in", 3600)

        if not refresh_token:
            # If Google didn't return a refresh token (e.g. prompt != consent), check if we already have one
            existing = get_integration_record(session, user_id)
            if existing and existing.refresh_token:
                refresh_token = existing.refresh_token
            else:
                raise RuntimeError("Google did not return a refresh_token. Please re-authorize with consent prompt.")

        # Fetch authenticated user profile email
        account_email = None
        try:
            profile_resp = await client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if profile_resp.is_success:
                account_email = profile_resp.json().get("email")
        except Exception as e:
            logger.warning(f"Could not fetch Google profile: {e}")

    expires_at = utc_now() + timedelta(seconds=expires_in - 120)

    # Persist into DB, under this user's own record
    record = get_integration_record(session, user_id)
    if not record:
        record = EmailIntegration(
            id=user_id,
            provider="gmail",
            account_email=account_email,
            refresh_token=refresh_token,
            access_token=access_token,
            access_token_expires_at=expires_at,
            updated_at=utc_now(),
        )
        session.add(record)
    else:
        record.refresh_token = refresh_token
        record.access_token = access_token
        record.access_token_expires_at=expires_at
        if account_email:
            record.account_email = account_email
        record.updated_at = utc_now()
        session.add(record)

    session.commit()
    session.refresh(record)

    _MEM_CACHE[user_id] = {"access_token": access_token, "expires_at": expires_at, "account_email": account_email}

    logger.info(f"Successfully configured Gmail integration for user {user_id} ({account_email or 'account'})")
    return record


async def get_valid_access_token(session: Session, user_id: str) -> str:
    """
    Returns a valid Google OAuth access token for this specific user.
    Uses cached token if still unexpired; otherwise renews via refresh token.
    """
    now = utc_now()

    # 1. Check DB record cache
    record = get_integration_record(session, user_id)
    if record and record.access_token and record.access_token_expires_at:
        exp = to_utc(record.access_token_expires_at)
        # Check with 2-minute buffer
        if exp and exp > now + timedelta(minutes=2):
            return record.access_token

    # 2. Check memory cache fallback
    mem = _MEM_CACHE.get(user_id)
    if mem and mem.get("access_token") and mem.get("expires_at"):
        exp = to_utc(mem["expires_at"])
        if exp and exp > now + timedelta(minutes=2):
            return mem["access_token"]

    # 3. Retrieve refresh token
    refresh_token = get_refresh_token(session, user_id)
    if not refresh_token:
        raise RuntimeError(
            "Gmail is not connected for this account. Connect it from Settings."
        )

    # 4. Exchange refresh token for fresh access token
    client_id, client_secret = get_oauth_credentials()
    payload = {
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data=payload)
        if not resp.is_success:
            err_text = resp.text
            logger.error(f"Failed to refresh Google access token: {err_text}")
            raise RuntimeError(f"Google token refresh failed ({resp.status_code}): {err_text}")

        data = resp.json()
        new_access_token = data.get("access_token")
        expires_in = data.get("expires_in", 3600)

        if not new_access_token:
            raise RuntimeError("Google token response did not include access_token")

        expires_at = now + timedelta(seconds=expires_in - 120)

    # Update in DB
    if record:
        record.access_token = new_access_token
        record.access_token_expires_at = expires_at
        record.updated_at = now
        session.add(record)
        try:
            session.commit()
        except Exception as e:
            logger.warning(f"Could not persist refreshed access token to DB: {e}")
            session.rollback()

    _MEM_CACHE[user_id] = {"access_token": new_access_token, "expires_at": expires_at}

    return new_access_token


# ─── Gmail Payload Parsing Helpers ────────────────────────────────────────────

def decode_base64_url(data_str: str) -> str:
    """Decodes standard Gmail URL-safe base64 string."""
    try:
        padding = "=" * ((4 - len(data_str) % 4) % 4)
        clean = data_str.replace("-", "+").replace("_", "/") + padding
        raw = base64.b64decode(clean)
        return raw.decode("utf-8", errors="replace")
    except Exception:
        return ""


def extract_plain_body(payload: dict) -> str:
    """Recursively walks Gmail MIME tree to extract plain text body."""
    if not payload:
        return ""

    body_data = payload.get("body", {}).get("data")
    if body_data:
        return decode_base64_url(body_data)

    parts = payload.get("parts", [])
    for part in parts:
        if part.get("mimeType") == "text/plain" and part.get("body", {}).get("data"):
            return decode_base64_url(part["body"]["data"])

    # Fallback to HTML if plain text not available
    for part in parts:
        if part.get("mimeType") == "text/html" and part.get("body", {}).get("data"):
            html = decode_base64_url(part["body"]["data"])
            # Simple tag strip
            return re.sub(r"<[^>]+>", " ", html)

    for part in parts:
        nested = extract_plain_body(part)
        if nested:
            return nested

    return ""


def parse_header_value(headers: List[dict], name: str) -> str:
    """Finds a header value case-insensitively."""
    target = name.lower()
    for h in headers:
        if h.get("name", "").lower() == target:
            return h.get("value", "")
    return ""


def parse_from_header(from_raw: str) -> Tuple[str, str]:
    """Parses 'Name <email@domain.com>' into (name, email)."""
    match = re.match(r'^(.*?)\s*<(.+?)>$', from_raw)
    if match:
        name = match.group(1).replace('"', '').strip() or match.group(2)
        email = match.group(2).strip()
        return name, email
    return from_raw, from_raw


def check_for_attachments(payload: dict) -> bool:
    """Recursively checks if any MIME part is an attachment."""
    if not payload:
        return False
    parts = payload.get("parts", [])
    for p in parts:
        if p.get("filename") and len(p.get("filename")) > 0:
            return True
        if check_for_attachments(p):
            return True
    return False


def extract_attachment_refs(payload: dict) -> List[Tuple[str, str]]:
    """Recursively walks the MIME tree and returns [(filename, attachmentId), ...]."""
    refs: List[Tuple[str, str]] = []

    def walk(node: dict):
        if not node:
            return
        filename = node.get("filename")
        attachment_id = node.get("body", {}).get("attachmentId")
        if filename and attachment_id:
            refs.append((filename, attachment_id))
        for part in node.get("parts", []):
            walk(part)

    walk(payload)
    return refs


async def list_message_attachment_names(session: Session, user_id: str, message_id: str) -> List[str]:
    """Lists a message's attachment filenames without downloading their bytes -
    cheap enough to call just to show what's actually attached in the UI."""
    token = await get_valid_access_token(session, user_id)
    async with httpx.AsyncClient(timeout=15.0) as client:
        msg_resp = await _gmail_get(client, f"{GMAIL_API_BASE}/messages/{message_id}?format=full", token)
        if not msg_resp.is_success:
            raise RuntimeError(f"Failed to fetch message {message_id} ({msg_resp.status_code}): {msg_resp.text}")
        payload = msg_resp.json().get("payload", {})
        return [filename for filename, _ in extract_attachment_refs(payload)]


async def fetch_message_attachments(session: Session, user_id: str, message_id: str) -> List[Tuple[str, bytes]]:
    """
    Fetches all attachments for a Gmail message using this user's own
    authorized Gmail connection.
    Returns [(filename, raw_bytes), ...].
    """
    token = await get_valid_access_token(session, user_id)

    async with httpx.AsyncClient(timeout=25.0) as client:
        msg_resp = await _gmail_get(client, f"{GMAIL_API_BASE}/messages/{message_id}?format=full", token)
        if not msg_resp.is_success:
            raise RuntimeError(f"Failed to fetch message {message_id} ({msg_resp.status_code}): {msg_resp.text}")

        payload = msg_resp.json().get("payload", {})
        refs = extract_attachment_refs(payload)
        if not refs:
            return []

        async def fetch_one(filename: str, attachment_id: str) -> Tuple[str, bytes]:
            r = await _gmail_get(client, f"{GMAIL_API_BASE}/messages/{message_id}/attachments/{attachment_id}", token)
            if not r.is_success:
                raise RuntimeError(f"Failed to fetch attachment {filename} ({r.status_code}): {r.text}")
            data_str = r.json().get("data", "")
            return filename, decode_base64_url_bytes(data_str)

        results = await asyncio.gather(*[fetch_one(f, aid) for f, aid in refs])
        return list(results)


def decode_base64_url_bytes(data_str: str) -> bytes:
    """Decodes a Gmail URL-safe base64 string into raw bytes (not text - for
    binary attachments, unlike decode_base64_url which assumes UTF-8 text)."""
    try:
        padding = "=" * ((4 - len(data_str) % 4) % 4)
        clean = data_str.replace("-", "+").replace("_", "/") + padding
        return base64.b64decode(clean)
    except Exception:
        return b""


# ─── Inbox Fetching Engine ───────────────────────────────────────────────────

async def fetch_gmail_inbox_messages(
    session: Session,
    user_id: str,
    page_token: Optional[str] = None,
    max_results: int = 25,
) -> Tuple[List[dict], Optional[str]]:
    """
    Fetches a page of inbox messages using this user's own authorized Gmail
    connection. Returns (parsed_email_dicts, next_page_token).
    """
    token = await get_valid_access_token(session, user_id)

    query_params: Dict[str, Any] = {
        "maxResults": max_results,
        "q": "in:inbox",
    }
    if page_token:
        query_params["pageToken"] = page_token

    async with httpx.AsyncClient(timeout=25.0) as client:
        # 1. Fetch message ID list
        list_resp = await _gmail_get(client, f"{GMAIL_API_BASE}/messages", token, params=query_params)
        if not list_resp.is_success:
            err = list_resp.text
            raise RuntimeError(f"Gmail messages list failed ({list_resp.status_code}): {err}")

        list_data = list_resp.json()
        messages_meta = list_data.get("messages", [])
        next_page = list_data.get("nextPageToken")

        if not messages_meta:
            return [], None

        message_ids = [m["id"] for m in messages_meta]

        # 2. Fetch full message payloads - concurrency and rate-limit
        # retry/backoff both happen inside _gmail_get (shared app-wide, since
        # everyone funnels through the same Gmail account/quota).
        parsed_results: List[dict] = []

        async def fetch_one(msg_id: str) -> Optional[dict]:
            try:
                r = await _gmail_get(client, f"{GMAIL_API_BASE}/messages/{msg_id}?format=full", token)
                if not r.is_success:
                    logger.warning(f"Failed to fetch message {msg_id}: {r.status_code}")
                    return None
                return r.json()
            except Exception as ex:
                logger.warning(f"Error fetching message {msg_id}: {ex}")
                return None

        tasks = [fetch_one(mid) for mid in message_ids]
        raw_messages = await asyncio.gather(*tasks)

        for raw in raw_messages:
            if not raw or not raw.get("payload"):
                continue

            msg_id = raw["id"]
            thread_id = raw.get("threadId", msg_id)
            payload = raw.get("payload", {})
            headers = payload.get("headers", [])

            subject = parse_header_value(headers, "subject") or "(no subject)"
            from_raw = parse_header_value(headers, "from")
            from_name, from_email = parse_from_header(from_raw)
            date_str = parse_header_value(headers, "date")

            # Timestamp parsing
            timestamp = int(raw.get("internalDate", 0))
            if not timestamp and date_str:
                try:
                    from email.utils import parsedate_to_datetime
                    dt = parsedate_to_datetime(date_str)
                    timestamp = int(dt.timestamp() * 1000)
                except Exception:
                    timestamp = int(datetime.now(timezone.utc).timestamp() * 1000)
            elif not timestamp:
                timestamp = int(datetime.now(timezone.utc).timestamp() * 1000)

            snippet = raw.get("snippet", "")
            body = extract_plain_body(payload) or snippet
            has_attachments = check_for_attachments(payload)

            parsed_results.append({
                "id": msg_id,
                "thread_id": thread_id,
                "from_name": from_name,
                "from_email": from_email,
                "subject": subject,
                "snippet": snippet,
                "date_str": date_str,
                "timestamp": timestamp,
                "has_attachments": has_attachments,
                "body": body,
                "body_snippet": body[:1000] if body else snippet[:1000],
            })

    # Update next_page_token on the integration record
    record = get_integration_record(session, user_id)
    if record:
        record.last_sync_at = utc_now()
        record.next_page_token = next_page
        session.add(record)
        try:
            session.commit()
        except Exception:
            session.rollback()

    return parsed_results, next_page
