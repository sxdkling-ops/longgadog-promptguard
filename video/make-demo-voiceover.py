"""Voiceover for the demo video (src/Demo.tsx), made on this PC with Kokoro. Same setup as make-voiceover.py.

Run from the video folder:
  python make-demo-voiceover.py              default voice
  python make-demo-voiceover.py af_heart 1.0 another voice and speed
"""
import sys
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro

HERE = Path(__file__).parent
VOICE = sys.argv[1] if len(sys.argv) > 1 else "am_michael"
SPEED = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
FPS = 30

LINES = [
    ("intro", "This is Prompt Guard P H. A real screen recording, with the network switched off."),
    ("net", "This banner is a live test. This PC cannot reach the internet."),
    ("check", "I check a lowercase Taglish name. Rules and a local language model replace the name, the client, "
              "the tin and the address, in about one second. Zero bytes go to a cloud detector."),
    ("copy", "Now the real leak. I copy customer rows from Excel."),
    ("paste", "I paste them into the browser. Only placeholders arrive, and Longga Dog barks."),
    ("gemini", "Network back on. The same rows, pasted into the real Gemini. Only placeholders arrive."),
    ("upload", "Then I try to upload a photo of an I D. It is read on this PC, and blocked."),
    ("local", "What runs on this PC? The detection rules, the language model, Qwen two point five on Ollama, "
              "the OCR, and the desktop guard. What needs internet? Nothing. Only the chatbot you were going to use anyway."),
    ("outro", "Prompt Guard P H. Local AI, guarding cloud AI."),
]

kokoro = Kokoro(str(HERE / "tts-models" / "kokoro-v1.0.int8.onnx"), str(HERE / "tts-models" / "voices-v1.0.bin"))
out = HERE / "public" / "vo-demo"
out.mkdir(parents=True, exist_ok=True)

rows = []
for name, text in LINES:
    samples, rate = kokoro.create(text, voice=VOICE, speed=SPEED, lang="en-us")
    sf.write(out / f"{name}.wav", samples, rate)
    frames = round(len(samples) / rate * FPS + 0.5)
    rows.append(f"  {name}: {frames},")
    print(f"{name:<6} {len(samples) / rate:5.2f} s")

(HERE / "src" / "demoTiming.ts").write_text("\n".join([
    "// Written by make-demo-voiceover.py. Length of each voiceover line in frames. Do not edit by hand.",
    "export const VOICE: Record<string, number> = {",
    *rows,
    "};",
    "",
]), encoding="utf-8")
