"""Turn any uploaded file into text and tables, entirely on this device.

The format is decided by looking at the bytes, not the file name, so a renamed file is still read correctly.
Containers (zip, tar, gzip, email, Outlook messages) are opened and every member is read the same way.
A file that yields nothing readable raises Refused: the guard never passes on what it could not read.
"""
import collections
import csv
import email
import email.policy
import gzip
import html
import io
import math
import re
import tarfile
import threading
import zipfile
from pathlib import PurePath

MAX_OCR_IMAGES = 15       # per upload, across pages and embedded pictures
MAX_MEMBERS = 100         # files inside an archive or email
MAX_UNPACKED = 60 * 1024 * 1024
MAX_DEPTH = 3
MAX_ROWS = 200_000

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".jpe", ".jfif", ".bmp", ".dib", ".webp", ".tif", ".tiff", ".gif", ".ico", ".heic", ".heif",
             ".avif", ".ppm", ".pgm", ".pbm", ".tga", ".jp2", ".pcx"}
_ID_DOC = re.compile(
    r"(?i)pass\s*port|pasaporte|driver'?s?\s*licen[sc]e|republi[kc]a?\s*(?:ng|of\s*the)\s*(?:pilipinas|philippines)|philsys|"
    r"phil(?:ippine)?\s*identification|unified\s*multi|postal\s*id|voter'?s?\s*(?:id|cert)|nbi\s*clearance|"
    r"professional\s*regulation\s*commission|social\s*security\s*system|land\s*transportation\s*office|birth\s*certificate")


class Refused(Exception):
    """The file cannot be read or must not be sent. The message is shown to the user."""


class Context:
    def __init__(self):
        self.ocr_left = MAX_OCR_IMAGES
        self.members = 0
        self.unpacked = 0
        self.kinds: list[str] = []


# A part is ("text", str) or ("table", list_of_rows).
Part = tuple


# ------------------------------------------------------------------ OCR
_ocr_engine = None
_ocr_lock = threading.Lock()
_heif_ready = False


def _open_image(data: bytes):
    global _heif_ready
    from PIL import Image
    if not _heif_ready:
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
            if hasattr(pillow_heif, "register_avif_opener"):
                pillow_heif.register_avif_opener()
        except Exception:
            pass
        _heif_ready = True
    Image.MAX_IMAGE_PIXELS = 80_000_000
    return Image.open(io.BytesIO(data))


def _ocr_frame(img) -> tuple[str, float]:
    """OCR one PIL image with the local ONNX model. Returns (text, mean confidence)."""
    global _ocr_engine
    import numpy as np
    img = img.convert("RGB")
    if max(img.size) > 3200:
        img.thumbnail((3200, 3200))
    with _ocr_lock:
        if _ocr_engine is None:
            from rapidocr_onnxruntime import RapidOCR
            _ocr_engine = RapidOCR()
        result, _ = _ocr_engine(np.array(img)[:, :, ::-1])
    if not result:
        return "", 0.0
    return "\n".join(str(t) for _, t, _ in result), sum(float(s) for _, _, s in result) / len(result)


def _ocr(img, ctx: Context, strict: bool) -> str:
    """strict=True for a picture the user uploaded directly; False for pictures embedded in a document."""
    if ctx.ocr_left <= 0:
        if strict:
            raise Refused(f"This upload has more than {MAX_OCR_IMAGES} images or scanned pages, too many to read on this device.")
        return ""
    ctx.ocr_left -= 1
    text, score = _ocr_frame(img)
    if _ID_DOC.search(text):
        raise Refused("This contains what looks like a government ID or civil document. Identity documents are never sent.")
    if strict and not text.strip():
        raise Refused("No readable text was found in this image, so it cannot be checked and is blocked.")
    if strict and score < 0.7:
        raise Refused("The text in this image is not clear enough to check reliably, so it is blocked.")
    return text if score >= 0.7 else ""


def _read_image(data: bytes, ctx: Context) -> list[Part]:
    from PIL import ImageSequence
    try:
        img = _open_image(data)
        frames = [f.copy() for i, f in enumerate(ImageSequence.Iterator(img)) if i < MAX_OCR_IMAGES + 1]
    except Refused:
        raise
    except Exception:
        raise Refused("This image format cannot be opened on this device, so it is blocked.")
    if len(frames) > MAX_OCR_IMAGES:
        raise Refused(f"This image has more than {MAX_OCR_IMAGES} pages or frames, too many to read on this device.")
    texts = []
    for i, frame in enumerate(frames):
        # In an animation, later frames often repeat the first; only the first must contain text.
        texts.append(_ocr(frame, ctx, strict=(i == 0)))
    ctx.kinds.append("image")
    return [("text", "\n".join(dict.fromkeys(t for t in texts if t)))]


