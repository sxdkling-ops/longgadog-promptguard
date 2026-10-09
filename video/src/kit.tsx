import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";

export const FPS = 30;
export const W = 1080;
export const H = 1920;

export const COLORS = {
  bg: "#0b1220",
  card: "#ffffff",
  ink: "#0f172a",
  muted: "#475569",
  teal: "#14b8a6",
  tealDark: "#0f766e",
  red: "#dc2626",
  yellow: "#fde047",
  line: "#e2e8f0",
};

export const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
export const MONO = '"Cascadia Mono", Consolas, "Courier New", monospace';

const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 0 → 1 over `dur` frames starting at `at`, with a soft landing. */
export const rise = (frame: number, at: number, dur = 12) =>
  interpolate(frame, [at, at + dur], [0, 1], { ...CLAMP, easing: Easing.bezier(0.16, 1, 0.3, 1) });

/** Style for something that fades and slides up into place at frame `at`. */
export const enter = (frame: number, at: number, distance = 60): React.CSSProperties => ({
  opacity: rise(frame, at),
  translate: `0px ${(1 - rise(frame, at)) * distance}px`,
});

/** Style for something that pops in with a little overshoot at frame `at`. */
export const pop = (frame: number, at: number): React.CSSProperties => ({
  opacity: rise(frame, at, 6),
  scale: interpolate(frame, [at, at + 8, at + 14], [0.6, 1.08, 1], CLAMP),
});

export const Scene: React.FC<{ children: React.ReactNode; background?: string }> = ({ children, background }) => (
  <AbsoluteFill style={{ background: background ?? COLORS.bg, fontFamily: FONT, color: "#fff" }}>{children}</AbsoluteFill>
);

/** Big, phone-video style caption: heavy white text with a dark outline. Wrap a word in <Hi> to highlight it. */
export const Caption: React.FC<{ children: React.ReactNode; top: number; size?: number; style?: React.CSSProperties }> = ({
  children,
  top,
  size = 92,
  style,
}) => (
  <div
    style={{
      position: "absolute",
      left: 80,
      right: 80,
      top,
      textAlign: "center",
      fontSize: size,
      fontWeight: 900,
      lineHeight: 1.12,
      letterSpacing: -1,
      WebkitTextStroke: "14px #000",
      paintOrder: "stroke fill",
      ...style,
    }}
  >
    {children}
  </div>
);

export const Hi: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color }) => (
  <span style={{ color: color ?? COLORS.yellow }}>{children}</span>
);

export const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div
    style={{
      background: COLORS.card,
      color: COLORS.ink,
      borderRadius: 36,
      padding: 40,
      boxShadow: "0 30px 60px rgba(0,0,0,.45)",
      ...style,
    }}
  >
    {children}
  </div>
);

export const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: COLORS.muted, marginBottom: 18 }}>
    {children}
  </div>
);

/** A placeholder chip such as [PERSON_1]. */
export const Chip: React.FC<{ children: React.ReactNode; tone?: "teal" | "red" }> = ({ children, tone = "teal" }) => (
  <span
    style={{
      fontFamily: MONO,
      fontWeight: 700,
      padding: "2px 14px",
      borderRadius: 12,
      background: tone === "red" ? "#fee2e2" : "#ccfbf1",
      color: tone === "red" ? "#991b1b" : "#115e59",
    }}
  >
    {children}
  </span>
);

/** The mascot's hand-drawn speech bubble. */
export const Bubble: React.FC<{ title: string; text?: string; angry?: boolean; style?: React.CSSProperties }> = ({ title, text, angry, style }) => (
  <div
    style={{
      position: "absolute",
      background: "#fff",
      color: "#111",
      border: "8px solid #111",
      borderRadius: "56px 68px 60px 50px / 64px 50px 68px 56px",
      padding: "34px 44px",
      boxShadow: "0 18px 30px rgba(0,0,0,.4)",
      ...style,
    }}
  >
    <div style={{ fontSize: 58, fontWeight: 900, lineHeight: 1.15, color: angry ? "#b91c1c" : "#111" }}>{title}</div>
    {text ? <div style={{ fontSize: 42, fontWeight: 600, color: "#334155", marginTop: 8 }}>{text}</div> : null}
    <svg width="110" height="74" viewBox="0 0 52 34" style={{ position: "absolute", left: 150, bottom: -66 }}>
      <path d="M8 0 H40" stroke="#fff" strokeWidth="7" />
      <path d="M6 1 C8 14 16 25 36 31 C28 21 30 10 40 1" fill="#fff" stroke="#111" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>
);
