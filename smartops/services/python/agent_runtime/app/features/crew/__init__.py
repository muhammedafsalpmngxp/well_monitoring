"""Crew Management: which crews are free, busy or idle across the fleet, how crew capacity compares with the delayed
work that needs each crew type, and - for one live well - which crew is on each delayed activity and which free crew
of the right type to approach, with an AI brief that narrates the plan. Ported from the Crew Suggestion AI.
Mounted at /api/agent-runtime/features/crew (see app/features/README.md).

  api.py       the endpoints (/overview, /well, /brief) and their error mapping
  queries.py   runs the tenant's verified crew queries (request.queries), column contract, short result cache
  engine.py    the deterministic crew plan: availability, ranking, actions, capacity vs demand (no AI)
  brief.py     the AI brief: evidence, the model call, and the check of every crew id / code it names
  prompts.py   the crew.* prompt keys
  settings.py  the crew settings every request carries (no defaults here)
"""