def _embedded_images(z: zipfile.ZipFile, ctx: Context) -> list[str]:
    out = []
    for n in z.namelist():
        if "/media/" in n and PurePath(n).suffix.lower() in IMAGE_EXT and z.getinfo(n).file_size > 4000 and ctx.ocr_left > 0:
            try:
                text = _ocr(_open_image(z.read(n)), ctx, strict=False)
            except Refused:
                raise
            except Exception:
                continue
            if text.strip():
                out.append("[Text read from an embedded picture]\n" + text)
    return out


# ------------------------------------------------------------------ plain helpers
def _as_text(data: bytes):
    """Decoded text if the bytes really are text (whatever the extension says), else None."""
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        try:
            return data.decode("utf-16")
        except UnicodeDecodeError:
            return None
    if b"\x00" in data[:8192]:
        return None
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        pass
    sample = data[:20000]
    control = sum(1 for b in sample if b < 9 or 13 < b < 32)
    if sample and control / len(sample) < 0.01:
        return data.decode("cp1252", "replace")   # legacy Windows text
    return None


def _entropy(data: bytes) -> float:
    sample = data[:1_000_000]
    if not sample:
        return 0.0
    n = len(sample)
    return -sum(c / n * math.log2(c / n) for c in collections.Counter(sample).values())


_RUN_ASCII = re.compile(rb"[\x20-\x7e\t]{5,}")
_RUN_UTF16 = re.compile(rb"(?:[\x20-\x7e\t]\x00){5,}")
_WORD = re.compile(r"[A-Za-z]{3,}")


def _strings(data: bytes) -> str:
    """Last resort for unknown binary formats: recover the readable text runs."""
    runs = [m.group(0).decode("utf-16-le", "ignore") for m in _RUN_UTF16.finditer(data)]
    runs += [m.group(0).decode("latin-1") for m in _RUN_ASCII.finditer(data)]
    keep = [r.strip() for r in runs if _WORD.search(r) and sum(ch.isalnum() or ch.isspace() for ch in r) / len(r) > 0.75]
    return "\n".join(dict.fromkeys(k for k in keep if k))


