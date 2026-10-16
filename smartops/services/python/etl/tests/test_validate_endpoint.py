"""
Unit tests for the POST /validate/{tenant_source_id} endpoint (validate_config).
"""
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[5] / "shared" / "python"))

from fastapi.testclient import TestClient

from app.main import app, verify_api_key


# Override auth for tests
app.dependency_overrides[verify_api_key] = lambda: None


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def mock_engine():
    """Mock the ETLEngine created during FastAPI startup so tests don't hit real services."""
    engine_mock = MagicMock()
    with patch("app.main.ControlPlaneClient", MagicMock()), patch(
        "app.main.ETLEngine", return_value=engine_mock
    ):
        yield engine_mock


class TestValidateConfig:
    def test_passes_when_no_errors(self, client, mock_engine):
        mock_engine.preflight_check.return_value = []

        resp = client.post("/validate/1")

        assert resp.status_code == 200
        body = resp.json()
        assert body["tenant_source_id"] == 1
        assert body["passed"] is True
        assert body["errors"] == 0
        assert body["warnings"] == 0
        assert body["issues"] == []

    def test_fails_when_errors_present(self, client, mock_engine):
        mock_engine.preflight_check.return_value = [
            {"level": "error", "check": "tenant_source", "detail": "not found"},
        ]

        resp = client.post("/validate/99")

        assert resp.status_code == 200
        body = resp.json()
        assert body["passed"] is False
        assert body["errors"] == 1
        assert body["warnings"] == 0
        assert body["issues"][0]["level"] == "error"
        assert body["issues"][0]["check"] == "tenant_source"

    def test_passes_with_warnings_only(self, client, mock_engine):
        mock_engine.preflight_check.return_value = [
            {"level": "warning", "check": "tenant_db", "detail": "pyodbc not installed"},
        ]

        resp = client.post("/validate/5")

        assert resp.status_code == 200
        body = resp.json()
        assert body["passed"] is True
        assert body["errors"] == 0
        assert body["warnings"] == 1

    def test_mixed_errors_and_warnings(self, client, mock_engine):
        mock_engine.preflight_check.return_value = [
            {"level": "error", "check": "source_field", "detail": "'col_x' not in source"},
            {"level": "warning", "check": "source_db", "detail": "slow connection"},
            {"level": "error", "check": "column_name", "detail": "'col_y' not in table"},
        ]

        resp = client.post("/validate/10")

        assert resp.status_code == 200
        body = resp.json()
        assert body["passed"] is False
        assert body["errors"] == 2
        assert body["warnings"] == 1
        assert len(body["issues"]) == 3

    def test_calls_preflight_with_correct_id(self, client, mock_engine):
        mock_engine.preflight_check.return_value = []

        client.post("/validate/42")

        mock_engine.preflight_check.assert_called_once_with(42)

    def test_invalid_tenant_source_id_type(self, client):
        resp = client.post("/validate/not-a-number")
        assert resp.status_code == 422

    def test_invalid_source_not_found(self, client, mock_engine):
        """Tenant source does not exist in control plane."""
        mock_engine.preflight_check.return_value = [
            {"level": "error", "check": "tenant_source", "detail": "tenant_source_id=999 not found"},
        ]

        resp = client.post("/validate/999")

        assert resp.status_code == 200
        body = resp.json()
        assert body["passed"] is False
        assert body["errors"] == 1
        assert body["issues"][0]["check"] == "tenant_source"
        assert "not found" in body["issues"][0]["detail"]

    def test_invalid_field_mapping_missing(self, client, mock_engine):
        """No active field mappings configured for the tenant source."""
        mock_engine.preflight_check.return_value = [
            {"level": "error", "check": "field_mappings", "detail": "No active FieldMappings for tenant_source_id=5"},
        ]

        resp = client.post("/validate/5")

        assert resp.status_code == 200
        body = resp.json()
        assert body["passed"] is False
        assert body["errors"] == 1
        assert body["issues"][0]["check"] == "field_mappings"
        assert "No active FieldMappings" in body["issues"][0]["detail"]

    def test_invalid_canonical_field(self, client, mock_engine):
        """Canonical field referenced by mapping is inactive or missing."""
        mock_engine.preflight_check.return_value = [
            {"level": "error", "check": "canonical_field", "detail": "canonical_field_id=77 not found or inactive"},
        ]

        resp = client.post("/validate/3")

        assert resp.status_code == 200
        body = resp.json()
        assert body["passed"] is False
        assert body["errors"] == 1
        assert body["issues"][0]["check"] == "canonical_field"
        assert "not found or inactive" in body["issues"][0]["detail"]

    def test_invalid_entity_column_not_in_target(self, client, mock_engine):
        """Canonical field maps to a column that doesn't exist in the target entity table."""
        mock_engine.preflight_check.return_value = [
            {"level": "error", "check": "column_name", "detail": "'well_status' not in [core].[Well]"},
        ]

        resp = client.post("/validate/5")

        assert resp.status_code == 200
        body = resp.json()
        assert body["passed"] is False
        assert body["errors"] == 1
        assert body["issues"][0]["check"] == "column_name"
        assert "not in" in body["issues"][0]["detail"]

    def test_source_field_not_in_source_table(self, client, mock_engine):
        """Source field referenced in mapping doesn't exist in the source database."""
        mock_engine.preflight_check.return_value = [
            {"level": "error", "check": "source_field", "detail": "'WellStatus_OLD' not in source table"},
        ]

        resp = client.post("/validate/5")

        assert resp.status_code == 200
        body = resp.json()
        assert body["passed"] is False
        assert body["errors"] == 1
        assert body["issues"][0]["check"] == "source_field"
        assert "not in source" in body["issues"][0]["detail"]

    def test_data_changed_multiple_schema_drift_errors(self, client, mock_engine):
        """Schema drift: source and target columns changed after mappings were configured."""
        mock_engine.preflight_check.return_value = [
            {"level": "error", "check": "source_field", "detail": "'OldColumn' not in source table"},
            {"level": "error", "check": "column_name", "detail": "'removed_col' not in [core].[Well]"},
            {"level": "warning", "check": "source_db", "detail": "Cannot connect to source DB: timeout"},
        ]

        resp = client.post("/validate/7")

        assert resp.status_code == 200
        body = resp.json()
        assert body["passed"] is False
        assert body["errors"] == 2
        assert body["warnings"] == 1
        checks = [i["check"] for i in body["issues"]]
        assert "source_field" in checks
        assert "column_name" in checks
        assert "source_db" in checks
