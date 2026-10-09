import React from "react";
import { useCurrentFrame } from "remotion";
import { Dog } from "../Dog";
import { Caption, COLORS, enter, Hi, pop, Scene } from "../kit";

const LINES = ["No off switch.", "Nothing to configure.", "Nothing stored."];

/** The guard's stance: automatic, and it fails closed. */
export const Strict: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Scene>
      {LINES.map((line, i) => (
        <Caption key={line} top={210 + i * 180} size={84} style={pop(frame, 4 + i * 14)}>
          {line}
        </Caption>
      ))}
      <div style={{ position: "absolute", left: 330, top: 860, ...pop(frame, 40) }}>
        <Dog size={420} mood="idle" lookY={0.2} />
      </div>
      <Caption top={1360} size={68} style={enter(frame, 62)}>
        Local AI not running?
        <br />
        Then <Hi color={COLORS.red}>nothing goes out</Hi>.
      </Caption>
    </Scene>
  );
};
