"""
Unit and integration tests for SQLite persistence (SQLModel) in ShipCheck FastAPI service.
Verifies table creation, idempotency, caching, comparison history, and review workflows.
"""
import sys
import unittest
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

# Ensure repo root is on sys.path
repo_root = Path(__file__).resolve().parent.parent
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, create_engine, Session, select
from fastapi.testclient import TestClient

from api.db import get_session
from api.models import EmailRecord, ComparisonRecord
from api.main import app
from core.classifier import ClassificationResult


class TestSQLitePersistence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Use an in-memory SQLite database with StaticPool for test isolation
        cls.test_engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(cls.test_engine)

        def override_get_session():
            with Session(cls.test_engine) as session:
                yield session

        app.dependency_overrides[get_session] = override_get_session
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()

    def setUp(self):
        # Clean tables before each test
        with Session(self.test_engine) as session:
            for rec in session.exec(select(EmailRecord)).all():
                session.delete(rec)
            for comp in session.exec(select(ComparisonRecord)).all():
                session.delete(comp)
            session.commit()

    def test_database_table_initialization(self):
        """Verifies tables exist and can accept queries without error."""
        with Session(self.test_engine) as session:
            emails = session.exec(select(EmailRecord)).all()
            comparisons = session.exec(select(ComparisonRecord)).all()
            self.assertEqual(len(emails), 0)
            self.assertEqual(len(comparisons), 0)

    def test_idempotent_email_creation_and_batch_cache(self):
        """
        Verifies:
        1. Batch sync correctly classifies and saves new emails.
        2. Second call with existing email IDs does NOT re-classify (idempotent, 0 LLM cost).
        """
        batch_payload = [
            {
                "id": "msg_001",
                "thread_id": "thread_001",
                "from_name": "Ops Dept",
                "from_email": "ops@example.com",
                "subject": "Please check attached SI vs draft BL",
                "snippet": "Attached documents for checking",
                "date_str": "10:30 AM",
                "timestamp": 1726900000000,
                "has_attachments": True,
                "body": "Hi team, please find attached SI and BL for comparison.",
            },
            {
                "id": "msg_002",
                "thread_id": "thread_002",
                "from_name": "Billing",
                "from_email": "billing@example.com",
                "subject": "Discrepancy on invoice #1042",
                "snippet": "Incorrect charge applied",
                "date_str": "09:15 AM",
                "timestamp": 1726895000000,
                "has_attachments": False,
                "body": "Please explain the detention charge on invoice #1042.",
            },
        ]

        with patch("api.routes.emails._classifier.classify") as mock_classify:
            mock_classify.side_effect = [
                ClassificationResult(category="BL_COMPARISON", confidence=0.97),
                ClassificationResult(category="INVOICE_QUERY", confidence=0.99),
            ]

            # 1. First sync: should classify both
            resp1 = self.client.post("/api/emails/batch", json=batch_payload)
            self.assertEqual(resp1.status_code, 200)
            data1 = resp1.json()
            self.assertEqual(len(data1), 2)
            self.assertEqual(data1[0]["id"], "msg_001")
            self.assertEqual(data1[0]["email_type"], "Document Comparison")
            self.assertEqual(data1[1]["id"], "msg_002")
            self.assertEqual(data1[1]["email_type"], "Invoice Query")
            self.assertEqual(mock_classify.call_count, 2)

            # 2. Second sync with same emails: should return cached records, 0 new classify calls!
            resp2 = self.client.post("/api/emails/batch", json=batch_payload)
            self.assertEqual(resp2.status_code, 200)
            data2 = resp2.json()
            self.assertEqual(len(data2), 2)
            # Call count should STILL be 2 (no redundant LLM calls)
            self.assertEqual(mock_classify.call_count, 2)

    def test_batch_sync_user_id_transitions_and_claiming(self):
        """
        Verifies:
        1. An existing unassigned (user_id=None) or demo record is NOT re-classified.
        2. Authenticated user claims the previously unassigned record.
        """
        # Pre-seed an unassigned record
        with Session(self.test_engine) as session:
            session.add(EmailRecord(
                id="msg_claim_01",
                user_id=None,
                thread_id="th_claim",
                from_name="Shipper",
                from_email="shipper@example.com",
                subject="Existing order check",
                snippet="Compare SI",
                date_str="Yesterday",
                timestamp=1726800000000,
                email_type="Document Comparison",
                status="New",
            ))
            session.commit()

        batch_payload = [{
            "id": "msg_claim_01",
            "thread_id": "th_claim",
            "from_name": "Shipper",
            "from_email": "shipper@example.com",
            "subject": "Existing order check",
            "snippet": "Compare SI",
            "date_str": "Yesterday",
            "timestamp": 1726800000000,
            "has_attachments": True,
            "user_id": "user-uuid-999",
        }]

        with patch("api.routes.emails._classifier.classify") as mock_classify:
            # Sync with authenticated user ID
            resp = self.client.post("/api/emails/batch", json=batch_payload)
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(len(data), 1)
            self.assertEqual(data[0]["id"], "msg_claim_01")
            self.assertEqual(data[0]["user_id"], "user-uuid-999")
            # Must not reclassify!
            self.assertEqual(mock_classify.call_count, 0)

        # Verify DB persistence of claimed user_id
        with Session(self.test_engine) as session:
            db_rec = session.get(EmailRecord, "msg_claim_01")
            self.assertIsNotNone(db_rec)
            self.assertEqual(db_rec.user_id, "user-uuid-999")

    def test_get_emails_pagination_and_filtering(self):
        """Verifies GET /api/emails respects filters and timestamp ordering."""
        with Session(self.test_engine) as session:
            session.add_all([
                EmailRecord(
                    id="e1", thread_id="t1", from_name="A", from_email="a@test.com",
                    subject="Sub 1", snippet="Snip 1", date_str="Today", timestamp=100,
                    email_type="Document Comparison", status="New"
                ),
                EmailRecord(
                    id="e2", thread_id="t2", from_name="B", from_email="b@test.com",
                    subject="Sub 2", snippet="Snip 2", date_str="Today", timestamp=200,
                    email_type="General", status="Classified"
                ),
                EmailRecord(
                    id="e3", thread_id="t3", from_name="C", from_email="c@test.com",
                    subject="Sub 3", snippet="Snip 3", date_str="Today", timestamp=300,
                    email_type="Document Comparison", status="Match"
                ),
                EmailRecord(
                    id="e_auth", thread_id="t4", from_name="D", from_email="d@test.com",
                    subject="Sub 4", snippet="Snip 4", date_str="Today", timestamp=400,
                    email_type="General", status="Classified", user_id="auth-uuid-777"
                ),
            ])
            session.commit()

        # Check default query (demo user gets demo + None records, ordered DESC by timestamp)
        res = self.client.get("/api/emails")
        self.assertEqual(res.status_code, 200)
        items = res.json()
        self.assertEqual(len(items), 3)
        self.assertEqual([i["id"] for i in items], ["e3", "e2", "e1"])

        # Authenticated query with user_id header gets only auth-uuid-777
        res_auth = self.client.get(
            "/api/emails",
            headers={"Authorization": "Bearer fake_token"}
        )
        # Mocking auth decode for a specific UUID
        with patch("jwt.decode", return_value={"sub": "auth-uuid-777"}):
            res_auth = self.client.get(
                "/api/emails",
                headers={"Authorization": "Bearer valid_token"}
            )
            self.assertEqual(res_auth.status_code, 200)
            items_auth = res_auth.json()
            self.assertEqual(len(items_auth), 1)
            self.assertEqual(items_auth[0]["id"], "e_auth")

        # Filter by email_type
        res_filter = self.client.get("/api/emails?email_type=Document Comparison")
        self.assertEqual(res_filter.status_code, 200)
        self.assertEqual(len(res_filter.json()), 2)

        # Filter by status
        res_status = self.client.get("/api/emails?status=Match")
        self.assertEqual(res_status.status_code, 200)
        self.assertEqual(len(res_status.json()), 1)
        self.assertEqual(res_status.json()[0]["id"], "e3")

    def test_saving_and_retrieving_comparison_record_with_json_fields(self):
        """Verifies document comparison results are saved to ComparisonRecord with JSON fields."""
        # 1. Create a linked email first
        with Session(self.test_engine) as session:
            session.add(EmailRecord(
                id="email_target", thread_id="th1", from_name="Logistics", from_email="log@ship.com",
                subject="Compare order 123", snippet="Check files", date_str="Today", timestamp=500,
                email_type="Document Comparison", status="New"
            ))
            session.commit()

        mock_si = {
            "shipper": "Alpha Corp", "consignee": "Beta LLC", "notify_party": "Gamma Inc",
            "port_of_loading": "SINGAPORE", "port_of_discharge": "ROTTERDAM",
            "container_count": "1 x 40'HC", "gross_weight_kg": 20000,
        }
        mock_bl = dict(mock_si)
        mock_bl["gross_weight_kg"] = 21000  # Mismatch

        with patch("api.routes.compare._extractor.extract_from_bytes", side_effect=[(mock_si, "text"), (mock_bl, "text")]):
            files = {
                "si_file": ("si.pdf", b"SI dummy bytes", "application/pdf"),
                "bl_file": ("bl.pdf", b"BL dummy bytes", "application/pdf"),
            }
            data = {"email_id": "email_target"}

            response = self.client.post("/api/compare", files=files, data=data)
            self.assertEqual(response.status_code, 200)
            res_json = response.json()
            self.assertEqual(res_json["status"], "Mismatch")
            self.assertIsNotNone(res_json["comparison_id"])
            comp_id = res_json["comparison_id"]

        # 2. Verify linked EmailRecord status was updated to 'Mismatch'
        with Session(self.test_engine) as session:
            email_updated = session.get(EmailRecord, "email_target")
            self.assertIsNotNone(email_updated)
            self.assertEqual(email_updated.status, "Mismatch")

        # 3. Retrieve comparison from GET /api/comparisons/{id}
        comp_resp = self.client.get(f"/api/comparisons/{comp_id}")
        self.assertEqual(comp_resp.status_code, 200)
        comp_data = comp_resp.json()
        self.assertEqual(comp_data["id"], comp_id)
        self.assertEqual(comp_data["email_id"], "email_target")
        self.assertEqual(comp_data["status"], "Mismatch")
        self.assertEqual(len(comp_data["fields"]), 7)
        self.assertFalse(comp_data["reviewed"])

        # Check fields deserialization
        weight_field = next(f for f in comp_data["fields"] if "Gross Weight" in f["field"])
        self.assertFalse(weight_field["match"])
        self.assertEqual(weight_field["si"], "20000")
        self.assertEqual(weight_field["bl"], "21000")

        # 4. Mark comparison as reviewed
        review_resp = self.client.patch(
            f"/api/comparisons/{comp_id}/review",
            json={"reviewed": True, "reviewed_by": "Senior Officer"}
        )
        self.assertEqual(review_resp.status_code, 200)
        review_data = review_resp.json()
        self.assertTrue(review_data["reviewed"])
        self.assertEqual(review_data["reviewed_by"], "Senior Officer")


if __name__ == "__main__":
    unittest.main()
