import React from "react";
import { useCurrentFrame } from "remotion";
import { Caption, COLORS, enter, Hi, pop, Scene } from "../kit";

const TYPES = ["PDF", "Word", "Excel", "PowerPoint", "CSV", "Images", "Scans", "ZIP", "Email"];

/** Uploads: every file is read on the PC first, and only a redacted copy goes out. */
export const Files: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Scene background="#0f2a2a">
      <Caption top={150} style={enter(frame, 0)}>
        Uploads get <Hi color={COLORS.teal}>read first</Hi>
      </Caption>

      <div style={{ position: "absolute", left: 80, right: 80, top: 560, display: "flex", flexWrap: "wrap", gap: 22, justifyContent: "center" }}>
        {TYPES.map((type, i) => (
          <div
            key={type}
            style={{ fontSize: 50, fontWeight: 800, padding: "16px 34px", borderRadius: 20, background: "#fff", color: COLORS.ink, ...pop(frame, 12 + i * 4) }}
          >
            {type}
          </div>
        ))}
      </div>

      <Caption top={1090} size={72} style={enter(frame, 60)}>
        The chatbot gets a <Hi>redacted copy</Hi>.
      </Caption>
      <Caption top={1320} size={72} style={enter(frame, 76)}>
        The original never leaves.
      </Caption>
      <Caption top={1540} size={52} style={{ ...enter(frame, 92), fontWeight: 700, WebkitTextStroke: "0px" }}>
        Even the file name is replaced.
      </Caption>
    </Scene>
  );
};
