"""PromptGuard PH local gateway. Binds to 127.0.0.1 only.

Run:  python -m uvicorn app:app --app-dir gateway --host 127.0.0.1 --port 8787
"""
import base64
import os
import socket
import threading
import time
import uuid
from pathlib import Path, PurePath

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import detect
import files
import llm
import store

BASE = Path(__file__).parent
_STARTED = time.time()

# Proof that the gateway stays on this PC: every connection it opens is counted, and any that goes anywhere other
# than this machine is counted separately. The number is shown on the Local proof page.
_connections = {"local": 0, "outside": 0}
_real_connect = socket.socket.connect


def _counting_connect(self, address):
    host = address[0] if isinstance(address, tuple) and address else ""
    _connections["local" if host in ("127.0.0.1", "::1", "localhost") else "outside"] += 1
    return _real_connect(self, address)


socket.socket.connect = _counting_connect
MAX_TEXT = 200_000
MAX_FILE = 20 * 1024 * 1024

app = FastAPI(title="PromptGuard PH gateway", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")


_jobs_lock = threading.Lock()


class ScanReq(BaseModel):
    session_id: str = Field(min_length=8, max_length=80)
    text: str
    llm: bool = False
    site: str = ""
    background: bool = False


class FileReq(BaseModel):
    session_id: str = Field(min_length=8, max_length=80)
    filename: str
    data_b64: str
    llm: bool = True
    site: str = ""
    channel: str = ""          # "mail" when the file is being attached to an email
    background: bool = False


class DecisionReq(BaseModel):
    site: str = ""
    source: str = "typed"
    action: str
    counts: dict[str, int] = {}
    overrides: int = 0
    llm: bool = False


class ClientsReq(BaseModel):
    clients: list[str]


@app.get("/")
def root():
    return RedirectResponse("/dashboard")


# Notices for the desktop mascot. The browser extension posts what it has to tell the user here, and the mascot
# shows it in a speech bubble. Kept in memory only (the last 50), never written to disk or to the audit log.
_notices: list[dict] = []
_notice_seq = 0
_mascot_seen = 0.0


class NoticeReq(BaseModel):
    title: str = Field(max_length=200)
    text: str = Field(default="", max_length=600)
    mood: str = Field(default="", max_length=12)      # "angry", "happy", "busy", "done" or ""
    site: str = Field(default="", max_length=40)


@app.post("/notice")
def post_notice(req: NoticeReq):
    global _notice_seq
    with _jobs_lock:
        _notice_seq += 1
        _notices.append({"seq": _notice_seq, **req.model_dump()})
        del _notices[:-50]
    return {"ok": True}


@app.get("/notices")
def get_notices(after: int = -1):
    """Polled by the desktop mascot. `after=-1` only asks where the queue currently ends."""
    global _mascot_seen
    _mascot_seen = time.time()
    with _jobs_lock:
        return {"seq": _notice_seq, "notices": [] if after < 0 else [n for n in _notices if n["seq"] > after]}


# Browser sensors (the extension) report in here every half minute. The desktop mascot uses this to warn the user
# when the browser in front has no sensor, which means uploads and typing there are not guarded.
_sensors: dict[str, float] = {}


class SensorReq(BaseModel):
    browser: str = Field(max_length=20)
    version: str = Field(default="", max_length=20)


@app.post("/sensor")
def sensor(req: SensorReq):
    _sensors[req.browser.lower()] = time.time()
    return {"ok": True}


# Titles of the browser tabs the sensor is currently watching (reported every few seconds while a tab is visible).
# Memory only. Lets the mascot notice a tab the sensor is not in.
_tabs: dict[str, float] = {}


class TabReq(BaseModel):
    title: str = Field(default="", max_length=300)
    site: str = Field(default="", max_length=40)


@app.post("/tab")
def tab(req: TabReq):
    now = time.time()
    _tabs[req.title] = now
    for old in [t for t, seen in _tabs.items() if now - seen > 60]:
        del _tabs[old]
    return {"ok": True, "mascot": now - _mascot_seen < 5}


def _live_sensors() -> list[str]:
    now = time.time()
    return sorted(name for name, seen in _sensors.items() if now - seen < 90)


@app.get("/health")
def health():
    # `pid` and `started` let the desktop app notice a gateway that is older than the code on disk and replace it.
    return {"ok": True, "llm": llm.status(), "mascot": time.time() - _mascot_seen < 5, "sensors": _live_sensors(),
            "tabs": [t for t, seen in _tabs.items() if time.time() - seen < 8],
            "pid": os.getpid(), "started": _STARTED, "connections": dict(_connections)}


# Slow checks (local LLM, OCR) run as background jobs that the extension polls. A browser extension's service worker
# is shut down when a single request stays open for more than 30 seconds, so long checks must not hold one open.
_jobs: dict[str, dict] = {}


def _background(fn, req):
    job_id = uuid.uuid4().hex
    with _jobs_lock:
        for old in [k for k, v in _jobs.items() if time.time() - v["at"] > 900]:
            del _jobs[old]
        _jobs[job_id] = {"done": False, "at": time.time()}

    def run():
        try:
            result = fn(req)
        except HTTPException as e:
            result = {"blocked": True, "refused": str(e.detail), "reason": str(e.detail), "counts": {}, "findings": []}
        except Exception as e:
            reason = f"The check failed on this device ({type(e).__name__}), so this is blocked."
            result = {"blocked": True, "refused": reason, "reason": reason, "counts": {}, "findings": []}
        with _jobs_lock:
            _jobs[job_id].update(done=True, result=result)

    threading.Thread(target=run, daemon=True).start()
    return {"job": job_id}


@app.get("/job/{job_id}")
def job(job_id: str):
    with _jobs_lock:
        entry = _jobs.get(job_id)
        if entry is None:
            raise HTTPException(404, "unknown job")
        if not entry["done"]:
            return {"done": False}
        del _jobs[job_id]
        return {"done": True, "result": entry["result"]}


@app.post("/scan")
def scan(req: ScanReq):
    return _background(_scan, req) if req.background else _scan(req)


def _scan(req: ScanReq):
    if len(req.text) > MAX_TEXT:
        raise HTTPException(413, "text too long")
    sess = store.session(req.session_id)
    t0 = time.perf_counter()
    found = detect.scan_rules(req.text, store.clients())
    ms_rules = round((time.perf_counter() - t0) * 1000, 1)

    info = dict(llm.status(), used=False)
    refused = ""
    if req.llm and not info["available"]:
        refused = "The local AI check is not running on this device, so this cannot be verified."
    if req.llm and info["available"]:
        t1 = time.perf_counter()
        try:
            ents, coverage = llm.find_entities(detect.mask_found(req.text, found))
            found = detect.merge_llm(req.text, found, ents)
            info.update(used=True, coverage=coverage)
            if coverage < 1:
                refused = "This message is too long to check fully on this device. Shorten it."
        except Exception as e:
            info["error"] = str(e)[:200]
            refused = "The local AI check failed, so this cannot be verified."
        info["ms"] = round((time.perf_counter() - t1) * 1000)

    detect.assign(sess, found)
    return {
        # The response never echoes detected values: only types and where they were found.
        "findings": [{"type": f.type, "action": f.action, "layer": f.layer} for f in found],
        "warnings": detect.warnings_for(req.text),
        "refused": refused,
        "sanitized": detect.sanitize(req.text, found),
        "ms_rules": ms_rules,
        "llm": info,
    }


@app.post("/scan-file")
def scan_file(req: FileReq):
    return _background(_scan_file, req) if req.background else _scan_file(req)


def _scan_file(req: FileReq):
    try:
        data = base64.b64decode(req.data_b64, validate=True)
    except Exception:
        raise HTTPException(400, "bad base64")
    ext = PurePath(req.filename).suffix.lower().lstrip(".")
    if len(data) > MAX_FILE:
        result = {"supported": False, "blocked": True, "name": req.filename, "counts": {},
                  "reason": "File is larger than 20 MB, so it is blocked."}
    else:
        t0 = time.perf_counter()
        if req.channel == "mail":
            result = files.process_mail_attachment(req.filename, data, store.session(req.session_id))
        else:
            result = files.process_file(req.filename, data, store.session(req.session_id), store.clients(), req.llm)
        result["ms"] = round((time.perf_counter() - t0) * 1000)
    action = ("file_blocked" if result["blocked"] else "file_protected" if result.get("passthrough")
              else "file_sanitized" if result.get("total") else "file_clean")
    store.log(req.site, "upload", action, result["counts"], filetype=ext,
              llm=bool(result.get("llm", {}).get("used")))
    return result


@app.post("/decision")
def decision(req: DecisionReq):
    store.log(req.site, req.source, req.action, req.counts, req.overrides, llm=req.llm)
    return {"ok": True}


@app.get("/audit")
def audit():
    return store.audit()


@app.get("/clients")
def get_clients():
    return {"clients": store.clients()}


@app.put("/clients")
def put_clients(req: ClientsReq):
    store.save_clients(req.clients[:2000])
    return {"clients": store.clients()}


@app.get("/proof")
def proof():
    return FileResponse(BASE / "static" / "proof.html")


@app.get("/policy")
def policy():
    return FileResponse(BASE / "static" / "policy.html")


@app.get("/dashboard")
def dashboard():
    return FileResponse(BASE / "static" / "dashboard.html")
