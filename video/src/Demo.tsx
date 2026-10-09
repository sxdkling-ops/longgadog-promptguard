import React from "react";
import { Audio, Video } from "@remotion/media";
import { AbsoluteFill, Sequence, Series, staticFile, useCurrentFrame } from "remotion";
import { VOICE } from "./demoTiming";
import { COLORS, FONT, MONO, enter, rise } from "./kit";

export const DEMO_W = 1920;
export const DEMO_H = 1080;
const FPS = 30;

type Clip = { id: string; src: string; net: string; from: number; to: number; min: number; delay: number; sound: boolean; on: number[]; caption: React.ReactNode };

/** The parts of the screen recording (public/demo.mp4), in seconds of the recording. Each is slowed or sped up so
 *  it lasts as long as its voiceover line. `on` lists the right-hand rows that are lit while it plays. */
const CLIPS: Clip[] = [
  { id: "net", src: "demo.mp4", net: "Off", from: 0, to: 2.7, min: 0, delay: 8, sound: false, on: [], caption: "Network is off. A live test, not a setting." },
  { id: "check", src: "demo.mp4", net: "Off", from: 2.7, to: 9.5, min: 0, delay: 8, sound: false, on: [0, 1], caption: "Rules and a local LLM replace 4 items in about 1 second." },
  { id: "copy", src: "demo.mp4", net: "Off", from: 9.5, to: 20.8, min: 0, delay: 8, sound: false, on: [], caption: "Copy customer rows from Excel…" },
  // The bark is in the recording's own sound, so the voice waits for it.
  { id: "paste", src: "demo.mp4", net: "Off", from: 20.8, to: 28.7, min: 237, delay: 62, sound: true, on: [3], caption: "…paste into the browser. Only placeholders arrive." },
  // Second recording (public/demo2.mp4): the live Gemini site, so the network is on. The cuts avoid the file picker.
  { id: "gemini", src: "demo2.mp4", net: "On", from: 8.5, to: 17.5, min: 270, delay: 8, sound: true, on: [0, 3], caption: "Same rows, pasted into the real Gemini: placeholders only." },
  { id: "upload", src: "demo2.mp4", net: "On", from: 29.6, to: 38.0, min: 250, delay: 8, sound: true, on: [2, 3], caption: "An ID photo is read on this PC and blocked." },
];

const clipFrames = (c: Clip) => Math.max(c.min, c.delay + VOICE[c.id] + 14);
const INTRO = VOICE.intro + 24;
const LOCAL = VOICE.local + 30;
const OUTRO = VOICE.outro + 36;
/** The one-minute vertical promo (public/promo.mp4) opens the video, shown upright in the middle of the frame. */
const PROMO = 60 * FPS;
export const DEMO_FRAMES = PROMO + INTRO + CLIPS.reduce((n, c) => n + clipFrames(c), 0) + LOCAL + OUTRO;

const LOCAL_ROWS = [
  ["Detection rules", "Python, in the gateway"],
  ["Local LLM", "qwen2.5:3b on Ollama"],
  ["Local OCR", "RapidOCR on ONNX Runtime"],
  ["Desktop guard", "LonggaDog, Electron"],
] as const;

const Check: React.FC<{ size?: number }> = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={COLORS.teal} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const Voice: React.FC<{ id: string; from: number }> = ({ id, from }) => (
  <Sequence from={from} layout="none" name="Voiceover">
    <Audio src={staticFile(`vo-demo/${id}.wav`)} />
  </Sequence>
);

const Title: React.FC<{ voice: string; kicker: string; title: string; sub: string }> = ({ voice, kicker, title, sub }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: COLORS.bg, color: "#fff", fontFamily: FONT, alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <div style={{ ...enter(frame, 0, 30), fontSize: 30, fontWeight: 700, letterSpacing: 4, color: COLORS.teal }}>{kicker}</div>
      <div style={{ ...enter(frame, 5, 40), fontSize: 120, fontWeight: 800, letterSpacing: -2, marginTop: 12 }}>{title}</div>
      <div style={{ ...enter(frame, 12, 40), fontSize: 42, color: "#cbd5e1", marginTop: 20 }}>{sub}</div>
      <Voice id={voice} from={8} />
    </AbsoluteFill>
  );
};

