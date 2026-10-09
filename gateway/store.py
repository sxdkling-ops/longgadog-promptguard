"""Placeholder numbering + SQLite audit log.

The audit log stores categories and counts only. Nothing else is kept: a session only remembers salted hashes,
so the same value gets the same placeholder without the value itself being stored anywhere.
"""
import hashlib
import json
import os
import sqlite3
from contextlib import closing
import threading
import time
from collections import OrderedDict
from pathlib import Path

from detect import norm

BASE = Path(__file__).parent
DB_PATH = BASE / "audit.sqlite3"
CLIENTS_PATH = BASE / "clients.txt"
MAX_SESSIONS = 500
_SALT = os.urandom(16)

_lock = threading.Lock()
_sessions: "OrderedDict[str, Session]" = OrderedDict()


class Session:
    def __init__(self):
        self.fwd: dict[tuple[str, str], str] = {}
        self.counters: dict[str, int] = {}

    def next_file(self) -> int:
        with _lock:
            self.counters["__file"] = self.counters.get("__file", 0) + 1
            return self.counters["__file"]

    def placeholder(self, ftype: str, value: str) -> str:
        key = (ftype, hashlib.sha256(_SALT + norm(value).encode()).hexdigest())
        with _lock:
            if key not in self.fwd:
                n = self.counters.get(ftype, 0) + 1
                self.counters[ftype] = n
                ph = f"[{ftype}_{n}]"
                self.fwd[key] = ph
            return self.fwd[key]


def session(sid: str) -> Session:
    with _lock:
        s = _sessions.get(sid)
        if s is None:
            s = _sessions[sid] = Session()
            while len(_sessions) > MAX_SESSIONS:
                _sessions.popitem(last=False)
        else:
            _sessions.move_to_end(sid)
        return s


def clients() -> list[str]:
    if not CLIENTS_PATH.exists():
        return []
    return [ln.strip() for ln in CLIENTS_PATH.read_text(encoding="utf-8").splitlines()
            if ln.strip() and not ln.startswith("#")]


def save_clients(names: list[str]) -> None:
    CLIENTS_PATH.write_text("\n".join(n.strip() for n in names if n.strip()) + "\n", encoding="utf-8")


def _db() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.execute("""CREATE TABLE IF NOT EXISTS events(
        id INTEGER PRIMARY KEY, ts REAL, site TEXT, source TEXT, action TEXT,
        counts TEXT, overrides INTEGER, filetype TEXT, llm INTEGER)""")
    return con


def log(site: str, source: str, action: str, counts: dict, overrides: int = 0,
        filetype: str = "", llm: bool = False) -> None:
    clean = {str(k)[:24]: int(v) for k, v in counts.items()}
    with _lock, closing(_db()) as con, con:
        con.execute("INSERT INTO events(ts,site,source,action,counts,overrides,filetype,llm) VALUES(?,?,?,?,?,?,?,?)",
                    (time.time(), site[:40], source[:20], action[:30], json.dumps(clean), int(overrides),
                     filetype[:12], int(llm)))


def audit(limit: int = 100) -> dict:
    with _lock, closing(_db()) as con:
        rows = con.execute("SELECT ts,site,source,action,counts,overrides,filetype,llm FROM events "
                           "ORDER BY id DESC").fetchall()
    by_type: dict[str, int] = {}
    totals = {"events": len(rows), "redacted": 0, "secrets": 0, "files_blocked": 0, "overrides": 0}
    events = []
    for ts, site, source, action, counts, overrides, filetype, llm in rows:
        c = json.loads(counts)
        for k, v in c.items():
            by_type[k] = by_type.get(k, 0) + v
            if k == "SECRET":
                totals["secrets"] += v
            else:
                totals["redacted"] += v
        totals["overrides"] += overrides
        if action == "file_blocked":
            totals["files_blocked"] += 1
        if len(events) < limit:
            events.append({"ts": ts, "site": site, "source": source, "action": action, "counts": c,
                           "overrides": overrides, "filetype": filetype, "llm": bool(llm)})
    return {"totals": totals, "by_type": dict(sorted(by_type.items(), key=lambda kv: -kv[1])), "events": events}
