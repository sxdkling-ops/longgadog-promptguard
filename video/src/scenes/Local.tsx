import React from "react";
import { useCurrentFrame } from "remotion";
import { Caption, COLORS, enter, Hi, Scene } from "../kit";

const PARTS: [string, string][] = [
  ["Local LLM", "Qwen2.5 3B on Ollama"],
  ["Local OCR", "RapidOCR on ONNX Runtime"],
  ["PH rules", "TIN, SSS, PhilHealth, Pag-IBIG"],
];

/** Why it has to be local: the detector reads the secret, so it cannot live in the cloud. */
export const Local: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Scene background="#0f2a2a">
      <Caption top={150} style={enter(frame, 0)}>
        The checking happens <Hi color={COLORS.teal}>on your PC</Hi>
      </Caption>

      {PARTS.map(([title, detail], i) => (
        <div
          key={title}
          style={{
            position: "absolute",
            left: 80,
            right: 80,
            top: 640 + i * 250,
            background: "#fff",
            color: COLORS.ink,
            borderRadius: 32,
            borderLeft: `18px solid ${COLORS.teal}`,
            padding: "34px 44px",
            ...enter(frame, 16 + i * 12, 90),
          }}
        >
          <div style={{ fontSize: 60, fontWeight: 900 }}>{title}</div>
          <div style={{ fontSize: 42, color: COLORS.muted, fontWeight: 600 }}>{detail}</div>
        </div>
      ))}

      <Caption top={1480} size={70} style={enter(frame, 62)}>
        No cloud detector.
        <br />
        Nothing kept.
      </Caption>
    </Scene>
  );
};
