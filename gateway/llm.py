"""Local LLM layer via Ollama (http://127.0.0.1:11434). Used only for what rules cannot do:
names, organisations and addresses in free text (English / Tagalog / Taglish), and column classification.
"""
import json
import os
import re
import time
import urllib.request

OLLAMA = os.environ.get("PG_OLLAMA", "http://127.0.0.1:11434")
MODEL = os.environ.get("PG_MODEL", "qwen2.5:3b")
CHUNK_CHARS = 1800

_status_cache = {"at": 0.0, "value": None}

_ENTITY_SYSTEM = """You are a data-loss-prevention detector for a Philippine company. The text may be English, Tagalog or Taglish.
List each distinct span, once, that identifies a specific real person, a specific organisation / company / client, or a physical address.
Also list health information about a person: diagnoses, medical conditions, medications, test results (type HEALTH).
Include every personal name, also when it is a nickname, written in lowercase, or stands alone in a list or table row.
Do NOT list: generic words (customer, client, boss, bank), amounts, dates, public products (ChatGPT, Excel), government agencies, or placeholders like [PERSON_1] and [X].
Copy each span exactly as it appears in the text.
Reply with JSON only: {"entities":[{"text":"...","type":"PERSON"}]} where type is PERSON, ORG, ADDRESS or HEALTH. If there are none reply {"entities":[]}."""

# Worked examples, given to the model as earlier turns of the conversation. Fictional names.
_ENTITY_SHOTS = [
    ("pa-draft ng email kay jun reyes ng Solidbuild Trading, taga 12 Rizal St, Pasig, overdue na 30 days",
     [("jun reyes", "PERSON"), ("Solidbuild Trading", "ORG"), ("12 Rizal St, Pasig", "ADDRESS")]),
    ("Dear Liza Ramos,\nYour loan is overdue. Please call Mr. Dizon at our Makati branch.",
     [("Liza Ramos", "PERSON"), ("Dizon", "PERSON")]),
    ("Explain the difference between gross and net income in simple terms.", []),
    ("Ana Lim 45000 32 Promised to pay\nrodel pascual 120000 61 For legal endorsement\nReferred by [X]",
     [("Ana Lim", "PERSON"), ("rodel pascual", "PERSON")]),
    ("si tatay na-diagnose ng type 2 diabetes last year, ano dapat iwasan?", [("type 2 diabetes", "HEALTH")]),
]


def _entity_messages(chunk: str) -> list[dict]:
    messages = [{"role": "system", "content": _ENTITY_SYSTEM}]
    for text, entities in _ENTITY_SHOTS:
        messages.append({"role": "user", "content": "Text:\n" + text})
        messages.append({"role": "assistant", "content": json.dumps({"entities": [{"text": t, "type": ty} for t, ty in entities]})})
    messages.append({"role": "user", "content": "Text:\n" + chunk.strip()})
    return messages


_COLUMN_SYSTEM = """You classify spreadsheet columns for a data-loss-prevention tool in the Philippines.
For each column you get its header and sample values. Decide whether the values identify a specific person, organisation or address.
Reply with JSON only, mapping each header to one of: PERSON, ORG, ADDRESS, NONE.
Example reply: {"Borrower":"PERSON","Branch":"NONE","Tirahan":"ADDRESS"}"""


def _get(path: str, timeout: float):
    with urllib.request.urlopen(OLLAMA + path, timeout=timeout) as r:
        return json.loads(r.read())


def status() -> dict:
    now = time.time()
    if _status_cache["value"] and now - _status_cache["at"] < 5:
        return dict(_status_cache["value"])
    try:
        names = [m.get("name", "") for m in _get("/api/tags", 0.6).get("models", [])]
        ok = any(n == MODEL or n.split(":")[0] == MODEL for n in names)
        value = {"available": ok, "model": MODEL,
                 "reason": "" if ok else f"model {MODEL} is not pulled (run: ollama pull {MODEL})"}
    except Exception:
        value = {"available": False, "model": MODEL, "reason": "Ollama is not running on this machine"}
    _status_cache.update(at=now, value=value)
    return dict(value)


def _chat(system: str, user: str, timeout: float = 120, messages: list | None = None) -> dict:
    body = json.dumps({
        "model": MODEL, "stream": False, "format": "json", "keep_alive": "30m",
        "options": {"temperature": 0, "num_ctx": 4096, "num_predict": 500},
        "messages": messages or [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }).encode()
    req = urllib.request.Request(OLLAMA + "/api/chat", data=body, headers={"Content-Type": "application/json"})
    last = None
    for _attempt in range(2):          # one retry: a small model occasionally stalls or returns nothing
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                content = json.loads(r.read())["message"]["content"]
            break
        except Exception as e:
            last = e
    else:
        raise last
    try:
        data = json.loads(content)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        # The answer was cut off or malformed: keep every complete entity it did produce.
        pairs = re.findall(r'"text"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"type"\s*:\s*"(\w+)"', content)
        return {"entities": [{"text": t, "type": ty} for t, ty in pairs]}


def _chunks(text: str) -> list[str]:
    out, cur = [], ""
    for para in text.split("\n"):
        while len(para) > CHUNK_CHARS:
            out.append(para[:CHUNK_CHARS])
            para = para[CHUNK_CHARS:]
        if len(cur) + len(para) + 1 > CHUNK_CHARS and cur:
            out.append(cur)
            cur = ""
        cur += para + "\n"
    if cur.strip():
        out.append(cur)
    return out


_WORDS = re.compile(r"[A-Za-z\u00c0-\u024f]{3,}")


def _worth_reading(text: str) -> str:
    """Cut the text down to what the model needs: drop lines with no words (numbers, rules, blanks) and lines that
    repeat an earlier line apart from their digits (table rows, invoice lines, log lines)."""
    seen, keep = set(), []
    for line in text.splitlines():
        if len(_WORDS.findall(line)) < 2:
            continue
        key = re.sub(r"\d+", "0", " ".join(line.split()).lower())
        if key not in seen:
            seen.add(key)
            keep.append(line)
    return "\n".join(keep)


def find_entities(text: str, max_chunks: int = 40) -> tuple[list[tuple[str, str]], float]:
    """Returns (entities, coverage) where coverage is the fraction of the text the model actually read."""
    # Placeholders already in the text (from an earlier pass) are hidden, so the model cannot mistake them for data.
    text = re.sub(r"\[[A-Z_]+_\d+\]|\[SECRET_REMOVED\]", "[X]", text)
    chunks = _chunks(_worth_reading(text))
    if not chunks:
        return [], 1.0                     # nothing left for the model to read: fully covered
    used = chunks[:max_chunks]
    entities: list[tuple[str, str]] = []
    for chunk in used:
        for e in _chat("", "", messages=_entity_messages(chunk)).get("entities", []) or []:
            if isinstance(e, dict) and isinstance(e.get("text"), str):
                entities.append((e["text"], str(e.get("type", "PERSON")).upper()))
    covered = sum(len(c) for c in used) / max(1, sum(len(c) for c in chunks))
    return entities, round(covered, 3)


def classify_columns(columns: dict[str, list[str]]) -> dict[str, str]:
    prompt = "\n".join(f"Header: {h!r} | samples: {s!r}" for h, s in columns.items())
    data = _chat(_COLUMN_SYSTEM, prompt)
    return {h: str(data.get(h, "NONE")).upper() for h in columns}
