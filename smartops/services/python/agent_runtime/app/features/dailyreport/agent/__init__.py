"""The agentic layer: agents plan, call read-only tools, write and verify.

    tools.py     the only way an agent reaches data: fixed, deterministic service calls
    verifier.py  the deterministic number-and-wording check
    graph.py     the LangGraph plan -> act -> write -> verify graph (built per request)
    service.py   runs the graph and shapes the answer (brief / ask)

SQL and Python calculate every figure; the agents choose tools and write prose about their results.
"""