def _strip_tags(xml: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", xml))


def _xml_paragraphs(xml: str, para: str, run: str) -> list[str]:
    out = []
    for block in re.split(rf"</{para}>", xml):
        text = "".join(html.unescape(t) for t in re.findall(rf"<{run}(?:\s[^>]*)?>([^<]*)</{run}>", block))
        if text.strip():
            out.append(text)
    return out


def _zip_read(z: zipfile.ZipFile, name: str, ctx: Context) -> bytes:
    info = z.getinfo(name)
    ctx.unpacked += info.file_size
    if ctx.unpacked > MAX_UNPACKED:
        raise Refused("This file unpacks to more than 60 MB, too large to check on this device.")
    return z.read(name)


# ------------------------------------------------------------------ format readers
def _read_pdf(data: bytes, ctx: Context) -> list[Part]:
    import pymupdf
    from PIL import Image
    pages = []
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception:
        raise Refused("This PDF is damaged or not a real PDF, so it is blocked.")
    with doc:
        if doc.needs_pass:
            raise Refused("This PDF is password-protected, so it cannot be read and is blocked.")
        for page in doc:
            text = page.get_text()
            scanned = not text.strip()
            has_picture = any(img[2] * img[3] >= 90_000 for img in page.get_images(full=True))
            if scanned or (has_picture and ctx.ocr_left > 0):
                pix = page.get_pixmap(dpi=150)
                ocr = _ocr(Image.frombytes("RGB", (pix.width, pix.height), pix.samples), ctx, strict=scanned)
                text = ocr if scanned else text + ("\n[Text read from pictures on this page]\n" + ocr if ocr.strip() else "")
            pages.append(text)
    ctx.kinds.append("pdf")
    return [("text", "\n".join(pages))]


def _read_docx(z, ctx):
    parts = []
    for n in z.namelist():
        if re.fullmatch(r"word/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml", n):
            parts += _xml_paragraphs(_zip_read(z, n, ctx).decode("utf-8", "replace"), "w:p", "w:t")
    ctx.kinds.append("docx")
    return [("text", "\n".join(parts + _embedded_images(z, ctx)))]


def _read_pptx(z, ctx):
    names = [n for n in z.namelist() if re.fullmatch(r"ppt/(slides|notesSlides|comments)/\w+\.xml", n)]
    parts = []
    for n in sorted(names, key=lambda n: (n.split("/")[1], int((re.search(r"(\d+)\.xml$", n) or [0, 0])[1]))):
        parts += _xml_paragraphs(_zip_read(z, n, ctx).decode("utf-8", "replace"), "a:p", "a:t")
    ctx.kinds.append("pptx")
    return [("text", "\n".join(parts + _embedded_images(z, ctx)))]


def _read_xlsx(data: bytes, z, ctx) -> list[Part]:
    import openpyxl
    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    except Exception:
        raise Refused("This workbook could not be opened on this device, so it is blocked.")
    parts: list[Part] = []
    total = 0
    for ws in wb.worksheets:
        rows = []
        for row in ws.iter_rows(values_only=True):
            if any(c not in (None, "") for c in row):
                rows.append(["" if c is None else c for c in row])
                total += 1
                if total > MAX_ROWS:
                    raise Refused(f"This workbook has more than {MAX_ROWS:,} rows, too many to check on this device.")
        if rows:
            parts.append(("table", rows))
    extra = _embedded_images(z, ctx)
    if extra:
        parts.append(("text", "\n".join(extra)))
    ctx.kinds.append("xlsx")
    return parts


def _read_odf(z, ctx) -> list[Part]:
    xml = _zip_read(z, "content.xml", ctx).decode("utf-8", "replace")
    ctx.kinds.append("opendocument")
    if "<table:table-row" in xml and "office:spreadsheet" in xml:
        rows = []
        for row in re.split(r"</table:table-row>", xml):
            cells = [_strip_tags(c).strip() for c in re.split(r"</table:table-cell>", row)][:-1]
            if any(cells):
                rows.append(cells)
        return [("table", rows)] if rows else []
    paras = [_strip_tags(p).strip() for p in re.split(r"</text:(?:p|h)>", xml)]
    return [("text", "\n".join(p for p in paras if p))]


def _read_ole(data: bytes, name: str, ctx: Context, depth: int) -> list[Part]:
    """Legacy Office (.doc, .xls, .ppt) and Outlook .msg files."""
    import olefile
    try:
        ole = olefile.OleFileIO(io.BytesIO(data))
    except Exception:
        raise Refused("This legacy Office file is damaged, so it is blocked.")
    with ole:
        streams = ["/".join(s) for s in ole.listdir()]
        if any(s in ("EncryptedPackage", "EncryptionInfo") for s in streams):
            raise Refused("This file is password-protected, so it cannot be read and is blocked.")
        if "Workbook" in streams or "Book" in streams:
            import xlrd
            try:
                book = xlrd.open_workbook(file_contents=data)
            except Exception:
                raise Refused("This Excel 97-2003 workbook could not be opened, so it is blocked.")
            ctx.kinds.append("xls")
            parts = []
            for sheet in book.sheets():
                rows = [[c for c in sheet.row_values(r)] for r in range(sheet.nrows)]
                rows = [r for r in rows if any(c not in (None, "") for c in r)]
                if rows:
                    parts.append(("table", rows))
            return parts
        if any(s.startswith("__substg1.0_") for s in streams):   # Outlook message
            ctx.kinds.append("msg")
            texts, parts = [], []
            for s in streams:
                if s.startswith("__substg1.0_") and s.endswith("001F"):
                    texts.append(ole.openstream(s).read().decode("utf-16-le", "ignore"))
                elif s.startswith("__substg1.0_") and s.endswith("001E"):
                    texts.append(ole.openstream(s).read().decode("cp1252", "ignore"))
                elif s.endswith("__substg1.0_37010102"):          # attachment body
                    parts += extract("attachment", ole.openstream(s).read(), ctx, depth + 1)
            return [("text", "\n".join(t for t in texts if t.strip()))] + parts
        ctx.kinds.append("legacy-office")
        wanted = [s for s in streams if s in ("WordDocument", "PowerPoint Document", "1Table", "0Table")] or streams
        text = "\n".join(_strings(ole.openstream(s).read()) for s in wanted)
    if len(text.strip()) < 20:
        raise Refused("No readable text could be recovered from this legacy Office file, so it is blocked.")
    return [("text", text)]


_RTF_SKIP = ("fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "themedata", "datastore", "generator", "*")


def _read_rtf(text: str) -> str:
    out, stack, skip, i, n = [], [], False, 0, len(text)
    while i < n:
        ch = text[i]
        if ch == "{":
            stack.append(skip)
            m = re.match(r"\{\\(\*|[a-z]+)", text[i:i + 24])
            if m and m.group(1) in _RTF_SKIP:
                skip = True
            i += 1
        elif ch == "}":
            skip = stack.pop() if stack else False
            i += 1
        elif ch == "\\":
            m = re.match(r"\\(?:'([0-9a-fA-F]{2})|u(-?\d+)\??|([a-zA-Z]+)(-?\d+)? ?|(.))", text[i:i + 40], re.S)
            if not m:
                i += 1
                continue
            if not skip:
                if m.group(1):
                    out.append(bytes([int(m.group(1), 16)]).decode("cp1252", "replace"))
                elif m.group(2):
                    out.append(chr(int(m.group(2)) % 65536))
                elif m.group(3) in ("par", "line", "row", "sect", "page"):
                    out.append("\n")
                elif m.group(3) in ("tab", "cell"):
                    out.append("\t")
                elif m.group(5) and m.group(5) in "\\{}":
                    out.append(m.group(5))
            i += m.end()
        else:
            if not skip and ch not in "\r\n":
                out.append(ch)
            i += 1
    return "".join(out)


def _read_email(data: bytes, ctx: Context, depth: int) -> list[Part]:
    msg = email.message_from_bytes(data, policy=email.policy.default)
    ctx.kinds.append("email")
    head = [f"{h}: {msg[h]}" for h in ("From", "To", "Cc", "Bcc", "Subject", "Date") if msg[h]]
    texts, parts = ["\n".join(head)], []
    for part in msg.walk():
        if part.is_multipart():
            continue
        payload = part.get_payload(decode=True) or b""
        if part.get_filename() or part.get_content_maintype() not in ("text", "multipart"):
            parts += _member(part.get_filename() or "attachment", payload, ctx, depth)
        elif part.get_content_subtype() == "html":
            texts.append(_strip_tags(re.sub(r"(?is)<(script|style).*?</\1>", "", payload.decode(part.get_content_charset() or "utf-8", "replace"))))
        else:
            texts.append(payload.decode(part.get_content_charset() or "utf-8", "replace"))
    return [("text", "\n".join(t for t in texts if t.strip()))] + parts


def _member(name: str, data: bytes, ctx: Context, depth: int) -> list[Part]:
    ctx.members += 1
    ctx.unpacked += len(data)
    if ctx.members > MAX_MEMBERS:
        raise Refused(f"This contains more than {MAX_MEMBERS} files, too many to check on this device.")
    if ctx.unpacked > MAX_UNPACKED:
        raise Refused("This unpacks to more than 60 MB, too large to check on this device.")
    if not data:
        return []
    try:
        return extract(name, data, ctx, depth + 1)
    except Refused as e:
        raise Refused(f"A file inside it was blocked ({PurePath(name).name}): {e}")


def _read_zip(data: bytes, name: str, ctx: Context, depth: int) -> list[Part]:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except Exception:
        raise Refused("This archive is damaged, so it is blocked.")
    with z:
        names = set(z.namelist())
        if any(i.flag_bits & 0x1 for i in z.infolist()):
            raise Refused("This archive is password-protected, so it cannot be read and is blocked.")
        if "word/document.xml" in names:
            return _read_docx(z, ctx)
        if "ppt/presentation.xml" in names:
            return _read_pptx(z, ctx)
        if "xl/workbook.xml" in names:
            return _read_xlsx(data, z, ctx)
        if "content.xml" in names and "mimetype" in names:
            return _read_odf(z, ctx)
        ctx.kinds.append("archive")
        parts = []
        for info in z.infolist():
            if not info.is_dir():
                parts += _member(info.filename, _zip_read(z, info.filename, ctx), ctx, depth)
        return parts


def _read_tar(data: bytes, ctx: Context, depth: int) -> list[Part]:
    ctx.kinds.append("archive")
    parts = []
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        for m in tar:
            if m.isfile():
                parts += _member(m.name, tar.extractfile(m).read(MAX_UNPACKED + 1), ctx, depth)
    return parts


def _read_delimited(text: str, ext: str) -> list[Part]:
    delim = "\t" if ext == ".tsv" else ","
    if ext == ".csv":
        try:
            delim = csv.Sniffer().sniff(text[:4000], delimiters=",;\t|").delimiter
        except csv.Error:
            pass
    rows = [r for r in csv.reader(io.StringIO(text), delimiter=delim) if r]
    return [("table", rows)] if rows else []


# ------------------------------------------------------------------ password protection
def is_password_protected(data: bytes) -> bool:
    """True when the file cannot be opened without a password: an encrypted PDF, an encrypted Office file
    (Word, Excel, PowerPoint), or a ZIP whose entries are encrypted."""
    head = data[:8]
    try:
        if b"%PDF-" in data[:1024]:
            import pymupdf
            with pymupdf.open(stream=data, filetype="pdf") as doc:
                return bool(doc.needs_pass)
        if head[:4] == b"PK\x03\x04":
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                infos = [i for i in z.infolist() if not i.is_dir()]
                return bool(infos) and all(i.flag_bits & 0x1 for i in infos)
        if head == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
            import olefile
            with olefile.OleFileIO(io.BytesIO(data)) as ole:
                streams = {"/".join(s) for s in ole.listdir()}
                return "EncryptedPackage" in streams or "EncryptionInfo" in streams
        if head[:6] == b"7z\xbc\xaf\x27\x1c" or head[:4] == b"Rar!":
            return False          # cannot be verified on this device
    except Exception:
        return False
    return False


# ------------------------------------------------------------------ dispatcher
def extract(name: str, data: bytes, ctx: Context, depth: int = 0) -> list[Part]:
    """Read one file by its content. Raises Refused when nothing trustworthy can be read."""
    if depth > MAX_DEPTH:
        raise Refused("Files are nested too deeply inside this archive to check.")
    ext = PurePath(name).suffix.lower()
    head = data[:16]

    if b"%PDF-" in data[:1024]:
        return _read_pdf(data, ctx)
    if head[:4] == b"PK\x03\x04":
        return _read_zip(data, name, ctx, depth)
    if head[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        return _read_ole(data, name, ctx, depth)
    if head[:2] == b"\x1f\x8b":
        try:
            inner = gzip.GzipFile(fileobj=io.BytesIO(data)).read(MAX_UNPACKED + 1)
        except Exception:
            raise Refused("This compressed file is damaged, so it is blocked.")
        return _member(PurePath(name).stem or "file", inner, ctx, depth)
    if data[257:262] == b"ustar":
        return _read_tar(data, ctx, depth)
    if data[:5] == b"{\\rtf":
        ctx.kinds.append("rtf")
        return [("text", _read_rtf(data.decode("cp1252", "replace")))]

    is_image_magic = (head[:3] == b"\xff\xd8\xff" or head[:8] == b"\x89PNG\r\n\x1a\n" or head[:4] in (b"GIF8", b"II*\x00", b"MM\x00*")
                      or head[:2] == b"BM" or (head[:4] == b"RIFF" and data[8:12] == b"WEBP") or data[4:12] in
                      (b"ftypheic", b"ftypheix", b"ftypmif1", b"ftypavif", b"ftypheim", b"ftypmsf1", b"ftyphevc"))
    if is_image_magic or (ext in IMAGE_EXT and _as_text(data) is None):
        return _read_image(data, ctx)

    text = _as_text(data)
    if text is not None:
        if ext == ".eml" or re.match(r"(?im)\A(?:[\w\-]+: .*\r?\n)*(?:MIME-Version|Received|Message-ID): ", text[:4000]):
            return _read_email(data, ctx, depth)
        if ext in (".csv", ".tsv"):
            ctx.kinds.append("csv")
            return _read_delimited(text, ext)
        ctx.kinds.append("text")
        return [("text", text)]

    # Unknown binary. Compressed, encrypted or media content has nothing to recover.
    if _entropy(data) > 7.2:
        raise Refused(f"This {ext or 'binary'} file is compressed, encrypted or media content that cannot be read on this device, so it is blocked.")
    recovered = _strings(data)
    if len(recovered) < 40:
        raise Refused(f"No readable text could be found in this {ext or 'binary'} file, so it is blocked.")
    ctx.kinds.append("binary-text")
    return [("text", recovered)]
