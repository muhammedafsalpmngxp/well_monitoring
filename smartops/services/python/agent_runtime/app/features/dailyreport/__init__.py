"""Daily Report (Daily Morning Brief, agentic edition): one report date's per-well task validation, milestones, AI
briefs (day / well / task) with a number-checking verifier, "ask the agent" and the Excel export.

Engine code only. The verified SQL (seven capabilities), every text a model reads, and every limit, threshold and
vocabulary arrive with each request (see app/features/README.md):

    api.py          the endpoints (mounted at /api/agent-runtime/features/dailyreport)
    context.py      ReportContext: one request's settings, prompt texts, data source and services
    settings.py     DailyReportSettings: request.settings, every key required
    texts.py        the dailyreport.* prompt texts (templates, 'name: text' line lists, tool descriptions)
    data.py         the query layer: request.queries by capability, guarded, cached by content hash
    models.py       domain objects;  schemas.py  the response shapes
    validation.py   classification of one daily row (quantity, mapping, crew match, dates, data quality)
    daily.py / grouping.py / evidence.py / well_activity.py / milestones.py / crew.py / scope.py / export.py
    agent/          tools, deterministic verifier, the plan -> act -> write -> verify graph, the brief / ask service
"""
