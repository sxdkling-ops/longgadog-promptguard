import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Dog } from "../Dog";
import { Caption, Card, Chip, COLORS, enter, Hi, Label, MONO, pop, Scene } from "../kit";

const KEY_AT = 50;
const ID_AT = 110;

/** Secrets are removed outright, and identity documents never leave. The key shown is made up. */
export const Blocked: React.FC = () => {
  const frame = useCurrentFrame();
  const fade = (at: number) => interpolate(frame, [at, at + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Scene>
      <Caption top={110} size={88} style={enter(frame, 0)}>
        API keys? <Hi color={COLORS.red}>Removed.</Hi>
        <br />
        IDs? <Hi color={COLORS.red}>Blocked.</Hi>
      </Caption>

      <Card style={{ position: "absolute", left: 70, right: 70, top: 500, ...enter(frame, 12, 100) }}>
        <Label>Pasted an API key</Label>
        <div style={{ position: "relative", height: 60, fontFamily: MONO, fontSize: 36 }}>
          <div style={{ position: "absolute", opacity: 1 - fade(KEY_AT) }}>GROQ gsk_Xk29fQmB7vLtR4wZ8nH1cY6d…</div>
          <div style={{ position: "absolute", opacity: fade(KEY_AT) }}>
            GROQ <Chip tone="red">[SECRET_REMOVED]</Chip>
          </div>
        </div>
      </Card>

      <Card style={{ position: "absolute", left: 70, right: 70, top: 850, ...enter(frame, 70, 100) }}>
        <Label>Tried to upload</Label>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div style={{ width: 150, height: 110, borderRadius: 16, background: "linear-gradient(135deg,#1e3a8a,#b91c1c)", flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 44, fontWeight: 800 }}>PASSPORT.jpg</div>
            <div style={{ fontSize: 34, color: COLORS.muted }}>Read on this PC with local OCR</div>
          </div>
        </div>
        <div
          style={{
            marginTop: 26,
            padding: "20px 28px",
            borderRadius: 20,
            background: "#fee2e2",
            color: "#991b1b",
            fontSize: 38,
            fontWeight: 800,
            opacity: fade(ID_AT),
          }}
        >
          Blocked. Identity documents are never sent.
        </div>
      </Card>

      <div style={{ position: "absolute", left: 330, top: 1400, ...pop(frame, 20) }}>
        <Dog size={420} mood={frame >= KEY_AT ? "angry" : "idle"} lookY={-0.8} />
      </div>
    </Scene>
  );
};
