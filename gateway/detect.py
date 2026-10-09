"""Layered detector: rules -> client list -> (optional) local LLM entities.

Everything here is pure Python and runs on-device. No value ever leaves the process.
"""
import re
from dataclasses import dataclass

import names

BLOCK, REDACT = "block", "redact"
SECRET_PLACEHOLDER = "[SECRET_REMOVED]"
CONTEXTUAL = {"PERSON", "ORG", "ADDRESS", "CLIENT", "HEALTH"}


@dataclass
class Finding:
    type: str
    value: str
    start: int
    end: int
    action: str
    layer: str
    placeholder: str = ""
    priority: int = 50


def _luhn(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch)
        if i % 2:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def _long_number(m: re.Match):
    """13-19 digit runs: Luhn-valid -> CARD, 16 digits in 4-4-4-4 -> PhilSys number."""
    raw = m.group(0)
    digits = re.sub(r"\D", "", raw)
    if 13 <= len(digits) <= 19 and _luhn(digits):
        return "CARD"
    if len(digits) == 16 and re.fullmatch(r"\d{4}([ -])\d{4}\1\d{4}\1\d{4}", raw):
        return "PHILSYS"
    return None


def _random_token(m: re.Match):
    """Keys are random: upper case, lower case and digits change from one character to the next far more often
    than in a long file name or a camelCase identifier. Only tokens that switch that often are treated as keys."""
    token = m.group(0)
    kind = lambda c: "d" if c.isdigit() else "u" if c.isupper() else "l" if c.islower() else "s"
    switches = sum(1 for a, b in zip(token, token[1:]) if kind(a) != kind(b))
    return "SECRET" if switches / (len(token) - 1) >= 0.45 else None


_KEYWORD_ID = {
    "sss": "SSS", "gsis": "GSIS", "philhealth": "PHILHEALTH", "pagibig": "PAGIBIG",
    "hdmf": "PAGIBIG", "umid": "UMID", "prc": "PRC_ID", "tin": "TIN",
}


def _keyword_id(m: re.Match):
    key = re.sub(r"[^a-z]", "", m.group(1).lower())
    return _KEYWORD_ID.get(key, "ID_NUMBER")


_NAME = r"[A-ZÑ][a-zñ'’\-]+"
_LABELS = (r"full\s*name|given\s*names?|first\s*name|middle\s*name|last\s*name|surname|apelyido|name|pangalan|customer|client|borrower|employee|patient|pasyente|member|insured|applicant|"
           r"dependent|beneficiary|doctor|physician|attending\s+(?:doctor|physician)|account\s+holder|owner|author|from|to|cc|bcc|"
           r"attn|attention|contact\s+person|(?:prepared|signed|requested|approved|submitted|reviewed|issued)\s+(?:by|for|to)")
# After a label, names in ALL CAPS count too (forms are often filled in capitals).
_CAPS = r"[A-ZÑ][A-Za-zñÑ'’\-]+"
_CAPS_SEQ = rf"{_CAPS}(?:[ \t]+(?:[A-Z]\.|de[ \t]+la|dela|del|de|{_CAPS})){{0,4}}"
_NAME_SEQ = rf"{_NAME}(?:[ \t]+(?:[A-Z]\.|de[ \t]+la|dela|del|de[ \t]+los|de|{_NAME})){{0,3}}"

