"""Upload path: read any file locally (readers.py), run the detector over everything that was read, and hand back
a sanitized copy. The original file is never passed on: the chatbot gets redacted text or a redacted CSV under a
neutral name. Anything that cannot be read or fully checked is refused (fail-closed).
"""
import base64
import csv
import io
import re
from pathlib import PurePath

import detect
import llm
import readers

_HEADER_RULES = [
    ("SECRET", r"pass(word)?|pwd|secret|token|api.?key|\bpin\b|\botp\b|cvv"),
    ("EMAIL", r"e-?mail"),
    ("PHONE", r"phone|mobile|cell|contact.?(no|num)|cp.?(no|num)|telepono|landline"),
    ("TIN", r"\btin\b"),
    ("SSS", r"\bsss\b"),
    ("PHILHEALTH", r"philhealth"),
    ("PAGIBIG", r"pag.?ibig|hdmf"),
    ("CARD", r"card.?(no|num)"),
    ("BANK_ACCT", r"(acct|account).?(no|num|#)"),
    ("REF_NO", r"(member|policy|loa|loe|employee|customer|client|patient|claim|invoice|order|reference|ref).?(id|no|num|#|code)"),
    ("DOB", r"birth|\bdob\b|kapanganakan"),
    ("DEMOGRAPHIC", r"^age$|^sex$|gender|civil.?status|marital|religion|nationality|citizenship|blood.?type|^edad$|kasarian"),
    ("HEALTH", r"diagnos|medication|medical|illness|allerg|prescription|lab.?result|sakit|karamdaman"),
    ("FINANCIAL", r"salary|sahod|sweldo|income|net.?pay|gross.?pay|basic.?pay|credit.?limit|balance"),
    ("IP_ADDRESS", r"\bip\b|ip.?addr"),
    ("USERNAME", r"user.?name|\blogin\b|user.?id"),
    ("ORG", r"company|employer|business|organi[sz]ation|kumpanya"),
    ("ADDRESS", r"address|tirahan|street|barangay|brgy"),
    ("PERSON", r"(?<!user)(?<!file)(?<!product)(?<!item)(?<!branch)name\b|pangalan|borrower|patient|pasyente|doctor|physician|"
               r"^customer$|^client$|^employee$|^member$|surname|apelyido|beneficiary|spouse|dependent"),
]
_HEADER_RX = [(t, re.compile(p, re.I)) for t, p in _HEADER_RULES]


def _header_type(header: str):
    h = header.strip().replace("_", " ")
    for t, rx in _HEADER_RX:
        if rx.search(h):
            return t
    return None


def _bump(counts: dict, key: str, n: int = 1):
    counts[key] = counts.get(key, 0) + n


def _scan_text(text, sess, clients, use_llm, counts, llm_info, known):
    found = detect.scan_rules(text, clients)
    found = detect.add_known(text, found, known)
    if use_llm and llm_info["available"]:
        try:
            ents, cov = llm.find_entities(detect.mask_found(text, found), max_chunks=40)
            found = detect.merge_llm(text, found, ents)
            llm_info.update(used=True, coverage=min(cov, llm_info.get("coverage", 1)))
        except Exception as e:
            llm_info["error"] = str(e)[:200]
    detect.assign(sess, found)
    for f in found:
        _bump(counts, f.type)
    return detect.sanitize(text, found)


def _process_table(rows, sess, clients, use_llm, counts, llm_info, columns, known):
    """Classify columns once (header rules, then the local LLM), redact typed columns whole, rule-scan the rest."""
    if not rows:
        return rows
    header = ["" if c is None else str(c) for c in rows[0]]
    types = {i: _header_type(h) for i, h in enumerate(header)}
    layer = {i: "header-rule" for i, t in types.items() if t}

    if use_llm and llm_info["available"]:
        ask = {}
        for i, h in enumerate(header):
            if types[i] or not h.strip():
                continue
            samples = [str(r[i]) for r in rows[1:40] if i < len(r) and r[i] not in (None, "")][:5]
            if samples and sum(1 for s in samples if re.search(r"[A-Za-z]{3}", s)) >= len(samples) * 0.6:
                ask[h] = samples
        if ask:
            try:
                answer = llm.classify_columns(ask)
                llm_info["used"] = True
                for i, h in enumerate(header):
                    if answer.get(h) in ("PERSON", "ORG", "ADDRESS", "HEALTH"):
                        types[i], layer[i] = answer[h], "local-llm"
            except Exception as e:
                llm_info["error"] = str(e)[:200]

    for i, h in enumerate(header):
        if types[i]:
            columns.append({"name": h, "type": types[i], "layer": layer[i]})

    out = [list(rows[0])]
    for r in rows[1:]:
        new = list(r)
        for i, cell in enumerate(r):
            if cell is None or cell == "":
                continue
            t = types.get(i)
            if t == "SECRET":
                new[i] = detect.SECRET_PLACEHOLDER
                _bump(counts, "SECRET")
            elif t:
                new[i] = sess.placeholder(t, str(cell))
                _bump(counts, t)
                value = " ".join(str(cell).split())
                if t in _CARRY and len(value) >= 4 and len(known) < 500 and re.search(r"[A-Za-z]", value):
                    known[value.lower()] = t
            else:
                text = cell if isinstance(cell, str) else str(cell)
                if len(text) >= 5:
                    found = detect.scan_rules(text, clients)
                    if found:
                        detect.assign(sess, found)
                        for f in found:
                            _bump(counts, f.type)
                        new[i] = detect.sanitize(text, found)
        out.append(new)
    return out


