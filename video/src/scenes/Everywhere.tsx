import React from "react";
import { useCurrentFrame } from "remotion";
import { Caption, COLORS, enter, Hi, pop, Scene } from "../kit";

const APPS = ["ChatGPT", "Gemini", "Claude", "Gmail", "Outlook", "Viber", "Telegram", "Discord", "WhatsApp", "Teams"];

/** It guards the clipboard for every app, and gives the original back in trusted work apps. */
export const Everywhere: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Scene>
      <Caption top={150} style={enter(frame, 0)}>
        It guards what you paste into <Hi>any app</Hi>
      </Caption>

      <div style={{ position: "absolute", left: 80, right: 80, top: 640, display: "flex", flexWrap: "wrap", gap: 24, justifyContent: "center" }}>
        {APPS.map((app, i) => (
          <div
            key={app}
            style={{
              fontSize: 52,
              fontWeight: 800,
              padding: "18px 38px",
              borderRadius: 999,
              background: "#fff",
              color: COLORS.ink,
              ...pop(frame, 12 + i * 4),
            }}
          >
            {app}
          </div>
        ))}
      </div>

      <Caption top={1250} size={72} style={enter(frame, 62)}>
        Paste back in Excel?
        <br />
        You get the <Hi color={COLORS.teal}>original</Hi>.
      </Caption>
    </Scene>
  );
};
