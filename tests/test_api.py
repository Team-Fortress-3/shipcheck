import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# Ensure repo root is on sys.path
repo_root = Path(__file__).resolve().parent.parent
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, create_engine, Session
from fastapi.testclient import TestClient
from api.db import get_session
from api.main import app
from core.classifier import ClassificationResult
from core.compare_ai import ComparisonResult, FieldComparison


class TestFastAPIEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
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

    def test_root_endpoint(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "online")
        self.assertIn("docs", data)

    def test_health_endpoint(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "healthy")
        self.assertIn("providers", data)

    def test_classify_endpoint_mock(self):
        with patch("api.routes.classify._classifier.classify") as mock_classify:
            mock_classify.return_value = ClassificationResult(
                category="BL_COMPARISON",
                confidence=0.98,
                probabilities={"BL_COMPARISON": 0.98, "GENERAL": 0.02},
            )

            payload = {
                "subject": "Attached SI and draft BL for checking",
                "snippet": "Please compare OC 5ALT-01226",
                "body": "Hi, please check attached SI vs draft BL.",
            }

            response = self.client.post("/api/classify", json=payload)
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["type"], "Document Comparison")
            self.assertEqual(data["confidence"], 0.98)
            self.assertIsNotNone(data["reasoning"])

    def test_classify_endpoint_fallback(self):
        # When classifier raises ValueError (e.g. no API key configured)
        with patch("api.routes.classify._classifier.classify", side_effect=ValueError("API key missing")):
            payload = {
                "subject": "Invoice dispute regarding demurrage",
                "snippet": "Incorrect amount billed",
                "body": "Please revise the invoice immediately.",
            }
            response = self.client.post("/api/classify", json=payload)
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["type"], "Invoice Query")
            self.assertIn("Heuristic fallback", data["reasoning"])

    def test_compare_text_endpoint(self):
        mock_si = {
            "shipper": "Alpha Corp",
            "consignee": "Beta LLC",
            "notify_party": "Gamma Inc",
            "port_of_loading": "SINGAPORE",
            "port_of_discharge": "ROTTERDAM",
            "container_count": "2 x 40'HC",
            "gross_weight_kg": 25000,
        }
        mock_bl = dict(mock_si)
        mock_bl["gross_weight_kg"] = 26000  # mismatch

        with patch("api.routes.compare.extract_fields", side_effect=[mock_si, mock_bl]):
            payload = {
                "si_text": "Sample SI text",
                "bl_text": "Sample BL text",
            }
            response = self.client.post("/api/compare/text", json=payload)
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["status"], "Mismatch")
            self.assertEqual(len(data["fields"]), 7)

            # verify Gross Weight field
            gw_field = next(f for f in data["fields"] if "Gross Weight" in f["field"])
            self.assertFalse(gw_field["match"])
            self.assertEqual(gw_field["si"], "25000")
            self.assertEqual(gw_field["bl"], "26000")

    def test_compare_files_endpoint(self):
        mock_si = {
            "shipper": "Alpha Corp",
            "consignee": "Beta LLC",
            "notify_party": "Gamma Inc",
            "port_of_loading": "SINGAPORE",
            "port_of_discharge": "ROTTERDAM",
            "container_count": "2 x 40'HC",
            "gross_weight_kg": 25000,
        }
        mock_bl = dict(mock_si)

        with patch("api.routes.compare._extractor.extract_from_bytes", side_effect=[(mock_si, "text"), (mock_bl, "text")]):
            files = {
                "si_file": ("si.txt", b"SI content", "text/plain"),
                "bl_file": ("bl.txt", b"BL content", "text/plain"),
            }
            response = self.client.post("/api/compare", files=files)
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["status"], "Match")
            self.assertTrue(all(f["match"] for f in data["fields"]))


if __name__ == "__main__":
    unittest.main()

