import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Dog } from "../Dog";
import { Bubble, Caption, Card, Chip, COLORS, enter, Hi, Label, MONO, pop, Scene } from "../kit";

const RAW = ["Maria Santos, 123-456-789-000, 0917 555 0142", "Paolo Mendoza, 234-567-890-000, 0918 555 0199", "Liza Reyes, 345-678-901-000, 0920 555 0111"];
const SWAP = 84; // frame at which the pasted text arrives already sanitized

/** The core demo: copy rows in Excel, paste into a chatbot, and placeholders arrive instead. */
export const PasteDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const stopped = frame >= SWAP + 6;
  return (
    <Scene>
      <Caption top={110} size={84} style={enter(frame, 0)}>
        Copy in Excel. <Hi>Paste</Hi> in the chatbot.
      </Caption>

      <Card style={{ position: "absolute", left: 70, right: 70, top: 420, ...enter(frame, 10, 100) }}>
        <Label>Copied from Excel</Label>
        {RAW.map((row, i) => (
          <div key={row} style={{ fontFamily: MONO, fontSize: 30, padding: "12px 0", borderTop: i ? `2px solid ${COLORS.line}` : "none" }}>
            {row}
          </div>
        ))}
      </Card>

      <div style={{ position: "absolute", left: 0, right: 0, top: 800, textAlign: "center", fontSize: 110, fontWeight: 900, color: COLORS.teal, ...pop(frame, 46) }}>↓</div>

      <Card style={{ position: "absolute", left: 70, right: 70, top: 950, ...enter(frame, 56, 100) }}>
        <Label>What the chatbot receives</Label>
        {[1, 2, 3].map((n, i) => (
          <div
            key={n}
            style={{
              fontSize: 34,
              padding: "12px 0",
              borderTop: i ? `2px solid ${COLORS.line}` : "none",
              opacity: interpolate(frame, [SWAP + i * 5, SWAP + 8 + i * 5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            }}
          >
            <Chip>[PERSON_{n}]</Chip>, <Chip>[TIN_{n}]</Chip>, <Chip>[PHONE_{n}]</Chip>
          </div>
        ))}
      </Card>

      <div style={{ position: "absolute", left: 600, top: 1440, ...pop(frame, 20) }}>
        <Dog size={420} mood={stopped ? "angry" : "idle"} lookX={-0.7} lookY={-0.6} />
      </div>
      {stopped ? <Bubble title="WOOF! WOOF!" text="9 items replaced" angry style={{ left: 70, top: 1390, width: 560, ...pop(frame, SWAP + 6) }} /> : null}
    </Scene>
  );
};
