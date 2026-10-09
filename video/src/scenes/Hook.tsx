import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Caption, Card, COLORS, enter, Hi, Label, MONO, pop, Scene } from "../kit";

const ROWS = ["Maria Santos, 123-456-789-000, 0917 555 0142", "Paolo Mendoza, 234-567-890-000, 0918 555 0199", "Liza Reyes, 345-678-901-000, 0920 555 0111"];

/** The hook: the moment everyone recognises. Fictional customer rows sitting in a chatbot box, about to be sent. */
export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Scene>
      <Caption top={170} style={enter(frame, 0)}>
        POV: you just pasted the <Hi>customer list</Hi> into a chatbot
      </Caption>

      <Card style={{ position: "absolute", left: 70, right: 70, top: 800, ...enter(frame, 14, 120) }}>
        <Label>Message</Label>
        {ROWS.map((row, i) => (
          <div
            key={row}
            style={{
              fontFamily: MONO,
              fontSize: 30,
              padding: "14px 0",
              borderTop: i ? `2px solid ${COLORS.line}` : "none",
              opacity: interpolate(frame, [24 + i * 8, 32 + i * 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            }}
          >
            {row}
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 26 }}>
          <div style={{ background: COLORS.ink, color: "#fff", fontSize: 40, fontWeight: 800, padding: "18px 48px", borderRadius: 999 }}>Send ↑</div>
        </div>
      </Card>

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 1380,
          textAlign: "center",
          fontSize: 150,
          fontWeight: 900,
          color: COLORS.red,
          rotate: "-8deg",
          WebkitTextStroke: "10px #fff",
          paintOrder: "stroke fill",
          ...pop(frame, 62),
        }}
      >
        LEAKED
      </div>
    </Scene>
  );
};
