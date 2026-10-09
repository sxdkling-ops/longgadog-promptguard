"""Generates the promo's voiceover with Kokoro, an open-source neural text-to-speech model (Apache 2.0) that
runs on this PC through ONNX Runtime. One WAV per scene goes to public/vo/.

Setup (once):
  pip install kokoro-onnx soundfile
  download kokoro-v1.0.int8.onnx and voices-v1.0.bin into tts-models/ from
  https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0

Run from the video folder:
  python make-voiceover.py                 default voice
  python make-voiceover.py am_michael 1.0  another voice and speed
"""
import sys
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro

HERE = Path(__file__).parent
VOICE = sys.argv[1] if len(sys.argv) > 1 else "af_heart"
SPEED = float(sys.argv[2]) if len(sys.argv) > 2 else 1.05

# Written the way someone would say it to a friend, not the way it would be typed.
# Each entry: file name, scene id in src/Promo.tsx, the shortest the scene may be in frames (its on-screen animation
# has to finish), and the line.
LINES = [
    ("01-hook", "Hook", 85, "Okay, so you just pasted the whole customer list into a chatbot."),
    ("02-problem", "Problem", 95, "Names, tin numbers, passwords... gone."),
    ("03-meet", "Meet", 70, "So I got a guard dog. Meet Longga Dog!"),
    ("04-paste", "PasteDemo", 125, "Copy from Excel, paste into the chatbot, and it swaps the sensitive stuff for placeholders."),
    ("05-type", "TypeDemo", 135, "Type a password? It's replaced before you even hit send."),
    ("06-blocked", "Blocked", 135, "API keys get removed. And IDs? Blocked."),
    ("07-files", "Files", 115, "Uploads are read on your PC first, so the chatbot only gets a redacted copy."),
    ("08-email", "Email", 130, "Email's checked when you press send, and attachments need a password."),
    ("09-local", "Local", 90, "And it all runs on your own PC. A local language model, and local OCR."),
    ("10-strict", "Strict", 90, "No off switch. If the local AI isn't running, nothing goes out."),
    ("11-everywhere", "Everywhere", 95, "It guards what you paste into any app."),
    ("12-outro", "Outro", 80, "Longga Dog. Local AI, guarding cloud AI."),
]
FPS = 30
TOTAL = 60 * FPS          # the video is exactly one minute
LEAD, TAIL = 6, 12        # frames of quiet before and after each line

kokoro = Kokoro(str(HERE / "tts-models" / "kokoro-v1.0.int8.onnx"), str(HERE / "tts-models" / "voices-v1.0.bin"))
out = HERE / "public" / "vo"
out.mkdir(parents=True, exist_ok=True)


def speak(speed):
    """Generate every line at this speed. Returns the frames each scene needs."""
    need = []
    for name, _scene, shortest, text in LINES:
        samples, rate = kokoro.create(text, voice=VOICE, speed=speed, lang="en-us")
        sf.write(out / f"{name}.wav", samples, rate)
        frames = LEAD + round(len(samples) / rate * FPS + 0.5) + TAIL
        need.append((max(shortest, frames), len(samples) / rate))
    return need


# If the voice is too slow for everything to fit in a minute, speed it up a little at a time until it does.
speed = SPEED
need = speak(speed)
while sum(n for n, _ in need) > TOTAL and speed < 1.4:
    speed = round(speed + 0.05, 2)
    need = speak(speed)

# Hand any time left over to the scenes, longest first, so the video stays exactly one minute.
frames = [n for n, _ in need]
spare = TOTAL - sum(frames)
if spare < 0:
    sys.exit("These lines are too long for a one-minute video even at speed 1.4. Shorten a line.")
order = sorted(range(len(frames)), key=lambda i: -frames[i])
for k in range(spare):
    frames[order[k % len(order)]] += 1

rows = [f"  {scene}: {frames[i]}," for i, (_n, scene, _s, _t) in enumerate(LINES)]
timing = "\n".join([
    "// Written by make-voiceover.py. Scene lengths in frames, fitted to the current voiceover. Do not edit by hand.",
    "export const TIMING: Record<string, number> = {",
    *rows,
    "};",
    "",
])
(HERE / "src" / "timing.ts").write_text(timing, encoding="utf-8")

print(f"voice {VOICE}, speed {speed}" + ("" if speed == SPEED else f" (raised from {SPEED} so everything fits)"))
for i, (name, scene, _shortest, _text) in enumerate(LINES):
    print(f"{name:<15} voice {need[i][1]:5.2f} s   scene {frames[i] / FPS:5.2f} s")
print(f"total {sum(frames) / FPS:.1f} s. Scene lengths written to src/timing.ts. Now render the video.")
