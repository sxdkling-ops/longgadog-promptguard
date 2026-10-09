# PromptGuard PH

A local AI guard dog for your desktop. **LonggaDog**, a floating mascot, watches every app on the PC, browsers included. Whatever you
copy is checked on the device by rules, a local LLM and local OCR, and anything you paste outside trusted work apps
arrives sanitized. In the browser, a small sensor extension lets the mascot also check typed text and uploads.

It is an absolute guard: redaction is automatic, there is nothing for the user to approve, switch off or configure, and
PromptGuard keeps no confidential value.

Built for the AppBuildersPH Hackathon 2026 (theme: Local AI). Diagrams, data flows, limits and the deployment design are
in [ARCHITECTURE.md](ARCHITECTURE.md). `scripts/start-gateway.ps1` checks the local AI layer and starts the gateway.

## One guard: the desktop mascot

The desktop app (`desktop/`, Electron) is the guard the user sees. It starts the local gateway, replaces it if it is out of
date, and shows the mascot.

| What you do | What the guard does |
|---|---|
| Copy text or an image in any app | Checks it in the background with rules, the local LLM and local OCR. Nothing changes yet. |
| Switch to a trusted work app (File Explorer, Excel, Word, PowerPoint, Notepad, editors, terminals, PDF readers) | Leaves the original on the clipboard. |
| Switch to anything else: any browser and any site, Viber, Telegram, Discord, WhatsApp, Teams, Outlook, AI apps, unknown apps | Swaps the clipboard for the sanitized copy. If the check has not finished, failed, or was refused, the clipboard is emptied. The dog barks and says what was replaced. |
| Switch back to the window you copied from | Puts the original back. A browser tab counts as its own window. |
| Copy files | They can be pasted only into trusted apps. |
| Jump to a guarded app, or click into a text box there | The dog shows a reminder, at most once per app every five minutes. |

Start it with `cd desktop && npm install && npm start` (development, with a Quit item) or `npm run guard` (no Quit
item). `npm test` runs its logic tests. The trusted list is `desktop/apps.json`.

### The browser sensor

Inside a browser the mascot needs a sensor to see what never touches the clipboard. The sensor is the extension in
`extension/`. With it loaded, typed text, pasted text and uploaded files are checked in the page on every website,
email subject and body are checked at Send, and email attachments must be password-protected. It draws nothing on the
page: everything it has to say comes out of the mascot's speech bubbles.

A browser cannot be made to install an extension from outside, by design. So:

- **Hackathon and single PCs:** load it once. Right-click the mascot, choose "Set up browser sensor", and follow the
  steps (open `chrome://extensions`, turn on Developer mode, "Load unpacked", pick the `extension` folder).
- **Company rollout:** IT force-installs it through managed Chrome policy, so staff cannot remove or disable it.

The mascot knows whether the sensor is connected. When the browser in front has none, it says so, at most once every
five minutes, and the status bubble shows "Browser sensor: Not connected".

### What is still not covered

- Typed text and file uploads inside desktop apps such as Viber, Telegram and Discord. The mascot reminds the user.
- Browsers that cannot load the sensor (Firefox), and any browser where it has not been set up: clipboard only.
- Files inserted from cloud storage inside a web app (Gmail "Insert from Drive", Outlook from OneDrive).
- A paste made within about a tenth of a second of switching windows can beat the clipboard swap.

## Why this needs local AI

The detector has to read the sensitive text before it is sent. If the detector ran in the cloud, the data would already
have leaked. Rules catch structured IDs; the local LLM catches what rules cannot: lowercase names, Taglish context,
addresses, and which spreadsheet columns hold people.

## How it works

1. **Watch** – the desktop app notices what is copied and which window is in front.
2. **Read** – the gateway reads every file locally and decides what it is from its contents, not its name, so a
   renamed file is still read correctly:
   - Text of any kind: plain text, source code, JSON, XML, HTML, YAML, logs, legacy Windows encodings.
   - Tables: CSV, TSV, Excel (`.xlsx`, `.xlsm`, legacy `.xls`), OpenDocument spreadsheets.
   - Documents: PDF, Word (`.docx`, including headers, footers, footnotes and comments), PowerPoint (`.pptx`, including
     speaker notes), OpenDocument text, RTF, legacy `.doc` and `.ppt` (text recovery).
   - Images: PNG, JPEG, WebP, BMP, GIF, TIFF, HEIC, AVIF and others, read with a local OCR model (RapidOCR on ONNX
     Runtime). Scanned PDF pages and pictures embedded in PDF, Word, PowerPoint and Excel files are read the same way.
   - Containers: ZIP, TAR, GZIP, emails (`.eml`) and Outlook messages (`.msg`) are opened and every file or attachment
     inside is read. If one member has to be blocked, the whole upload is blocked.
   - Anything else: readable text is recovered from the bytes. If there is none (media, compressed, encrypted or
     password-protected content), the upload is blocked.
3. **Detect** – rules → admin client list → local LLM → local LLM column classification for spreadsheets. A value
   caught once is replaced everywhere it appears. Coverage by business area:
   - Everyone: names, emails, PH phone numbers, addresses, birth dates, government IDs (TIN, SSS, PhilHealth, Pag-IBIG,
     UMID, PhilSys, passport), labelled reference numbers.
   - Healthcare: patient and doctor names, diagnoses, medications, test results, age, sex, blood type, HMO numbers.
   - IT: passwords, API keys and tokens (AWS, GitHub, GitLab, OpenAI, Google, Stripe, Slack, SendGrid, npm, JWT, Bearer),
     private keys, connection strings, OTP/PIN/CVV, IP and MAC addresses, internal hostnames, usernames, home paths.
   - Customers and finance: client-list names, card and bank account numbers, employers, salary and income figures.
