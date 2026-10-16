"""Ping every SmartOps service and print a status report."""
import sys
import httpx

TARGETS = [
    ("gateway",        "http://localhost:7000/health"),
    ("auth",           "http://localhost:7001/health"),
    ("wells",          "http://localhost:7002/health"),
    ("finance",        "http://localhost:7003/health"),
    ("workflow",       "http://localhost:7004/health"),
    ("reports",        "http://localhost:7005/health"),
    ("integrations",   "http://localhost:7006/health"),
    ("jenny",          "http://localhost:8001/health"),
    ("predictive",     "http://localhost:8002/health"),
    ("anomaly",        "http://localhost:8003/health"),
    ("crew-optimizer", "http://localhost:8004/health"),
    ("vision",         "http://localhost:8005/health"),
]

ok = bad = 0
for name, url in TARGETS:
    try:
        r = httpx.get(url, timeout=3.0)
        if r.status_code == 200:
            print(f"  [OK]   {name:16s} {url}")
            ok += 1
        else:
            print(f"  [FAIL] {name:16s} HTTP {r.status_code}  {url}")
            bad += 1
    except Exception as e:
        print(f"  [DOWN] {name:16s} {e}  {url}")
        bad += 1

print(f"\n{ok}/{len(TARGETS)} services healthy.")
sys.exit(0 if bad == 0 else 1)