const Recording: React.FC<{ clip: Clip }> = ({ clip }) => {
  const frame = useCurrentFrame();
  const rate = ((clip.to - clip.from) * FPS) / clipFrames(clip);
  const label: React.CSSProperties = { fontSize: 20, fontWeight: 700, letterSpacing: 2, color: COLORS.teal, marginTop: 6 };
  return (
    <AbsoluteFill style={{ background: COLORS.bg, color: "#fff", fontFamily: FONT }}>
      <div style={{ position: "absolute", left: 24, top: 24, width: 1500, height: 906, borderRadius: 16, overflow: "hidden", border: "2px solid #334155" }}>
        <Video
          src={staticFile(clip.src)}
          trimBefore={Math.round(clip.from * FPS)}
          trimAfter={Math.round(clip.to * FPS)}
          playbackRate={rate}
          muted={!clip.sound}
          style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
        />
      </div>
      {rate > 1.2 ? (
        <div style={{ position: "absolute", left: 44, top: 44, padding: "6px 14px", borderRadius: 999, background: "rgba(15,23,42,.85)", fontSize: 22, fontWeight: 700 }}>
          Sped up {rate.toFixed(1)}×
        </div>
      ) : null}

      <div style={{ position: "absolute", left: 1548, top: 24, width: 348, height: 906, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ padding: "16px 20px", borderRadius: 16, background: clip.net === "Off" ? "#052e16" : "#1e293b", border: `2px solid ${clip.net === "Off" ? "#166534" : "#64748b"}` }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 2, color: clip.net === "Off" ? "#86efac" : "#cbd5e1" }}>NETWORK</div>
          <div style={{ fontSize: 44, fontWeight: 800 }}>{clip.net}</div>
          {clip.net === "Off" ? null : <div style={{ fontSize: 19, color: "#cbd5e1" }}>Live Gemini site</div>}
        </div>
        <div style={label}>RUNS ON THIS PC</div>
        {LOCAL_ROWS.map(([name, detail], i) => {
          const lit = clip.on.includes(i);
          return (
            <div
              key={name}
              style={{ display: "flex", gap: 12, padding: "14px 16px", borderRadius: 14, background: lit ? "#134e4a" : "#1e293b", border: `2px solid ${lit ? COLORS.teal : "#334155"}` }}
            >
              <div style={{ marginTop: 4 }}>
                <Check />
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.2 }}>{name}</div>
                <div style={{ fontSize: 19, color: "#cbd5e1", fontFamily: MONO }}>{detail}</div>
              </div>
            </div>
          );
        })}
        <div style={label}>SENT TO A CLOUD DETECTOR</div>
        <div style={{ padding: "14px 16px", borderRadius: 14, border: "2px dashed #64748b", fontSize: 34, fontWeight: 800 }}>Nothing</div>
        <div style={{ marginTop: "auto", fontSize: 19, color: "#94a3b8", lineHeight: 1.35 }}>{clip.id === "upload" ? "Real screen recording." : "Real screen recording. Fictional data only."}</div>
      </div>

      <div
        style={{ position: "absolute", left: 24, right: 24, top: 950, height: 106, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontSize: 50, fontWeight: 700, opacity: rise(frame, 2, 10) }}
      >
        {clip.caption}
      </div>
      <Voice id={clip.id} from={clip.delay} />
    </AbsoluteFill>
  );
};

