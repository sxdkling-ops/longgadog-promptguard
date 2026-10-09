import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Dog } from "../Dog";
import { Caption, COLORS, enter, Hi, pop, Scene } from "../kit";

/** Introduce the mascot. */
export const Meet: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Scene background="#0f2a2a">
      <Caption top={200} style={enter(frame, 0)}>
        So I got a <Hi>guard dog</Hi> for my clipboard
      </Caption>
      <div style={{ position: "absolute", left: 190, top: 640, ...pop(frame, 12) }}>
        <Dog size={700} mood="happy" lookX={interpolate(frame, [20, 60], [-0.8, 0.8], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
      </div>
      <Caption top={1410} size={94} style={enter(frame, 30)}>
        Meet <Hi color={COLORS.teal}>LonggaDog</Hi>
      </Caption>
      <Caption top={1590} size={56} style={{ ...enter(frame, 44), fontWeight: 700, WebkitTextStroke: "0px" }}>
        the mascot of PromptGuard PH
      </Caption>
    </Scene>
  );
};
