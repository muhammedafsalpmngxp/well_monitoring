"""Slippage: wells that missed contractual milestones, task delay per well, crew availability, and the AI recovery
advisor (well and task level). Mounted at /api/agent-runtime/features/slippage (see app/features/README.md).

  api.py       the endpoints (/query, /advise-well, /advise-task) and their error mapping
  queries.py   runs the tenant's four verified queries (request.queries) with the column-contract check
  advisor.py   evidence assembly, the model call, reply normalisation and the fingerprint cache
  prompts.py   the slippage.* prompt keys and how the advisor messages are filled
  settings.py  the slippage settings every request carries (no defaults here)
"""