const PromoPart: React.FC = () => {
  const side: React.CSSProperties = { position: "absolute", top: 0, bottom: 0, width: 596, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 56px" };
  const kicker: React.CSSProperties = { fontSize: 24, fontWeight: 700, letterSpacing: 3, color: COLORS.teal };
  return (
    <AbsoluteFill style={{ background: COLORS.bg, color: "#fff", fontFamily: FONT }}>
      <div style={{ ...side, left: 0 }}>
        <div style={kicker}>PART 1 · THE IDEA</div>
        <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, marginTop: 14 }}>PromptGuard PH</div>
        <div style={{ fontSize: 32, color: "#cbd5e1", marginTop: 18, lineHeight: 1.3 }}>Local AI that stops sensitive data before it leaves your PC.</div>
      </div>
      <Video src={staticFile("promo.mp4")} style={{ position: "absolute", left: 656, top: 0, width: 608, height: 1080 }} />
      <div style={{ ...side, right: 0 }}>
        <div style={kicker}>UP NEXT · PART 2</div>
        <div style={{ fontSize: 52, fontWeight: 800, lineHeight: 1.1, marginTop: 14 }}>The real app, recorded with the network off</div>
        <div style={{ fontSize: 26, color: "#94a3b8", marginTop: 18, lineHeight: 1.35 }}>Part 1 is an animated explainer. Part 2 is a real screen recording.</div>
      </div>
    </AbsoluteFill>
  );
};

const LocalCard: React.FC = () => {
  const frame = useCurrentFrame();
  const col: React.CSSProperties = { flex: 1, padding: 44, borderRadius: 28, background: "#1e293b", border: "2px solid #334155" };
  const head: React.CSSProperties = { fontSize: 26, fontWeight: 700, letterSpacing: 3, color: COLORS.teal, marginBottom: 22 };
  return (
    <AbsoluteFill style={{ background: COLORS.bg, color: "#fff", fontFamily: FONT, padding: 80, gap: 40, flexDirection: "row", alignItems: "stretch" }}>
      <div style={{ ...col, flex: 1.35 }}>
        <div style={head}>RUNS ON THIS PC</div>
        {LOCAL_ROWS.map(([name, detail], i) => (
          <div key={name} style={{ ...enter(frame, 30 + i * 45, 30), display: "flex", gap: 20, alignItems: "center", marginBottom: 30 }}>
            <Check size={48} />
            <div>
              <div style={{ fontSize: 52, fontWeight: 700, lineHeight: 1.15 }}>{name}</div>
              <div style={{ fontSize: 30, color: "#cbd5e1", fontFamily: MONO }}>{detail}</div>
            </div>
          </div>
        ))}
        <div style={{ ...enter(frame, 220, 30), fontSize: 30, color: "#cbd5e1", marginTop: 12 }}>
          Also on this PC: file and image reading, ID blocking, the audit log (counts only).
        </div>
      </div>
      <div style={{ ...col, ...enter(frame, 290, 30), display: "flex", flexDirection: "column" }}>
        <div style={head}>NEEDS INTERNET</div>
        <div style={{ fontSize: 110, fontWeight: 800, lineHeight: 1 }}>Nothing</div>
        <div style={{ fontSize: 34, color: "#cbd5e1", marginTop: 24, lineHeight: 1.35 }}>
          Only the chatbot, email or chat app you were going to use anyway. It receives the sanitized copy.
        </div>
        <div style={{ marginTop: "auto", fontSize: 28, color: "#94a3b8", lineHeight: 1.35 }}>Shown with the network off: 0 connections leaving this PC.</div>
      </div>
      <Voice id="local" from={10} />
    </AbsoluteFill>
  );
};

export const Demo: React.FC = () => (
  <Series>
    <Series.Sequence durationInFrames={PROMO} name="Promo">
      <PromoPart />
    </Series.Sequence>
    <Series.Sequence durationInFrames={INTRO} name="Intro">
      <Title voice="intro" kicker="PART 2 · THE REAL APP" title="PromptGuard PH" sub="Real screen recording. Network off. Fictional data." />
    </Series.Sequence>
    {CLIPS.map((clip) => (
      <Series.Sequence key={clip.id} durationInFrames={clipFrames(clip)} name={clip.id}>
        <Recording clip={clip} />
      </Series.Sequence>
    ))}
    <Series.Sequence durationInFrames={LOCAL} name="Local">
      <LocalCard />
    </Series.Sequence>
    <Series.Sequence durationInFrames={OUTRO} name="Outro">
      <Title voice="outro" kicker="LONGGADOG IS ON GUARD" title="PromptGuard PH" sub="Local AI, guarding cloud AI." />
    </Series.Sequence>
  </Series>
);