# (type, action, pattern, value group, classifier, priority) - lower priority number wins overlaps
_RULES = [
    ("SECRET", BLOCK, r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|\Z)", 0, None, 1),
    ("SECRET", BLOCK, r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b", 0, None, 1),
    ("SECRET", BLOCK, r"\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b", 0, None, 1),
    ("SECRET", BLOCK, r"\bsk-(?:proj-|ant-)?[A-Za-z0-9_\-]{20,}", 0, None, 1),
    ("SECRET", BLOCK, r"\bAIza[0-9A-Za-z_\-]{35}\b", 0, None, 1),
    # Well-known key prefixes: always a key, whatever follows.
    # Some keys are several parts joined by dots, so dots are allowed inside (not at the end).
    ("SECRET", BLOCK, r"(?<![A-Za-z0-9])(?:gsk|hf|xai|r8|pplx|nvapi|shpat|shpss|tvly|dop_v1|glsa|sk|pk|rk)[_\-][A-Za-z0-9_\-.]{19,}[A-Za-z0-9_\-]", 0, None, 1),
    # Other providers' keys share one shape: a short lowercase prefix, a separator, then a long random string.
    # Covers Groq (gsk_), Hugging Face (hf_), xAI (xai-), Replicate (r8_), Perplexity (pplx-), NVIDIA (nvapi-),
    # Shopify (shpat_), DigitalOcean (dop_v1_), Tavily (tvly-), Anthropic and OpenAI project keys, and new ones.
    ("SECRET", BLOCK, r"(?<![A-Za-z0-9])[a-z][a-z0-9]{1,7}(?:[_\-][a-z0-9]{1,6})?[_\-](?=[A-Za-z0-9_\-]*\d)(?=[A-Za-z0-9_\-]*[A-Z])[A-Za-z0-9_\-]{24,}", 0, _random_token, 1),
    # Any long random-looking token (upper case, lower case and digits mixed, 32+ characters) is treated as a key.
    ("SECRET", BLOCK, r"(?<![A-Za-z0-9_\-/.=])(?=[A-Za-z0-9_\-]*[a-z])(?=[A-Za-z0-9_\-]*[A-Z])(?=[A-Za-z0-9_\-]*\d)[A-Za-z0-9_\-]{32,}(?![A-Za-z0-9_\-])", 0, _random_token, 3),
    ("SECRET", BLOCK, r"\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}", 0, None, 1),
    ("SECRET", BLOCK, r"\bglpat-[A-Za-z0-9_\-]{20,}|\bnpm_[A-Za-z0-9]{36}|\bSG\.[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{16,}", 0, None, 1),
    ("SECRET", BLOCK, r"https://hooks\.slack\.com/services/\S+", 0, None, 1),
    ("SECRET", BLOCK, r"(?i)\bBearer\s+([A-Za-z0-9._\-]{20,})", 1, None, 1),
    ("SECRET", BLOCK, r"(?i)\b(?:AccountKey|SharedAccessKey|SharedAccessSignature|sig)=([A-Za-z0-9+/%=]{20,})", 1, None, 1),
    ("SECRET", BLOCK, r"(?i)\b(?:pin|otp|cvv|cvc|mpin)\b\s*(?:is|ay|[:=])\s*(\d{3,8})\b", 1, None, 2),
    ("SECRET", BLOCK, r"\bxox[abprs]-[A-Za-z0-9\-]{10,}", 0, None, 1),
    ("SECRET", BLOCK, r"\beyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}", 0, None, 1),
    ("SECRET", BLOCK, r"\b[a-z][a-z0-9+.\-]*://[^\s:/@]+:[^\s@/]+@[^\s]+", 0, None, 1),
    ("SECRET", BLOCK,
     # The password label is matched loosely so common misspellings count too: pasword, passowrd, passwrord, pswd.
     r"(?i)\b(?:[a-z0-9]+_)*(?:pas{1,2}[a-z]{0,2}w[a-z]{1,5}d|psw(?:or)?d|passwd|passcode|passphrase|pwd|pw|secret|api[_\-]?key|access[_\-]?token|auth[_\-]?token)\b"
     # After ":" or "=" anything counts. After the word "is"/"ay" the value must look like a password (a digit or
     # symbol in it), so "the password is required" is left alone.
     r"(?:[ \t]*\([^)\n]{0,30}\))?(?:\s+(?:ko|namin|natin|niya))?\s*"
     r"(?:[:=]\s*[\"']?(?!\[[A-Z_]+\])([^\s\"',;]{4,})|(?:is|ay)\s+[\"']?(?=\S*[\d@#$%^&*!])([^\s\"',;]{4,}))", "any", None, 2),

    # Long encoded blobs (base64 attachments, data URIs) hide content the scan cannot see.
    ("ENCODED_DATA", REDACT, r"(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{200,}={0,2}", 0, None, 8),
    ("EMAIL", REDACT, r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b", 0, None, 10),
    ("CARD", REDACT, r"(?<![\d\-])\d{4}[ \-]?\d{4}[ \-]?\d{4}[ \-]?\d{1,7}(?![ \-]?\d)", 0, _long_number, 11),
    ("CARD", REDACT, r"(?<![\d\-])3[47]\d{2}[ \-]?\d{6}[ \-]?\d{5}(?![ \-]?\d)", 0, _long_number, 11),
    ("UMID", REDACT, r"(?<![\d\-])\d{4}-\d{7}-\d(?![\d\-])", 0, None, 12),
    ("PHILHEALTH", REDACT, r"(?<![\d\-])\d{2}-\d{9}-\d(?![\d\-])", 0, None, 12),
    ("SSS", REDACT, r"(?<![\d\-])\d{2}-\d{7}-\d(?![\d\-])", 0, None, 12),
    ("TIN", REDACT, r"(?<![\d\-])\d{3}-\d{3}-\d{3}(?:-\d{3,5})?(?![\d\-])", 0, None, 13),
    ("PAGIBIG", REDACT, r"(?<![\d\-])\d{4}-\d{4}-\d{4}(?![ \-]?\d)", 0, None, 14),
    ("PHONE", REDACT, r"(?<![\d+])(?:\+63|0063|0)[ \-]?9\d{2}[ \-]?\d{3}[ \-]?\d{4}(?!\d)", 0, None, 15),
    ("PHONE", REDACT, r"\(0\d{1,2}\)\s?\d{3,4}[ \-]?\d{4}(?!\d)", 0, None, 15),
    ("PASSPORT", REDACT, r"\b[A-Z]\d{7}[A-Z]\b", 0, None, 16),
    ("ID_NUMBER", REDACT,
     r"(?i)\b(SSS|GSIS|PhilHealth|Pag-?IBIG|HDMF|UMID|PRC|TIN)\b[^\d\n]{0,20}(\d[\d\-]{7,16}\d)", 2, _keyword_id, 17),
    ("DOB", REDACT,
     r"(?i)\b(?:birth\s*date|date\s+of\s+birth|birthday|DOB|kapanganakan)\b\W{0,6}"
     r"(\d{1,4}[/\-. ]\w{1,9}[/\-. ,]+\d{2,4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})", 1, None, 18),
    # Labelled reference numbers: "LOA Number 59017576", "Member ID: AB-123456", "Policy No. 0012345".
    ("REF_NO", REDACT,
     r"(?i)\b(?:no\.?|number|num|id|code|ref(?:erence)?)\b\s*[:#.]?\s*((?=[A-Z0-9\-]*\d{5})[A-Z0-9][A-Z0-9\-]{4,24})", 1, None, 19),
    # ---- IT ----
    ("IP_ADDRESS", REDACT,
     r"(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])", 0, None, 20),
    ("MAC_ADDRESS", REDACT, r"\b(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}\b", 0, None, 20),
    ("INTERNAL_HOST", REDACT,
     r"(?i)\b[a-z0-9][a-z0-9\-]*(?:\.[a-z0-9\-]+)*\.(?:local|internal|intranet|corp|lan|priv)\b(?::\d+)?", 0, None, 21),
    # A note in brackets may sit between the label and the value: "Username (Admin): jdoe".
    ("USERNAME", REDACT, r"(?i)\b(?:user(?:name)?|login|uid|user[ _]?id|account[ _]?name)(?:[ \t]*\([^)\n]{0,30}\))?\s*[:=]\s*[\"']?([A-Za-z0-9._\-@\\]{3,40})", 1, None, 22),
    ("USERNAME", REDACT, r"(?i)\b[A-Z]:\\Users\\([^\\\s\"']+)|/(?:home|Users)/([A-Za-z0-9._\-]+)", "any", None, 22),
    # ---- identity documents ----
    ("ID_DOCUMENT", REDACT, r"(?m)^(?=.*<<)[A-Z0-9<]{20,}$", 0, None, 9),
    # ---- healthcare and other sensitive personal information (labelled fields) ----
    ("HEALTH", REDACT,
     r"(?i)\b(?:final\s+diagnosis|diagnosis|dx|impression|chief\s+complaint|medications?|"
     r"prescription|rx|allergies|lab(?:oratory)?\s+results?|medical\s+condition|sakit|karamdaman)\b[ \t]*[:\-][ \t]*([^\n]{2,200})",
     1, None, 34),
    ("DEMOGRAPHIC", REDACT,
     r"(?i)\b(?:age|sex|gender|civil\s*status|marital\s*status|religion|nationality|citizenship|ethnicity|blood\s*type|edad|kasarian)\b"
     r"[ \t]*(?:/[ \t]*\w+[ \t]*)?[:\-][ \t]*([^\n,;]{1,25})", 1, None, 35),
    # ---- street addresses without a label: "14 Mabini St, Marikina", "Unit 4B, 221 Katipunan Ave, Quezon City" ----
    ("ADDRESS", REDACT,
     r"(?:\b(?i:unit|rm|room|flr|floor|blk|block|lot|bldg|building|phase)\.?[ \t]*[\w\-]+,?[ \t]+)*"
     r"\b\d{1,5}[A-Za-z]?[ \t]+(?:[A-Z][A-Za-z.'\-]*[ \t]+){1,4}"
     r"(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Drive|Dr|Ext|Extension|Highway|Hwy|Lane|Ln|Way|Circle)\b\.?"
     # The place names after the street stop at a full stop, so the next sentence is not swallowed.
     r"(?:,[ \t]*(?:(?i:brgy|barangay|bgy)\.?[ \t]+)?[A-Z][A-Za-z'\-]+(?:[ \t]+[A-Z][A-Za-z'\-]+){0,3}){0,3}", 0, None, 33),
    # ---- customers and finance (labelled fields) ----
    ("ADDRESS", REDACT,
     r"(?i)\b(?:(?:home|billing|shipping|delivery|office|present|permanent|mailing)[ \t]+)?(?:address|tirahan)\b[ \t]*[:\-][ \t]*([^\n]{5,120})",
     1, None, 34),
    ("ORG", REDACT,
     r"(?i)\b(?:company|employer|kumpanya|business\s*name|organi[sz]ation)\b(?:[ \t]+name)?[ \t]*[:\-][ \t]*([^\n,;]{2,80})", 1, None, 35),
    ("FINANCIAL", REDACT,
     r"(?i)\b(?:salary|sahod|sweldo|basic\s*pay|net\s*pay|gross\s*pay|take[ \-]home\s*pay|monthly\s*income|annual\s*income|credit\s*limit|"
     r"account\s*balance)\b[^\n\d]{0,14}(\d[\d,]*(?:\.\d+)?)", 1, None, 36),
    ("BANK_ACCT", REDACT,
     r"(?i)\b(?:acct|account|acc)\.?\s*(?:no\.?|number|num|#)?\s*[:#]?\s*(\d[\d \-]{8,18}\d)", 1, None, 18),

    ("PERSON", REDACT,
     rf"\b(?:Mr|Mrs|Ms|Dr|Atty|Engr|Gng|Bb|Sir|Madam)\.?\s+({_NAME_SEQ})", 1, None, 30),
    ("PERSON", REDACT, rf"\b(?:si|kay|ni|kina|sina|nina)\s+(?:(?:Mr|Mrs|Ms|Dr|Atty|Engr|Gng|Bb)\.?\s+)?({_NAME_SEQ})", 1, None, 31),
    ("PERSON", REDACT,
     rf"(?i:\b(?:{_LABELS})(?:[ \t]+name)?[ \t]*[:\-][ \t]*(?:(?:dr|mr|mrs|ms|atty|engr)\.?[ \t]+)?)({_CAPS_SEQ})", 1, None, 32),
    ("PERSON", REDACT, rf"(?i:\b(?:dear|hi|hello|kumusta|magandang[ \t]+(?:araw|umaga|hapon|gabi))[ \t]+(?:(?:dr|mr|mrs|ms|atty|engr|sir|ma'am)\.?[ \t]+)?)"
     rf"({_NAME_SEQ})", 1, None, 33),
    # Routing and sign-off phrases name a person even without a colon: "attn Maria Santos", "Received by Juan Cruz".
    ("PERSON", REDACT,
     rf"(?i:\b(?:attn\.?|attention|c/o|care\s+of|(?:sold|bill(?:ed)?|ship(?:ped)?|deliver(?:ed)?|issued|paid|endorsed)\s+to|"
     rf"(?:received|prepared|signed|approved|checked|noted|verified|endorsed|requested|submitted|reviewed|encoded|delivered|sold|issued)"
     rf"\s+by)[ \t]*[:\-]?[ \t]*(?:(?:dr|mr|mrs|ms|atty|engr)\.?[ \t]+)?)({_CAPS_SEQ})", 1, None, 33),
    # Form layouts from PDFs: the label on one line, the name alone on the next.
    ("PERSON", REDACT, rf"(?im:^[ \t]*(?:{_LABELS})(?:[ \t]+name)?[ \t]*:?[ \t]*\n[ \t]*(?:(?:dr|mr|mrs|ms|atty|engr)\.?[ \t]+)?)({_CAPS_SEQ})(?=[ \t]*(?:\n|$))", 1, None, 33),
]
_COMPILED = [(t, a, re.compile(p), g, fn, pr) for t, a, p, g, fn, pr in _RULES]

_CODE_LINE = re.compile(
    r"^\s*(?:def |class |import |from \w+ import |function |const |let |var |public |private |#include|"
    r"SELECT\b.+\bFROM\b|INSERT INTO|UPDATE \w+ SET|[{}]\s*$)|[;{]\s*$", re.I)


_CRED_CONTEXT = re.compile(r"(?i)\b(?:user\s*name|username|login|log\s*in|credentials?|admin|pas{1,2}[a-z]{0,2}w[a-z]{1,5}d|passcode|account)\b")
_PASSWORD_LIKE = re.compile(r"(?<![\w@.\-])(?=[^\s]*[A-Za-z])(?=[^\s]*\d)(?=[^\s]*[@#$%^&*!?~+=])[^\s\"',;:()\[\]<>]{6,40}(?![\w@])")


def norm(value: str) -> str:
    return " ".join(value.split()).lower()


def _resolve(found: list[Finding]) -> list[Finding]:
    """Drop overlaps: best priority first, then longest span."""
    kept: list[Finding] = []
    for f in sorted(found, key=lambda f: (f.priority, -(f.end - f.start), f.start)):
        if all(f.end <= k.start or f.start >= k.end for k in kept):
            kept.append(f)
    return sorted(kept, key=lambda f: f.start)


def _propagate(text: str, found: list[Finding]) -> list[Finding]:
    """A value caught once is redacted everywhere it appears, even where no rule would fire on its own."""
    extra: list[Finding] = []
    for value, f in {norm(f.value): f for f in found if f.action == REDACT and len(f.value) >= 3}.items():
        for m in re.finditer(r"(?<!\w)" + r"\s+".join(re.escape(w) for w in value.split()) + r"(?!\w)", text, re.I):
            extra.append(Finding(f.type, m.group(0), m.start(), m.end(), REDACT, f.layer, priority=f.priority + 1))
    return _resolve(found + extra)


def scan_rules(text: str, clients: list[str] | None = None) -> list[Finding]:
    found: list[Finding] = []
    for ftype, action, rx, rule_group, fn, prio in _COMPILED:
        for m in rx.finditer(text):
            group = rule_group
            t = ftype
            if fn:
                t = fn(m)
                if not t:
                    continue
            if group == "any":
                group = next(i for i in range(1, (m.lastindex or 0) + 1) if m.group(i) is not None)
            s, e = m.span(group)
            if e > s:
                found.append(Finding(t, text[s:e], s, e, action, "rule", priority=prio))
    # Where the text is about logins, anything that looks like a password is removed even with no label beside it
    # (a mix of letters, a digit and a symbol), for example the second column of a pasted credentials table.
    # With no login context at all, a word is still removed when it has the shape of a strong password on its own:
    # eight or more characters, with letters, a digit and one of @ # $ % ^ & * ! in it, such as a password typed
    # alone into a chat box. Email addresses are left to the email rule.
    in_context = bool(_CRED_CONTEXT.search(text))
    for m in _PASSWORD_LIKE.finditer(text):
        token = m.group(0)
        if re.search(r"[/\\]", token):                       # a web address or a file path
            continue
        if not in_context and (len(token) < 8 or not re.search(r"[@#$%^&*!]", token) or re.fullmatch(r"[^@\s]+@[\w\-]+(\.[\w\-]+)+", token)):
            continue
        found.append(Finding("SECRET", token, m.start(), m.end(), BLOCK, "rule", priority=4 if in_context else 12))
    # Common given names and surnames, matched directly: the small local model misses plain names too often.
    for s, e in names.find_names(text):
        found.append(Finding("PERSON", text[s:e], s, e, REDACT, "name-list", priority=38))
    for c in clients or []:
        if len(c) < 3:
            continue
        for m in re.finditer(r"(?<!\w)" + re.escape(c) + r"(?!\w)", text, re.I):
            found.append(Finding("CLIENT", m.group(0), m.start(), m.end(), REDACT, "client-list", priority=5))
    return _propagate(text, _resolve(found))


_GENERIC = {
    "customer", "client", "boss", "bank", "company", "manager", "agent", "user", "employee", "team",
    "chatgpt", "gemini", "excel", "gmail", "google", "microsoft", "philippines", "pilipinas", "manila",
    "sss", "tin", "philhealth", "pag-ibig", "pagibig", "bir", "hr", "it",
}


def merge_llm(text: str, found: list[Finding], entities: list[tuple[str, str]]) -> list[Finding]:
    """Add LLM-reported spans that literally occur in the text and do not overlap rule hits."""
    extra: list[Finding] = []
    for value, etype in entities:
        value = value.strip()
        etype = etype if etype in ("PERSON", "ORG", "ADDRESS", "HEALTH") else "PERSON"
        if etype in ("PERSON", "ORG") and re.search(r"\d{2}", value):
            continue  # amounts and codes are not names
        if re.fullmatch(r"(?i)(?:php|usd|p|\$|₱)?\s*[\d,.]+\s*(?:pesos?|php|usd|dollars?|k|m)?", value):
            continue  # a bare amount is not an entity
        if len(value) < 3 or norm(value) in _GENERIC or re.fullmatch(r"\[[A-Z_]+_\d+\]", value):
            continue
        if re.fullmatch(r"[A-Z_]+_\d+|X|SECRET_REMOVED", value):
            continue  # the inside of a placeholder
        for m in re.finditer(r"(?<!\w)" + re.escape(value) + r"(?!\w)", text, re.I):
            if text[max(0, m.start() - 1):m.start()] == "[" and text[m.end():m.end() + 1] == "]":
                continue
            extra.append(Finding(etype, m.group(0), m.start(), m.end(), REDACT, "local-llm", priority=40))
    return _propagate(text, _resolve(found + extra))


def add_known(text: str, found: list[Finding], known: dict[str, str]) -> list[Finding]:
    """Redact values already identified elsewhere in the same upload (for example a name column in a spreadsheet)."""
    extra: list[Finding] = []
    for value, ftype in known.items():
        rx = r"(?<!\w)" + r"\s+".join(re.escape(w) for w in value.split()) + r"(?!\w)"
        for m in re.finditer(rx, text, re.I):
            extra.append(Finding(ftype, m.group(0), m.start(), m.end(), REDACT, "same-upload", priority=45))
    return _resolve(found + extra) if extra else found


def mask_found(text: str, found: list[Finding]) -> str:
    for f in sorted(found, key=lambda f: f.start, reverse=True):
        text = text[:f.start] + "[X]" + text[f.end:]
    return text


def warnings_for(text: str) -> list[str]:
    lines = text.splitlines()
    if sum(1 for ln in lines if _CODE_LINE.search(ln)) >= 3:
        return ["code"]
    return []


def assign(session, found: list[Finding]) -> None:
    for f in found:
        f.placeholder = SECRET_PLACEHOLDER if f.action == BLOCK else session.placeholder(f.type, f.value)


def sanitize(text: str, found: list[Finding]) -> str:
    for f in sorted(found, key=lambda f: f.start, reverse=True):
        text = text[:f.start] + f.placeholder + text[f.end:]
    return text
