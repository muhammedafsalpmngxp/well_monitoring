import os

import pytest

# Column profiles build in the background from a real database; tests have none.
os.environ.setdefault("ASKDATA_PROFILES", "off")

from app.models import ResumeRequest, RunRequest
from tests.seeded_prompts import runtime_texts


@pytest.fixture
def seeded_prompts():
    """Requests a test builds without `prompts` get the seeded ones, as the Tenant API sends them with every call."""
    models = (RunRequest, ResumeRequest)
    saved = [m.model_fields["prompts"].default for m in models]
    for m in models:
        m.model_fields["prompts"].default = runtime_texts()
        m.model_rebuild(force=True)
    yield
    for m, default in zip(models, saved):
        m.model_fields["prompts"].default = default
        m.model_rebuild(force=True)
