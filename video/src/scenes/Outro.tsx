import React from "react";
import { useCurrentFrame } from "remotion";
import { Dog } from "../Dog";
import { Bubble, Caption, COLORS, enter, Hi, pop, Scene } from "../kit";

/** Sign-off. */
export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Scene background="#0f2a2a">
      <Bubble title="Paste safely." text="LonggaDog's got your clipboard." style={{ left: 150, top: 230, width: 780, ...pop(frame, 14) }} />
      <div style={{ position: "absolute", left: 240, top: 640, ...pop(frame, 4) }}>
        <Dog size={600} mood="happy" />
      </div>
      <Caption top={1290} size={110} style={enter(frame, 24)}>
        <Hi color={COLORS.teal}>LonggaDog</Hi>
      </Caption>
      <Caption top={1440} size={64} style={{ ...enter(frame, 34), fontWeight: 800, WebkitTextStroke: "0px" }}>
        PromptGuard PH
      </Caption>
      <Caption top={1530} size={50} style={{ ...enter(frame, 40), fontWeight: 700, WebkitTextStroke: "0px" }}>
        Local AI guarding cloud AI
      </Caption>
      <Caption top={1640} size={56} style={{ ...enter(frame, 46), fontWeight: 800, WebkitTextStroke: "0px", color: COLORS.yellow }}>
        #AppBuildersPH
      </Caption>
    </Scene>
  );
};
