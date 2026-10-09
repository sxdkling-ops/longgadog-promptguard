"""Measure recall / precision / latency of the detector on eval/dataset.jsonl.

  python eval/run_eval.py          rules + client list only
  python eval/run_eval.py --llm    add the local LLM layer (needs Ollama running)

Matching is by value: a label counts as found when a finding's text contains it or is contained by it.
The dataset is synthetic (no real people or accounts). Report the hardware and model next to any number.
"""
import json
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "gateway"))

import detect  # noqa: E402
import llm  # noqa: E402
import store  # noqa: E402

use_llm = "--llm" in sys.argv
verbose = "-v" in sys.argv
if use_llm and not llm.status()["available"]:
    sys.exit("Local LLM unavailable: " + llm.status()["reason"])

clients = store.clients()
rows = [json.loads(ln) for ln in (ROOT / "eval" / "dataset.jsonl").read_text(encoding="utf-8").splitlines() if ln.strip()]


def overlaps(a: str, b: str) -> bool:
    a, b = detect.norm(a), detect.norm(b)
    return a in b or b in a


groups = {"structured": [0, 0, 0], "contextual": [0, 0, 0]}  # tp, fn, fp
lat_rules, lat_llm, misses, false_pos = [], [], [], []

for row in rows:
    text = row["text"]
    t0 = time.perf_counter()
    found = detect.scan_rules(text, clients)
    lat_rules.append((time.perf_counter() - t0) * 1000)
    if use_llm:
        t1 = time.perf_counter()
        ents, _ = llm.find_entities(text)
        found = detect.merge_llm(text, found, ents)
        lat_llm.append((time.perf_counter() - t1) * 1000)

    for etype, value in row["entities"]:
        g = "contextual" if etype in detect.CONTEXTUAL else "structured"
        if any(overlaps(f.value, value) for f in found):
            groups[g][0] += 1
        else:
            groups[g][1] += 1
            misses.append((etype, value))
    for f in found:
        if not any(overlaps(f.value, v) for _, v in row["entities"]):
            g = "contextual" if f.type in detect.CONTEXTUAL else "structured"
            groups[g][2] += 1
            false_pos.append((f.type, f.value, f.layer))

print(f"Prompts: {len(rows)}   layers: rules + client list" + (f" + local LLM ({llm.MODEL})" if use_llm else ""))
for name, (tp, fn, fp) in groups.items():
    recall = tp / (tp + fn) if tp + fn else 1
    precision = tp / (tp + fp) if tp + fp else 1
    print(f"  {name:<11} recall {recall:6.1%} ({tp}/{tp + fn})   precision {precision:6.1%}   false positives {fp}")
print(f"  rules latency  median {statistics.median(lat_rules):.2f} ms   max {max(lat_rules):.2f} ms")
if lat_llm:
    print(f"  LLM latency    median {statistics.median(lat_llm):.0f} ms   max {max(lat_llm):.0f} ms")
if verbose or misses:
    print("  missed:", misses)
if verbose or false_pos:
    print("  false positives:", false_pos)