# Column values worth redacting wherever else they appear in the same upload.
_CARRY = {"PERSON", "ORG", "ADDRESS", "EMAIL", "USERNAME"}


def _csv_text(rows) -> str:
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\n").writerows(rows)
    return buf.getvalue()


def _refuse(name, reason):
    return {"supported": False, "blocked": True, "reason": reason, "name": name, "counts": {}}


def process_mail_attachment(name: str, data: bytes, sess) -> dict:
    """Company rule for email: an attachment may leave only if it is locked with a password. A locked file is
    passed on as it is (its contents cannot be read by anyone without the password, including this guard), under a
    neutral name. An unlocked file is refused."""
    if not readers.is_password_protected(data):
        return _refuse(name, "Email attachments must be password-protected. Protect this file with a password "
                             "(PDF, Word, Excel, PowerPoint or an encrypted ZIP), attach it again, and send the password separately.")
    ext = PurePath(name).suffix.lower()
    return {"supported": True, "blocked": False, "name": name, "kind": "password-protected", "counts": {}, "total": 0,
            "passthrough": True, "out_name": f"file-{sess.next_file()}{ext}", "out_b64": "", "llm": {"used": False}}


def process_file(name: str, data: bytes, sess, clients: list[str], use_llm: bool) -> dict:
    counts: dict[str, int] = {}
    columns: list[dict] = []
    llm_info = dict(llm.status(), used=False)
    ctx = readers.Context()

    try:
        parts = readers.extract(name, data, ctx)
    except readers.Refused as e:
        return _refuse(name, str(e))
    except Exception as e:
        return _refuse(name, f"Could not read this file on this device ({type(e).__name__}), so it is blocked.")

    tables = [p[1] for p in parts if p[0] == "table" and p[1]]
    texts = [p[1] for p in parts if p[0] == "text" and p[1].strip()]
    if not tables and not texts:
        return _refuse(name, "Nothing readable was found in this file, so it cannot be checked and is blocked.")

    try:
        known: dict[str, str] = {}
        tables_out = [_process_table(rows, sess, clients, use_llm, counts, llm_info, columns, known) for rows in tables]
        text_out = _scan_text("\n\n".join(texts), sess, clients, use_llm, counts, llm_info, known) if texts else ""
    except Exception as e:
        return _refuse(name, f"Could not check this file on this device ({type(e).__name__}), so it is blocked.")

    # Strict: nothing leaves unless the local AI layer actually checked it, in full.
    if use_llm and not llm_info["available"]:
        return _refuse(name, "The local AI check is not running on this device, so this file cannot be verified.")
    if llm_info.get("error"):
        return _refuse(name, "The local AI check failed part-way, so this file cannot be verified.")
    if llm_info.get("coverage", 1) < 1:
        return _refuse(name, "This document is too long to check fully on this device. Split it into smaller files.")

    if len(tables_out) == 1 and not texts:
        out, ext, mime = _csv_text(tables_out[0]), ".csv", "text/csv"
    else:
        blocks = [text_out] if text_out else []
        for n, rows in enumerate(tables_out, start=1):
            blocks.append(f"[Table {n}]\n" + _csv_text(rows))
        out, ext, mime = "\n\n".join(blocks), ".txt", "text/plain"

    total = sum(counts.values())
    # File names often carry a person or client name, so the original name is never passed on.
    out_name = f"file-{sess.next_file()}{ext}"
    return {
        "supported": True, "blocked": False, "name": name, "kind": "+".join(dict.fromkeys(ctx.kinds)) or "text",
        "counts": counts, "total": total, "columns": columns, "llm": llm_info,
        "out_name": out_name, "out_mime": mime, "out_b64": base64.b64encode(out.encode("utf-8")).decode(),
    }
