"""Data Anomaly (Data Quality & Anomaly Sentinel): plain-English data-quality rules compiled by AI into verified SQL
probes, scored runs with an AI summary and Word / Excel reports, and AI-proposed new rules (Discover).

Three stages, each a separate graph, all stateless (app/features/README.md):

  COMPILE   is the SQL right?          grounding -> sql_author -> validator -> executor -> sanity_gate -> verifier
                                       -> catalog_writer, per rule; family expansion, cloning and a smoke test
  RUN       what does the data say?    catalog_loader -> probe_runner -> scorer -> summarizer -> report_builder
  DISCOVER  what is nobody checking?   context_builder -> scout -> evidence_check -> dedup_filter -> proposal_writer

Rules, the compiled catalog and decided proposals come IN with each request (the Tenant API stores them); results go
OUT in the response. Prompt texts, settings and the readable tables come from the tenant too. Only engine logic is
here. Introspection caches live under app.askdata.settings.CACHE_ROOT / "features" / "anomaly" / <db + scope key>.
"""

FEATURE = "anomaly"
TITLE = "Data Anomaly"