4. **Replace** – secrets are removed, everything else becomes a typed placeholder (`[PERSON_1]`, `[TIN_1]`). The original
   file is never passed on: a single table goes out as a redacted CSV, everything else as redacted text. Every upload
   is renamed (`file-1.txt`), because file names often carry a person or client name. A name found in one part of an
   upload (for example a spreadsheet column) is also replaced everywhere else in that upload.
5. **Keep nothing** – detected values are not stored or shown anywhere. A session only remembers salted hashes so the
   same value gets the same placeholder. There is no restore: answers keep their placeholders.

The user sees a status pill and short notices ("3 items replaced before sending"). None of it is clickable.

Strict and fail-closed. Nothing is sent when:

- the gateway is down, or the local AI layer is not running or fails part-way;
- the text or document is too long to be checked in full (about 70,000 characters);
- a file cannot be read, an image has no readable text, or its text is too unclear to trust;
- an image or scanned page looks like a government ID or civil document (passport, licence, birth certificate).

## Run it

Requires Python 3.12 and, for the LLM layer, [Ollama](https://ollama.com).

```
pip install -r gateway/requirements.txt
ollama pull qwen2.5:3b
python -m uvicorn app:app --app-dir gateway --host 127.0.0.1 --port 8787
```

- Audit overview: http://127.0.0.1:8787/dashboard
- Detection policy and client list: http://127.0.0.1:8787/policy
- Desktop guard: `cd desktop && npm install && npm start`.

`demo/customers.csv` holds fictional records for the upload demo. Never demo with real documents.

Use another model with `PG_MODEL=qwen2.5:7b` (environment variable) before starting the gateway.

## What runs locally / what needs internet

| Runs locally | Needs internet |
|---|---|
| All detection (rules, client list, LLM via Ollama) | The cloud chatbot itself |
| File text extraction, OCR and sanitizing | One-time model download (`ollama pull`) |
| Audit log (SQLite, categories and counts only) | |

## Accuracy

`python eval/formats_test.py` generates one sample per file format (31 in all) and checks that none of the planted
names, IDs, emails or keys survive. `python eval/run_eval.py` (add `--llm` for the LLM layer) measures detection. The set is 46 synthetic prompts in English, Tagalog and
Taglish covering general, healthcare, IT and customer cases. The team wrote it alongside the rules, so treat it as a
regression check, not an independent benchmark.

| Layers | Structured recall | Contextual recall | False positives | Median latency | Hardware |
|---|---|---|---|---|---|
| Rules + client list | 41/41 | 18/24 | 0 | 0.1 ms | Intel Core Ultra 5 235U, 32 GB RAM, no GPU |
| + local LLM (qwen2.5:3b, CPU) | 41/41 | 23/24 | 0 | 870 ms (max 3.9 s) | same |

Contextual means names, organisations, addresses and health details in free text. The one remaining miss is the second
first name in "nina Bea at Marco". OCR of a one-page image takes about 3 to 6 seconds on the same hardware.

## Known limits

- Every upload reaches the chatbot as text or CSV, so layout, charts, formulas and pictures are lost.
- Legacy `.doc`, `.ppt`, `.xls` and `.msg`, and HEIC and AVIF images, are implemented but were not tested with real files.
- Audio and video are blocked: there is no local speech-to-text.
- In a spreadsheet, free-text columns such as Remarks are checked by rules only, not by the LLM.
- Images go out as redacted text, never as the picture. OCR can misread or drop spaces, so unclear images are blocked.
- Detection is by pattern and a small local model. It reduces leaks sharply; it cannot promise to catch every
  confidential fact, for example an unlabelled trade secret written in plain words.
- Source code is allowed through with secrets, IPs, hosts and usernames removed. Blocking code outright is a policy
  choice left to the company.
- PDF, Word and PowerPoint lose their layout: the chatbot gets plain redacted text.
- Free-text names depend on the local LLM. A bare name with no label or marker word can be missed, most likely in long
  files. Documents longer than the LLM can read in full are blocked instead of sent partly checked.
- Unlabelled dates and amounts are left in so answers stay useful. Labelled ones (birth date, age, salary) are replaced.
- On mail and chat, every name in an outgoing message becomes a placeholder, including the recipient's own name in
  the greeting. That is what strict guarding means; a company may prefer to warn instead of replace on mail.
- The gateway has to read the text and files in memory to detect anything; it does not keep them after responding.
- The audit dashboard and client list are for the administrator, on the gateway machine. They show counts only.

## Disclosures

- Models: Qwen2.5 3B via Ollama.
- Models: RapidOCR (PP-OCR ONNX models bundled in `rapidocr-onnxruntime`) for images.
- Libraries: FastAPI, Uvicorn, Pydantic, PyMuPDF, openpyxl, xlrd, olefile, Pillow, pillow-heif, rapidocr-onnxruntime,
  ONNX Runtime, OpenCV. python-docx is used only to generate a test sample. Extension is plain JavaScript (Manifest V3).
- Cloud services: none required. The protected chatbot is the only cloud component.
- AI development tools: Claude Code.
- Existing code or assets: none. The mascot is an original character drawn as vector shapes in `desktop/mascot.html`
  during the hackathon.
- Desktop app: Electron 33.
- Promo video (`video/`): Remotion 4 with React and TypeScript. Voiceover generated locally with the Kokoro
  text-to-speech model (Apache 2.0) through `kokoro-onnx`; the model files are not in the repository.
